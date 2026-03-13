import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { getInstagramProvider } from "@/server/providers";
import {
  bootstrapInstagramPublishingState,
  loadInstagramAccountContext,
  markInstagramProfileAnalyticsSynced,
  markInstagramProfileAuthError,
} from "@/server/services/instagram-profiles.service";

export async function ingestAnalyticsSnapshots(now = new Date()): Promise<number> {
  await bootstrapInstagramPublishingState();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - 90);

  const posts = await prisma.publishingQueue.findMany({
    where: {
      status: "PUBLISHED",
      published_at: {
        gte: cutoff,
      },
      profile_id: {
        not: null,
      },
      ig_media_id: {
        not: null,
      },
    },
  });

  const provider = getInstagramProvider();
  let inserted = 0;
  const accountContextByProfile = new Map<string, Awaited<ReturnType<typeof loadInstagramAccountContext>>>();

  for (const post of posts) {
    if (!post.ig_media_id || !post.profile_id) continue;

    try {
      let account = accountContextByProfile.get(post.profile_id);
      if (!account) {
        account = await loadInstagramAccountContext(post.profile_id);
        accountContextByProfile.set(post.profile_id, account);
      }

      const metrics = await provider.fetchInsights(account, { mediaId: post.ig_media_id });
      const engagementTotal =
        metrics.likes_count + metrics.comments_count + metrics.saves_count + metrics.shares_count;
      const engagementRate = metrics.reach > 0 ? (engagementTotal / metrics.reach) * 100 : 0;

      await prisma.analyticsSnapshot.create({
        data: {
          publishing_queue_id: post.id,
          ig_media_id: post.ig_media_id,
          impressions: metrics.impressions,
          reach: metrics.reach,
          likes_count: metrics.likes_count,
          comments_count: metrics.comments_count,
          saves_count: metrics.saves_count,
          shares_count: metrics.shares_count,
          engagement_total: engagementTotal,
          engagement_rate: engagementRate,
        },
      });

      await markInstagramProfileAnalyticsSynced(post.profile_id, now);
      inserted += 1;
    } catch (error) {
      const extracted = extractUpstreamError(error);
      if (extracted.status === 401 || extracted.status === 403) {
        await markInstagramProfileAuthError(post.profile_id, extracted.message, extracted.status === 401);
      }
      await prisma.publishingLog.create({
        data: {
          publishing_queue_id: post.id,
          action: "fetch_insights",
          request_payload: { media_id: post.ig_media_id },
          response_payload: extracted.responsePayload ?? undefined,
          http_status: extracted.status ?? undefined,
          error_message: extracted.message,
        },
      });
    }
  }

  return inserted;
}

function extractUpstreamError(error: unknown): {
  status: number | null;
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

    return {
      status: upstreamStatus,
      message: error.message,
      responsePayload: details?.response,
    };
  }

  return {
    status: null,
    message: error instanceof Error ? error.message : "Unknown Instagram analytics error",
    responsePayload: null,
  };
}
