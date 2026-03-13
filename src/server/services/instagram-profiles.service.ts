import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import type { InstagramProfileSummary } from "@/types/domain";
import { decryptSecret, encryptSecret, maskIdentifier } from "@/server/services/secret-box";
import { ensurePostingStrategyForProfile, generatePostingPlanForProfile, getPostingStrategyForProfile } from "@/server/services/posting-strategy.service";

const FACEBOOK_GRAPH_VERSION = "v18.0";
const INSTAGRAM_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_content_publish",
  "instagram_manage_insights",
] as const;

function slugifyHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function readLegacySetup(raw: unknown): { handle?: string; timezone?: string } {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const instagramSetup =
    source.instagram_setup && typeof source.instagram_setup === "object"
      ? (source.instagram_setup as Record<string, unknown>)
      : null;

  return {
    handle: typeof instagramSetup?.handle === "string" ? instagramSetup.handle : undefined,
    timezone: typeof source.timezone === "string" ? source.timezone : undefined,
  };
}

export async function bootstrapInstagramPublishingState(): Promise<void> {
  const models = await prisma.aiModel.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      created_by: true,
      social_tracks_profile: true,
      created_at: true,
    },
    orderBy: [{ status: "desc" }, { created_at: "asc" }],
  });

  const existingProfiles = await prisma.instagramProfile.findMany({
    select: {
      id: true,
      model_id: true,
      graph_user_id: true,
    },
  });
  const profileByModelId = new Map(existingProfiles.map((profile) => [profile.model_id, profile]));

  for (const model of models) {
    if (profileByModelId.has(model.id)) {
      continue;
    }

    const legacy = readLegacySetup(model.social_tracks_profile);
    const created = await prisma.instagramProfile.create({
      data: {
        model_id: model.id,
        handle: legacy.handle ?? slugifyHandle(model.name),
        display_name: model.name,
        timezone: legacy.timezone ?? "UTC",
        connection_status: "DISCONNECTED",
        publish_enabled: true,
        profile_metadata: {
          bootstrap_source: "model",
        },
        created_by: model.created_by,
      },
      select: {
        id: true,
        model_id: true,
        graph_user_id: true,
      },
    });

    profileByModelId.set(model.id, created);
  }

  const queueRows = await prisma.publishingQueue.findMany({
    where: {
      profile_id: null,
    },
    select: {
      id: true,
      asset: {
        select: {
          campaign: {
            select: {
              model_id: true,
            },
          },
        },
      },
    },
  });

  if (queueRows.length === 0) {
    return;
  }

  const latestProfiles = await prisma.instagramProfile.findMany({
    select: {
      id: true,
      model_id: true,
    },
  });
  const latestProfileByModelId = new Map(latestProfiles.map((profile) => [profile.model_id, profile.id]));

  for (const row of queueRows) {
    const modelId = row.asset.campaign.model_id;
    const profileId = latestProfileByModelId.get(modelId);
    if (!profileId) continue;

    await prisma.publishingQueue.update({
      where: { id: row.id },
      data: {
        profile_id: profileId,
      },
    });
  }
}

export async function createInstagramProfile(input: {
  modelId: string;
  userId: string;
  handle?: string;
  displayName?: string;
  timezone: string;
  publishEnabled: boolean;
}) {
  const model = await prisma.aiModel.findUnique({
    where: { id: input.modelId },
    select: {
      id: true,
      name: true,
      created_by: true,
    },
  });

  if (!model) {
    throw new ApiError(404, "NOT_FOUND", "Model not found.");
  }

  const profile = await prisma.instagramProfile.upsert({
    where: { model_id: input.modelId },
    update: {
      handle: input.handle?.trim() || slugifyHandle(model.name),
      display_name: input.displayName?.trim() || model.name,
      timezone: input.timezone,
      publish_enabled: input.publishEnabled,
    },
    create: {
      model_id: input.modelId,
      handle: input.handle?.trim() || slugifyHandle(model.name),
      display_name: input.displayName?.trim() || model.name,
      timezone: input.timezone,
      publish_enabled: input.publishEnabled,
      connection_status: "DISCONNECTED",
      created_by: input.userId ?? model.created_by,
    },
  });

  await ensurePostingStrategyForProfile(profile.id);
  return profile;
}

