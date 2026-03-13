import { ApiError } from "@/lib/http";
import type {
  InstagramAccountContext,
  InstagramInsights,
  InstagramInsightsInput,
  InstagramMediaInput,
  InstagramProvider,
  InstagramPublishInput,
} from "./types";

const GRAPH_API_VERSION = "v18.0";

export class LiveInstagramProvider implements InstagramProvider {
  async createMedia(account: InstagramAccountContext, input: InstagramMediaInput): Promise<{ containerId: string }> {
    const payload = new URLSearchParams({
      access_token: account.accessToken,
    });

    if (input.postType === "reel") {
      if (!input.videoUrl) {
        throw new ApiError(400, "VALIDATION_ERROR", "Reel publishing requires a video URL.");
      }

      payload.set("media_type", "REELS");
      payload.set("video_url", input.videoUrl);
      payload.set("caption", input.caption);
      payload.set("share_to_feed", input.shareToFeed === false ? "false" : "true");
    } else if (input.postType === "story") {
      if (!input.imageUrl) {
        throw new ApiError(400, "VALIDATION_ERROR", "Story publishing requires an image URL.");
      }
      payload.set("image_url", input.imageUrl);
      payload.set("media_type", "STORIES");
    } else {
      if (!input.imageUrl) {
        throw new ApiError(400, "VALIDATION_ERROR", "Feed publishing requires an image URL.");
      }
      payload.set("image_url", input.imageUrl);
      payload.set("caption", input.caption);
    }

    const response = await fetch(`https://graph.facebook.com/${account.graphApiVersion ?? GRAPH_API_VERSION}/${account.instagramUserId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: payload.toString(),
    });

    if (!response.ok) {
      throw await toInstagramApiError(response, "createMedia");
    }

    const data = (await response.json()) as { id: string };
    return { containerId: data.id };
  }

  async publishMedia(account: InstagramAccountContext, input: InstagramPublishInput): Promise<{ mediaId: string }> {
    const payload = new URLSearchParams({
      creation_id: input.containerId,
      access_token: account.accessToken,
    });

    const response = await fetch(
      `https://graph.facebook.com/${account.graphApiVersion ?? GRAPH_API_VERSION}/${account.instagramUserId}/media_publish`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: payload.toString(),
      },
    );

    if (!response.ok) {
      throw await toInstagramApiError(response, "publishMedia");
    }

    const data = (await response.json()) as { id: string };
    return { mediaId: data.id };
  }

  async fetchInsights(account: InstagramAccountContext, input: InstagramInsightsInput): Promise<InstagramInsights> {
    const primaryMetrics = await requestInsightsMetrics(account, input.mediaId, ["impressions", "reach", "likes", "comments", "saved", "shares", "views"]);
    const secondaryMetrics = await requestInsightsMetrics(account, input.mediaId, ["replies", "profile_visits", "follows"]).catch(() => new Map<string, number>());
    const watchMetrics = await requestInsightsMetrics(account, input.mediaId, ["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"]).catch(() => new Map<string, number>());
    const lookup = new Map<string, number>([...primaryMetrics, ...secondaryMetrics, ...watchMetrics]);

    return {
      impressions: Number(lookup.get("impressions") ?? 0),
      reach: Number(lookup.get("reach") ?? 0),
      views: Number(lookup.get("views") ?? lookup.get("impressions") ?? lookup.get("reach") ?? 0),
      likes_count: Number(lookup.get("likes") ?? 0),
      comments_count: Number(lookup.get("comments") ?? 0),
      saves_count: Number(lookup.get("saved") ?? 0),
      shares_count: Number(lookup.get("shares") ?? 0),
      replies_count: Number(lookup.get("replies") ?? 0),
      avg_watch_time_ms: toMilliseconds(lookup.get("ig_reels_avg_watch_time")),
      total_watch_time_ms: toMilliseconds(lookup.get("ig_reels_video_view_total_time")),
      profile_visits_count: Number(lookup.get("profile_visits") ?? 0),
      follows_count: Number(lookup.get("follows") ?? 0),
      raw_metrics: Object.fromEntries(lookup),
    };
  }
}

async function requestInsightsMetrics(account: InstagramAccountContext, mediaId: string, metrics: string[]): Promise<Map<string, number>> {
  const fields = metrics.join(",");
  const response = await fetch(
    `https://graph.facebook.com/${account.graphApiVersion ?? GRAPH_API_VERSION}/${mediaId}/insights?metric=${fields}&access_token=${account.accessToken}`,
  );

  if (!response.ok) {
    throw await toInstagramApiError(response, "fetchInsights");
  }

  const data = (await response.json()) as {
    data: Array<{ name: string; values: Array<{ value: number }> }>;
  };

  return new Map(data.data.map((metric) => [metric.name, Number(metric.values[0]?.value ?? 0)]));
}

function toMilliseconds(value: number | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 1000);
}

async function toInstagramApiError(
  response: Response,
  operation: "createMedia" | "publishMedia" | "fetchInsights",
): Promise<ApiError> {
  const retryAfterRaw = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null;

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = await response.text().catch(() => null);
  }

  const message =
    typeof responseBody === "object" &&
    responseBody !== null &&
      "error" in responseBody &&
      typeof responseBody.error === "object" &&
      responseBody.error !== null &&
      "message" in responseBody.error &&
      typeof responseBody.error.message === "string"
        ? responseBody.error.message
      : `Instagram request failed during ${operation}. Please try again.`;

  if (response.status === 429) {
    return new ApiError(429, "RATE_LIMITED", message, {
      provider: "instagram",
      operation,
      upstream_status: response.status,
      retry_after_seconds:
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds !== null ? retryAfterSeconds : undefined,
      response: responseBody,
    });
  }

  if (response.status === 401) {
    return new ApiError(401, "UNAUTHENTICATED", message, {
      provider: "instagram",
      operation,
      upstream_status: response.status,
      response: responseBody,
    });
  }

  if (response.status === 403) {
    return new ApiError(403, "FORBIDDEN", message, {
      provider: "instagram",
      operation,
      upstream_status: response.status,
      response: responseBody,
    });
  }

  return new ApiError(502, "INTERNAL_ERROR", message, {
    provider: "instagram",
    operation,
    upstream_status: response.status,
    response: responseBody,
  });
}
