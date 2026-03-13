import { getEnv } from "@/lib/env";
import { log } from "@/lib/logger";
import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { getInstagramProvider } from "@/server/providers";
import {
  bootstrapInstagramPublishingState,
  loadInstagramAccountContext,
  markInstagramProfileAuthError,
} from "@/server/services/instagram-profiles.service";
import { createSignedReadUrlForGcsUri } from "@/server/services/storage/gcs-storage";

const DEFAULT_HOURLY_CALL_LIMIT = 25;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_SECONDS = 5 * 60;
const MAX_ITEMS_PER_RUN = 25;
const PUBLISHING_LOCK_SECONDS = 15 * 60;

export async function publishDuePosts(now = new Date()): Promise<number> {
  await bootstrapInstagramPublishingState();
  const hourlyCallLimit = await getInstagramCallLimitPerHour();
  const remainingCallBudget = await getRemainingApiCallBudget(now, hourlyCallLimit);
  const maxItemsToScan = Math.min(MAX_ITEMS_PER_RUN, remainingCallBudget);

  if (maxItemsToScan <= 0) {
    return 0;
  }

  const due = await prisma.publishingQueue.findMany({
    where: {
      OR: [
        {
          status: "SCHEDULED",
          scheduled_at: {
            lte: now,
          },
        },
        {
          status: "RETRY",
          OR: [
            { retry_after: null },
            {
              retry_after: {
                lte: now,
              },
            },
          ],
        },
        {
          status: "PUBLISHING",
          OR: [
            { retry_after: null },
            {
              retry_after: {
                lte: now,
              },
            },
          ],
        },
      ],
    },
    include: {
      asset: {
        include: {
          variants: true,
        },
      },
      profile: true,
    },
    orderBy: [{ scheduled_at: "asc" }, { created_at: "asc" }],
    take: maxItemsToScan,
  });

  const provider = getInstagramProvider();
  const env = getEnv();
  const perProfileHourlyLimit = Math.max(1, Math.min(hourlyCallLimit, DEFAULT_HOURLY_CALL_LIMIT));
  let remainingBudget = remainingCallBudget;
  let published = 0;
  const remainingBudgetByProfile = new Map<string, number>();
  const accountContextByProfile = new Map<string, Awaited<ReturnType<typeof loadInstagramAccountContext>>>();

  for (const item of due) {
    if (!item.profile_id) {
      await updatePublishingQueueResult(item.id, {
        status: "FAILED",
        retry_after: null,
        error_message: "This queue item is missing an Instagram profile assignment.",
      });
      continue;
    }

    const estimatedCalls = item.ig_container_id ? 1 : 2;
    if (remainingBudget < estimatedCalls) {
      break;
    }

    let profileRemainingBudget = remainingBudgetByProfile.get(item.profile_id);
    if (profileRemainingBudget === undefined) {
      profileRemainingBudget = await getRemainingApiCallBudget(now, perProfileHourlyLimit, item.profile_id);
      remainingBudgetByProfile.set(item.profile_id, profileRemainingBudget);
    }
    if (profileRemainingBudget < estimatedCalls) {
      continue;
    }

    const claimed = await prisma.publishingQueue.updateMany({
      where: {
        id: item.id,
        OR: [
          {
            status: "SCHEDULED",
          },
          {
            status: "RETRY",
            OR: [{ retry_after: null }, { retry_after: { lte: now } }],
          },
          {
            status: "PUBLISHING",
            OR: [{ retry_after: null }, { retry_after: { lte: now } }],
          },
        ],
      },
      data: {
        status: "PUBLISHING",
        error_message: null,
        retry_after: new Date(now.getTime() + PUBLISHING_LOCK_SECONDS * 1000),
      },
    });

    if (claimed.count === 0) {
      continue;
    }

    remainingBudget -= estimatedCalls;
    remainingBudgetByProfile.set(item.profile_id, profileRemainingBudget - estimatedCalls);

    let currentAction: "create_container" | "publish" = "create_container";
    let currentRequestPayload: Record<string, unknown> | null = null;
    let createdContainerId: string | null = null;
    let containerId: string | null = item.ig_container_id;

    try {
      await refreshPublishingLease(item.id);

      const mediaUrl = await resolvePublishingMediaUrl({
        asset: item.asset,
        variantType: item.variant_type,
        shouldSignGsUrls: env.INSTAGRAM_PROVIDER_MODE === "live",
      });

      if (!containerId) {
        currentRequestPayload = {
          media_url: mediaUrl,
          caption: item.caption,
          post_type: item.post_type,
        };

        let account = accountContextByProfile.get(item.profile_id);
        if (!account) {
          account = await loadInstagramAccountContext(item.profile_id);
          accountContextByProfile.set(item.profile_id, account);
        }

        const media = await provider.createMedia(account, {
          imageUrl: item.post_type === "reel" ? undefined : mediaUrl,
          videoUrl: item.post_type === "reel" ? mediaUrl : undefined,
          caption: item.caption,
          postType: item.post_type,
          shareToFeed: item.post_type === "reel",
        });
        createdContainerId = media.containerId;
        containerId = media.containerId;

        await createPublishingLogSafe({
          queueId: item.id,
          action: "create_container",
          requestPayload: currentRequestPayload,
          responsePayload: { container_id: media.containerId },
          httpStatus: 200,
        });

        currentAction = "publish";
        currentRequestPayload = { container_id: media.containerId };
      } else {
        currentAction = "publish";
        currentRequestPayload = { container_id: containerId };
      }

      await refreshPublishingLease(item.id);
      let account = accountContextByProfile.get(item.profile_id);
      if (!account) {
        account = await loadInstagramAccountContext(item.profile_id);
        accountContextByProfile.set(item.profile_id, account);
      }
      const publishedMedia = await provider.publishMedia(account, {
        containerId: containerId,
      });

      await createPublishingLogSafe({
        queueId: item.id,
        action: "publish",
        requestPayload: currentRequestPayload,
        responsePayload: { media_id: publishedMedia.mediaId },
        httpStatus: 200,
      });

      await updatePublishingQueueResult(item.id, {
        status: "PUBLISHED",
        published_at: now,
        ig_container_id: containerId,
        ig_media_id: publishedMedia.mediaId,
        retry_after: null,
        error_message: null,
      });

      published += 1;
    } catch (error) {
      const failure = classifyPublishFailure(error, item.retry_count, now);

      if (item.profile_id && (failure.httpStatus === 401 || failure.httpStatus === 403)) {
        await markInstagramProfileAuthError(item.profile_id, failure.message, failure.httpStatus === 401);
      }

      await createPublishingLogSafe({
        queueId: item.id,
        action: currentAction,
        requestPayload: currentRequestPayload,
        responsePayload: failure.responsePayload,
        httpStatus: failure.httpStatus,
        errorMessage: failure.message,
      });

      await updatePublishingQueueResult(item.id, {
        status: failure.status,
        retry_count: {
          increment: 1,
        },
        retry_after: failure.retryAfter,
        error_message: failure.message,
        ig_container_id: createdContainerId ?? containerId ?? item.ig_container_id,
      });
    }
  }

  return published;
}