type FacebookTokenResponse = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
};

type FacebookUserResponse = {
  id?: string;
  name?: string;
};

type FacebookPermissionResponse = {
  data?: Array<{
    permission?: string;
    status?: string;
  }>;
};

type FacebookPage = {
  id?: string;
  name?: string;
  category?: string;
  tasks?: string[];
  access_token?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
    name?: string;
    profile_picture_url?: string;
  } | null;
};

type FacebookDebugTokenResponse = {
  data?: {
    app_id?: string;
    application?: string;
    expires_at?: number;
    is_valid?: boolean;
    scopes?: string[];
    granular_scopes?: Array<{
      scope?: string;
      target_ids?: string[];
    }>;
    user_id?: string;
  };
};

type FacebookPageResponse = {
  data?: FacebookPage[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof body.error === "object" && body.error && "message" in body.error
        ? String(body.error.message)
        : "Facebook OAuth request failed.";
    throw new ApiError(response.status, "INTERNAL_ERROR", message);
  }

  return body as T;
}

function buildOAuthDebug(input: {
  user: FacebookUserResponse | null;
  permissions: FacebookPermissionResponse | null;
  tokenDebug: FacebookDebugTokenResponse | null;
  pages: FacebookPageResponse | null;
  targetPageIds: string[];
  directPageLookups: Array<{
    id: string;
    ok: boolean;
    error?: string;
    page?: FacebookPage | null;
  }>;
  resolvedPages: FacebookPage[];
}) {
  const pageDebug = (input.pages?.data ?? []).map((page) => ({
    id: page.id ?? null,
    name: page.name ?? null,
    category: page.category ?? null,
    tasks: page.tasks ?? [],
    has_page_access_token: Boolean(page.access_token),
    instagram_business_account_id: page.instagram_business_account?.id ?? null,
    instagram_username: page.instagram_business_account?.username ?? null,
    instagram_name: page.instagram_business_account?.name ?? null,
  }));

  return {
    facebook_user: {
      id: input.user?.id ?? null,
      name: input.user?.name ?? null,
    },
    token_debug: {
      app_id: input.tokenDebug?.data?.app_id ?? null,
      application: input.tokenDebug?.data?.application ?? null,
      is_valid: input.tokenDebug?.data?.is_valid ?? null,
      user_id: input.tokenDebug?.data?.user_id ?? null,
      scopes: input.tokenDebug?.data?.scopes ?? [],
      granular_scopes: input.tokenDebug?.data?.granular_scopes ?? [],
      expires_at: input.tokenDebug?.data?.expires_at ?? null,
    },
    permissions: (input.permissions?.data ?? []).map((permission) => ({
      permission: permission.permission ?? null,
      status: permission.status ?? null,
    })),
    target_page_ids: input.targetPageIds,
    direct_page_lookups: input.directPageLookups.map((result) => ({
      id: result.id,
      ok: result.ok,
      error: result.error ?? null,
      page: result.page
        ? {
            id: result.page.id ?? null,
            name: result.page.name ?? null,
            category: result.page.category ?? null,
            tasks: result.page.tasks ?? [],
            has_page_access_token: Boolean(result.page.access_token),
            instagram_business_account_id: result.page.instagram_business_account?.id ?? null,
            instagram_username: result.page.instagram_business_account?.username ?? null,
            instagram_name: result.page.instagram_business_account?.name ?? null,
          }
        : null,
    })),
    pages: pageDebug,
    page_count: pageDebug.length,
    resolved_pages: input.resolvedPages.map((page) => ({
      id: page.id ?? null,
      name: page.name ?? null,
      category: page.category ?? null,
      tasks: page.tasks ?? [],
      has_page_access_token: Boolean(page.access_token),
      instagram_business_account_id: page.instagram_business_account?.id ?? null,
      instagram_username: page.instagram_business_account?.username ?? null,
      instagram_name: page.instagram_business_account?.name ?? null,
    })),
    resolved_page_count: input.resolvedPages.length,
  };
}

