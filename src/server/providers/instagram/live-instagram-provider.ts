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
    if (input.postType === "reel") {
      throw new ApiError(400, "VALIDATION_ERROR", "Instagram Reels are not supported yet. Please publish a feed or story post.");
    }

    const payload = new URLSearchParams({
      image_url: input.imageUrl,
      access_token: account.accessToken,
    });

    if (input.postType === "story") {
      payload.set("media_type", "STORIES");
    } else {
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
    const fields = ["impressions", "reach", "likes", "comments", "saved", "shares"].join(",");
    const response = await fetch(
      `https://graph.facebook.com/${account.graphApiVersion ?? GRAPH_API_VERSION}/${input.mediaId}/insights?metric=${fields}&access_token=${account.accessToken}`,
    );

    if (!response.ok) {
      throw await toInstagramApiError(response, "fetchInsights");
    }

    const data = (await response.json()) as {
      data: Array<{ name: string; values: Array<{ value: number }> }>;
    };

    const lookup = new Map(data.data.map((metric) => [metric.name, metric.values[0]?.value ?? 0]));

    return {
      impressions: Number(lookup.get("impressions") ?? 0),
      reach: Number(lookup.get("reach") ?? 0),
      likes_count: Number(lookup.get("likes") ?? 0),
      comments_count: Number(lookup.get("comments") ?? 0),
      saves_count: Number(lookup.get("saved") ?? 0),
      shares_count: Number(lookup.get("shares") ?? 0),
    };
  }
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