export type PublishFailure = {
  status: "RETRY" | "FAILED";
  retryAfter: Date | null;
  httpStatus: number | null;
  message: string;
  responsePayload: unknown;
};

export function classifyPublishFailure(error: unknown, currentRetryCount: number, now: Date): PublishFailure {
  const extracted = extractUpstreamError(error);

  if (extracted.status === 429) {
    const nextRetryCount = currentRetryCount + 1;
    const canRetry = nextRetryCount < MAX_RATE_LIMIT_RETRIES;

    if (!canRetry) {
      return {
        status: "FAILED",
        retryAfter: null,
        httpStatus: extracted.status,
        message: `Instagram rate limit exceeded and retry budget exhausted: ${extracted.message}`,
        responsePayload: extracted.responsePayload,
      };
    }

    const retryAfter =
      extracted.retryAfter ?? new Date(now.getTime() + DEFAULT_RETRY_DELAY_SECONDS * 1000);

    return {
      status: "RETRY",
      retryAfter,
      httpStatus: extracted.status,
      message: `Instagram rate limited request; retry scheduled at ${retryAfter.toISOString()}`,
      responsePayload: extracted.responsePayload,
    };
  }

  if (extracted.status === 401 || extracted.status === 403) {
    return {
      status: "FAILED",
      retryAfter: null,
      httpStatus: extracted.status,
      message: `Instagram authentication/permission error: ${extracted.message}`,
      responsePayload: extracted.responsePayload,
    };
  }

  return {
    status: "FAILED",
    retryAfter: null,
    httpStatus: extracted.status,
    message: extracted.message,
    responsePayload: extracted.responsePayload,
  };
}

export function extractUpstreamError(error: unknown): {
  status: number | null;
  retryAfter: Date | null;
  message: string;
  responsePayload: unknown;
} {
  if (error instanceof ApiError) {
    const details =
      typeof error.details === "object" && error.details !== null
        ? (error.details as Record<string, unknown>)
        : null;

    const upstreamStatus =
      details && typeof details.upstream_status === "number" ? details.upstream_status : error.status;

    const retryAfterSeconds =
      details && typeof details.retry_after_seconds === "number" ? details.retry_after_seconds : null;

    const responsePayload = details?.response;

    return {
      status: upstreamStatus,
      retryAfter:
        retryAfterSeconds !== null && Number.isFinite(retryAfterSeconds)
          ? new Date(Date.now() + retryAfterSeconds * 1000)
          : null,
      message: error.message,
      responsePayload,
    };
  }

  return {
    status: null,
    retryAfter: null,
    message: error instanceof Error ? error.message : "Unknown publishing error",
    responsePayload: null,
  };
}