function getTargetPageIds(tokenDebug: FacebookDebugTokenResponse | null): string[] {
  const ids = new Set<string>();

  for (const scope of tokenDebug?.data?.granular_scopes ?? []) {
    if ((scope.scope === "pages_show_list" || scope.scope === "pages_read_engagement") && scope.target_ids) {
      for (const id of scope.target_ids) {
        if (id) ids.add(id);
      }
    }
  }

  return Array.from(ids);
}

async function fetchFacebookPageById(accessToken: string, pageId: string): Promise<FacebookPage> {
  const basePage = await fetchJson<Pick<FacebookPage, "id" | "name" | "category">>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=id,name,category&access_token=${encodeURIComponent(accessToken)}`,
  );

  const pageToken = await fetchJson<Pick<FacebookPage, "access_token">>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=access_token&access_token=${encodeURIComponent(accessToken)}`,
  ).catch(() => ({ access_token: undefined }));

  const connectedInstagram = await fetchJson<{
    connected_instagram_account?: FacebookPage["instagram_business_account"];
  }>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=connected_instagram_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(accessToken)}`,
  ).catch(() => null);

  const businessInstagram =
    connectedInstagram?.connected_instagram_account
      ? null
      : await fetchJson<{
          instagram_business_account?: FacebookPage["instagram_business_account"];
        }>(
          `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/${encodeURIComponent(pageId)}?fields=instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(accessToken)}`,
        ).catch(() => null);

  return {
    ...basePage,
    access_token: pageToken.access_token,
    instagram_business_account:
      connectedInstagram?.connected_instagram_account ?? businessInstagram?.instagram_business_account ?? null,
  };
}

function requireFacebookOAuthConfig(): {
  FACEBOOK_APP_ID: string;
  FACEBOOK_APP_SECRET: string;
  INSTAGRAM_OAUTH_REDIRECT_URI: string;
  INSTAGRAM_ACCESS_TOKEN?: string;
  INSTAGRAM_USER_ID?: string;
} {
  const env = getEnv();
  if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET || !env.INSTAGRAM_OAUTH_REDIRECT_URI) {
    throw new ApiError(500, "INTERNAL_ERROR", "Facebook OAuth is not fully configured. Set FACEBOOK_APP_ID, FACEBOOK_APP_SECRET, and INSTAGRAM_OAUTH_REDIRECT_URI.");
  }

  return {
    ...env,
    FACEBOOK_APP_ID: env.FACEBOOK_APP_ID,
    FACEBOOK_APP_SECRET: env.FACEBOOK_APP_SECRET,
    INSTAGRAM_OAUTH_REDIRECT_URI: env.INSTAGRAM_OAUTH_REDIRECT_URI,
  };
}

export async function startInstagramOAuth(profileId: string) {
  const env = requireFacebookOAuthConfig();
  const profile = await prisma.instagramProfile.findUnique({
    where: { id: profileId },
    select: {
      id: true,
      display_name: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  const state = `${profileId}:${randomUUID()}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await prisma.instagramProfile.update({
    where: { id: profileId },
    data: {
      oauth_state: state,
      oauth_state_expires_at: expiresAt,
      connection_status: "PENDING",
    },
  });

  const params = new URLSearchParams({
    client_id: env.FACEBOOK_APP_ID,
    redirect_uri: env.INSTAGRAM_OAUTH_REDIRECT_URI,
    state,
    response_type: "code",
    scope: INSTAGRAM_OAUTH_SCOPES.join(","),
  });

  return {
    authorization_url: `https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth?${params.toString()}`,
    state,
    expires_at: expiresAt.toISOString(),
    profile_label: profile.display_name,
  };
}