async function resolveImageUrlForPublishing(assetUri: string, shouldSignGsUrls: boolean): Promise<string> {
  if (!assetUri) {
    throw new ApiError(400, "VALIDATION_ERROR", "Asset URL is required before publishing. Please provide a valid URL.");
  }

  if (assetUri.startsWith("http://") || assetUri.startsWith("https://")) {
    return assetUri;
  }

  if (assetUri.startsWith("gs://")) {
    if (!shouldSignGsUrls) {
      return assetUri;
    }

    return createSignedReadUrlForGcsUri(assetUri, 3600);
  }

  throw new ApiError(400, "VALIDATION_ERROR", "This asset URL format is not supported for Instagram publishing.");
}

async function resolvePublishingMediaUrl(input: {
  asset: {
    approved_gcs_uri: string | null;
    raw_gcs_uri: string;
    variants: Array<{
      format_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
      gcs_uri: string;
    }>;
  };
  variantType: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
  shouldSignGsUrls: boolean;
}) {
  const matchedVariant = input.asset.variants.find((variant) => variant.format_type === input.variantType);
  return resolveImageUrlForPublishing(matchedVariant?.gcs_uri ?? input.asset.approved_gcs_uri ?? input.asset.raw_gcs_uri, input.shouldSignGsUrls);
}

async function createPublishingLog(input: {
  queueId: string;
  action: "create_container" | "publish";
  requestPayload: unknown;
  responsePayload?: unknown;
  httpStatus?: number | null;
  errorMessage?: string | null;
}) {
  await prisma.publishingLog.create({
    data: {
      publishing_queue_id: input.queueId,
      action: input.action,
      request_payload: toJsonValue(input.requestPayload),
      response_payload: input.responsePayload === undefined ? undefined : toJsonValue(input.responsePayload),
      http_status: input.httpStatus ?? undefined,
      error_message: input.errorMessage ?? undefined,
    },
  });
}

async function createPublishingLogSafe(input: {
  queueId: string;
  action: "create_container" | "publish";
  requestPayload: unknown;
  responsePayload?: unknown;
  httpStatus?: number | null;
  errorMessage?: string | null;
}) {
  try {
    await createPublishingLog(input);
  } catch (error) {
    log({
      level: "warn",
      service: "cron",
      action: "publishing_log_failed",
      entity_type: "publishing_queue",
      entity_id: input.queueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function updatePublishingQueueResult(
  queueId: string,
  data: Parameters<typeof prisma.publishingQueue.update>[0]["data"],
) {
  try {
    await prisma.publishingQueue.update({
      where: { id: queueId },
      data,
    });
  } catch (error) {
    log({
      level: "warn",
      service: "cron",
      action: "publishing_queue_update_failed",
      entity_type: "publishing_queue",
      entity_id: queueId,
      error: error instanceof Error ? error.message : String(error),
      metadata: {
        has_retry_count: "retry_count" in data,
      },
    });
  }
}

async function refreshPublishingLease(queueId: string) {
  try {
    await prisma.publishingQueue.update({
      where: {
        id: queueId,
        status: "PUBLISHING",
      },
      data: {
        retry_after: new Date(Date.now() + PUBLISHING_LOCK_SECONDS * 1000),
      },
    });
  } catch (error) {
    log({
      level: "warn",
      service: "cron",
      action: "publishing_lease_refresh_failed",
      entity_type: "publishing_queue",
      entity_id: queueId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function toJsonValue(value: unknown) {
  const normalized = value === undefined || value === null ? {} : JSON.parse(JSON.stringify(value));
  return toInputJson(normalized);
}

async function getInstagramCallLimitPerHour(): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: "instagram_rate_limit_per_hour" },
  });

  const configured =
    typeof setting?.value === "number"
      ? setting.value
      : typeof setting?.value === "string"
        ? Number.parseInt(setting.value, 10)
        : null;

  if (configured !== null && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured);
  }

  return DEFAULT_HOURLY_CALL_LIMIT;
}

async function getRemainingApiCallBudget(now: Date, hourlyLimit: number, profileId?: string): Promise<number> {
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

  const callsInLastHour = await prisma.publishingLog.count({
    where: {
      action: {
        in: ["create_container", "publish"],
      },
      created_at: {
        gte: oneHourAgo,
      },
      ...(profileId
        ? {
            queue: {
              profile_id: profileId,
            },
          }
        : {}),
    },
  });

  return Math.max(0, hourlyLimit - callsInLastHour);
}