export async function completeInstagramOAuthCallback(input: {
  state: string;
  code?: string;
  error?: string;
  errorDescription?: string;
}) {
  const env = requireFacebookOAuthConfig();

  const profile = await prisma.instagramProfile.findFirst({
    where: {
      oauth_state: input.state,
      oauth_state_expires_at: {
        gt: new Date(),
      },
    },
  });

  if (!profile) {
    throw new ApiError(400, "VALIDATION_ERROR", "This Instagram OAuth session is invalid or expired.");
  }

  if (input.error || !input.code) {
    await prisma.instagramProfile.update({
      where: { id: profile.id },
      data: {
        connection_status: "ERROR",
        oauth_state: null,
        oauth_state_expires_at: null,
      },
    });

    throw new ApiError(400, "VALIDATION_ERROR", input.errorDescription || input.error || "Instagram connection was cancelled.");
  }

  const shortLivedToken = await fetchJson<FacebookTokenResponse>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?client_id=${encodeURIComponent(env.FACEBOOK_APP_ID)}&redirect_uri=${encodeURIComponent(env.INSTAGRAM_OAUTH_REDIRECT_URI)}&client_secret=${encodeURIComponent(env.FACEBOOK_APP_SECRET)}&code=${encodeURIComponent(input.code)}`,
  );
  const longLivedToken = await fetchJson<FacebookTokenResponse>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(env.FACEBOOK_APP_ID)}&client_secret=${encodeURIComponent(env.FACEBOOK_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(shortLivedToken.access_token)}`,
  );
  const [facebookUser, permissions, tokenDebug, pages] = await Promise.all([
    fetchJson<FacebookUserResponse>(
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(longLivedToken.access_token)}`,
    ).catch(() => null),
    fetchJson<FacebookPermissionResponse>(
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(longLivedToken.access_token)}`,
    ).catch(() => null),
    fetchJson<FacebookDebugTokenResponse>(
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/debug_token?input_token=${encodeURIComponent(longLivedToken.access_token)}&access_token=${encodeURIComponent(`${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`)}`,
    ).catch(() => null),
    fetchJson<FacebookPageResponse>(
      `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/accounts?fields=id,name,category,tasks,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(longLivedToken.access_token)}`,
    ),
  ]);
  const targetPageIds = getTargetPageIds(tokenDebug);
  const directPageLookups = await Promise.all(
    targetPageIds.map(async (pageId) => {
      try {
        const page = await fetchFacebookPageById(longLivedToken.access_token, pageId);
        return {
          id: pageId,
          ok: true,
          page,
        };
      } catch (error) {
        return {
          id: pageId,
          ok: false,
          error: error instanceof Error ? error.message : "Unknown Facebook page lookup error.",
          page: null,
        };
      }
    }),
  );
  const resolvedPages = [...(pages.data ?? [])];

  for (const result of directPageLookups) {
    if (!result.ok || !result.page) continue;
    if (resolvedPages.some((page) => page.id && page.id === result.page?.id)) continue;
    resolvedPages.push(result.page);
  }

  const linkedPage = resolvedPages.find((page) => page.instagram_business_account?.id && page.access_token);
  const oauthDebug = buildOAuthDebug({
    user: facebookUser,
    permissions,
    tokenDebug,
    pages,
    targetPageIds,
    directPageLookups,
    resolvedPages,
  });

  if (!linkedPage?.instagram_business_account?.id || !linkedPage.access_token) {
    await prisma.instagramProfile.update({
      where: { id: profile.id },
      data: {
        connection_status: "ERROR",
        oauth_state: null,
        oauth_state_expires_at: null,
        profile_metadata: {
          connection_source: "oauth_failed_no_instagram_page",
          oauth_debug: oauthDebug,
        },
      },
    });

    throw new ApiError(400, "VALIDATION_ERROR", "No Instagram business account was found on the connected Facebook pages.", {
      oauth_debug: oauthDebug,
    });
  }

  const instagramAccount = linkedPage.instagram_business_account;
  const pageAccessToken = linkedPage.access_token;
  const expiresAt = longLivedToken.expires_in
    ? new Date(Date.now() + longLivedToken.expires_in * 1000)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.instagramProfile.update({
      where: { id: profile.id },
      data: {
        handle: instagramAccount.username ?? profile.handle,
        display_name: instagramAccount.name ?? linkedPage.name ?? profile.display_name,
        graph_user_id: instagramAccount.id,
        token_expires_at: expiresAt,
        connection_status: "CONNECTED",
        oauth_state: null,
        oauth_state_expires_at: null,
        profile_metadata: {
          connection_source: "oauth",
          page_name: linkedPage.name ?? null,
          username: instagramAccount.username ?? null,
          profile_picture_url: instagramAccount.profile_picture_url ?? null,
        },
      },
    });

    await tx.instagramProfileAuth.upsert({
      where: { profile_id: profile.id },
      update: {
        access_token_encrypted: encryptSecret(pageAccessToken),
        refresh_token_encrypted: encryptSecret(longLivedToken.access_token),
        token_type: longLivedToken.token_type ?? shortLivedToken.token_type ?? "bearer",
        scopes: [...INSTAGRAM_OAUTH_SCOPES],
        last_refreshed_at: new Date(),
        last_error: null,
      },
      create: {
        profile_id: profile.id,
        access_token_encrypted: encryptSecret(pageAccessToken),
        refresh_token_encrypted: encryptSecret(longLivedToken.access_token),
        token_type: longLivedToken.token_type ?? shortLivedToken.token_type ?? "bearer",
        scopes: [...INSTAGRAM_OAUTH_SCOPES],
        last_refreshed_at: new Date(),
      },
    });
  });

  return prisma.instagramProfile.findUniqueOrThrow({
    where: { id: profile.id },
  });
}

export async function disconnectInstagramProfile(profileId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.instagramProfile.update({
      where: { id: profileId },
      data: {
        connection_status: "DISCONNECTED",
        graph_user_id: null,
        token_expires_at: null,
        oauth_state: null,
        oauth_state_expires_at: null,
        profile_metadata: {
          connection_source: "manual_disconnect",
        },
      },
    });

    await tx.instagramProfileAuth.deleteMany({
      where: { profile_id: profileId },
    });
  });
}

export async function refreshInstagramProfileToken(profileId: string) {
  const env = requireFacebookOAuthConfig();
  const profile = await prisma.instagramProfile.findUnique({
    where: { id: profileId },
    include: {
      auth: true,
    },
  });

  if (!profile?.auth?.refresh_token_encrypted || !profile.graph_user_id) {
    throw new ApiError(400, "VALIDATION_ERROR", "This profile cannot refresh its token because no refresh token is stored.");
  }

  const refreshToken = decryptSecret(profile.auth.refresh_token_encrypted);
  const longLivedToken = await fetchJson<FacebookTokenResponse>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${encodeURIComponent(env.FACEBOOK_APP_ID)}&client_secret=${encodeURIComponent(env.FACEBOOK_APP_SECRET)}&fb_exchange_token=${encodeURIComponent(refreshToken)}`,
  );
  const pages = await fetchJson<FacebookPageResponse>(
    `https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me/accounts?fields=name,access_token,instagram_business_account{id,username,name,profile_picture_url}&access_token=${encodeURIComponent(longLivedToken.access_token)}`,
  );
  const linkedPage = pages.data?.find((page) => page.instagram_business_account?.id === profile.graph_user_id && page.access_token);

  if (!linkedPage?.access_token) {
    throw new ApiError(400, "VALIDATION_ERROR", "The refreshed Facebook session did not return the expected Instagram page token.");
  }

  const pageAccessToken = linkedPage.access_token;
  const expiresAt = longLivedToken.expires_in
    ? new Date(Date.now() + longLivedToken.expires_in * 1000)
    : null;

  await prisma.$transaction(async (tx) => {
    await tx.instagramProfile.update({
      where: { id: profile.id },
      data: {
        token_expires_at: expiresAt,
        connection_status: "CONNECTED",
      },
    });

    await tx.instagramProfileAuth.update({
      where: { profile_id: profile.id },
      data: {
        access_token_encrypted: encryptSecret(pageAccessToken),
        refresh_token_encrypted: encryptSecret(longLivedToken.access_token),
        last_refreshed_at: new Date(),
        last_error: null,
      },
    });
  });
}

export async function loadInstagramAccountContext(profileId: string) {
  const profile = await prisma.instagramProfile.findUnique({
    where: { id: profileId },
    include: {
      auth: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  const env = getEnv();

  if (profile.token_expires_at && profile.token_expires_at.getTime() <= Date.now() && profile.auth?.refresh_token_encrypted) {
    await refreshInstagramProfileToken(profileId);
    return loadInstagramAccountContext(profileId);
  }

  if (profile.graph_user_id && profile.auth?.access_token_encrypted) {
    return {
      profileId: profile.id,
      instagramUserId: profile.graph_user_id,
      accessToken: decryptSecret(profile.auth.access_token_encrypted),
      handle: profile.handle,
      graphApiVersion: FACEBOOK_GRAPH_VERSION,
    };
  }

  if (profile.graph_user_id && env.INSTAGRAM_USER_ID === profile.graph_user_id && env.INSTAGRAM_ACCESS_TOKEN) {
    return {
      profileId: profile.id,
      instagramUserId: profile.graph_user_id,
      accessToken: env.INSTAGRAM_ACCESS_TOKEN,
      handle: profile.handle,
      graphApiVersion: FACEBOOK_GRAPH_VERSION,
    };
  }

  throw new ApiError(400, "VALIDATION_ERROR", "This Instagram profile is not connected to a publishable account.");
}

export async function markInstagramProfileAuthError(profileId: string, message: string, expired = false) {
  await prisma.instagramProfile.update({
    where: { id: profileId },
    data: {
      connection_status: expired ? "EXPIRED" : "ERROR",
    },
  });

  await prisma.instagramProfileAuth.updateMany({
    where: { profile_id: profileId },
    data: {
      last_error: message,
    },
  });
}

export async function markInstagramProfileAnalyticsSynced(profileId: string, syncedAt: Date) {
  await prisma.instagramProfile.update({
    where: { id: profileId },
    data: {
      last_analytics_sync_at: syncedAt,
      connection_status: "CONNECTED",
    },
  });
}

async function getLastPostPerformance(profileId: string) {
  const queueItem = await prisma.publishingQueue.findFirst({
    where: {
      profile_id: profileId,
      status: "PUBLISHED",
    },
    orderBy: [{ published_at: "desc" }, { updated_at: "desc" }],
    include: {
      analytics: {
        orderBy: { fetched_at: "desc" },
        take: 1,
      },
    },
  });

  if (!queueItem?.published_at) {
    return null;
  }

  const latestSnapshot = queueItem.analytics[0];
  return {
    publishing_queue_id: queueItem.id,
    published_at: queueItem.published_at.toISOString(),
    views: latestSnapshot?.views ?? latestSnapshot?.impressions ?? latestSnapshot?.reach ?? 0,
    reach: latestSnapshot?.reach ?? 0,
    engagement_rate: Number(latestSnapshot?.engagement_rate ?? 0),
    pillar_key: queueItem.pillar_key,
  };
}

export async function listInstagramProfileSummaries(input?: { profileId?: string }): Promise<InstagramProfileSummary[]> {
  await bootstrapInstagramPublishingState();

  const profiles = await prisma.instagramProfile.findMany({
    where: input?.profileId ? { id: input.profileId } : undefined,
    include: {
      model: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: [{ updated_at: "desc" }, { created_at: "asc" }],
  });

  return Promise.all(
    profiles.map(async (profile) => {
      const strategy = await getPostingStrategyForProfile(profile.id);
      const nextPosts = await generatePostingPlanForProfile({
        profileId: profile.id,
        limit: 3,
      });
      const [approvedAssetsReady, scheduledCount, pendingApprovalCount, failedCount, publishedLastWeek, lastPost] = await Promise.all([
        prisma.asset.count({
          where: {
            status: "APPROVED",
            campaign: {
              model_id: profile.model_id,
            },
            publishing_queue: {
              none: {
                status: {
                  in: ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"],
                },
              },
            },
          },
        }),
        prisma.publishingQueue.count({
          where: {
            profile_id: profile.id,
            status: {
              in: ["SCHEDULED", "PUBLISHING", "RETRY"],
            },
            scheduled_at: {
              gte: new Date(),
            },
          },
        }),
        prisma.publishingQueue.count({
          where: {
            profile_id: profile.id,
            status: "PENDING_APPROVAL",
            scheduled_at: {
              gte: new Date(),
            },
          },
        }),
        prisma.publishingQueue.count({
          where: {
            profile_id: profile.id,
            status: "FAILED",
          },
        }),
        prisma.publishingQueue.count({
          where: {
            profile_id: profile.id,
            status: "PUBLISHED",
            published_at: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
            },
          },
        }),
        getLastPostPerformance(profile.id),
      ]);

      const cadenceScore = Math.min(
        100,
        Math.round((((scheduledCount + pendingApprovalCount) + publishedLastWeek) / Math.max(1, strategy.weekly_post_target)) * 100),
      );
      const staleAnalytics =
        !profile.last_analytics_sync_at ||
        Date.now() - profile.last_analytics_sync_at.getTime() > 24 * 60 * 60 * 1000;
      const warnings = [
        ...(profile.connection_status !== "CONNECTED" ? ["Instagram account needs attention."] : []),
        ...(approvedAssetsReady < strategy.min_ready_assets ? ["Approved asset readiness is below the strategy minimum."] : []),
        ...(failedCount > 0 ? ["Publishing failures are waiting in the queue."] : []),
        ...(staleAnalytics ? ["Analytics sync is stale."] : []),
      ];

      return {
        id: profile.id,
        model_id: profile.model_id,
        model_name: profile.model.name,
        handle: profile.handle,
        display_name: profile.display_name,
        timezone: profile.timezone,
        connection_status: profile.connection_status,
        graph_user_id_preview: maskIdentifier(profile.graph_user_id),
        publish_enabled: profile.publish_enabled,
        token_expires_at: profile.token_expires_at?.toISOString() ?? null,
        last_analytics_sync_at: profile.last_analytics_sync_at?.toISOString() ?? null,
        strategy: {
          primary_goal: strategy.primary_goal,
          weekly_post_target: strategy.weekly_post_target,
          weekly_feed_target: strategy.weekly_feed_target,
          weekly_reel_target: strategy.weekly_reel_target,
          weekly_story_target: strategy.weekly_story_target,
          cooldown_hours: strategy.cooldown_hours,
          min_ready_assets: strategy.min_ready_assets,
          active_pillars: strategy.pillars.filter((pillar) => pillar.active).length,
          slot_count: strategy.slot_templates.filter((slot) => slot.active).length,
          experimentation_rate_percent: strategy.experimentation_rate_percent,
          auto_queue_enabled: strategy.auto_queue_enabled,
          auto_queue_min_confidence: strategy.auto_queue_min_confidence,
        },
        health: {
          cadence_score: cadenceScore,
          approved_assets_ready: approvedAssetsReady,
          scheduled_count: scheduledCount,
          pending_approval_count: pendingApprovalCount,
          failed_count: failedCount,
          recommendation_count: nextPosts.filter((item) => item.status === "RECOMMENDED").length,
          stale_analytics: staleAnalytics,
          warnings,
        },
        last_post: lastPost,
        next_posts: nextPosts,
      };
    }),
  );
}
