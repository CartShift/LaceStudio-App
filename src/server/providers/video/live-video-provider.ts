import { ApiError } from "@/lib/http";
import { getEnv } from "@/lib/env";
import type { GenerateVideoInput, VideoGenerationProvider, VideoGenerationResult, VideoGenerationStatus } from "./types";

type GeminiOperationPayload = {
  name?: string;
  done?: boolean;
  error?: {
    message?: string;
  };
  response?: {
    generatedVideos?: Array<{
      video?: {
        uri?: string;
      };
      previewImage?: {
        uri?: string;
      };
    }>;
    generated_videos?: Array<{
      video?: {
        uri?: string;
      };
      preview_image?: {
        uri?: string;
      };
    }>;
  };
};

type GeminiGeneratedVideoCamel = {
  video?: {
    uri?: string;
  };
  previewImage?: {
    uri?: string;
  };
};

type GeminiGeneratedVideoSnake = {
  video?: {
    uri?: string;
  };
  preview_image?: {
    uri?: string;
  };
};

type GeminiGeneratedVideo = GeminiGeneratedVideoCamel | GeminiGeneratedVideoSnake;

export class LiveVideoGenerationProvider implements VideoGenerationProvider {
  async createVideo(input: GenerateVideoInput): Promise<VideoGenerationResult> {
    const env = getEnv();
    if (!env.VEO_API_URL || !env.VEO_API_KEY) {
      throw new ApiError(503, "INTERNAL_ERROR", "Veo video setup is missing. Add VEO_API_URL and VEO_API_KEY and try again.");
    }

    const baseUrl = env.VEO_API_URL.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/${env.VEO_MODEL}:predictLongRunning`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": env.VEO_API_KEY,
      },
      body: JSON.stringify({
        instances: [
          {
            prompt: input.prompt,
            image: {
              uri: input.imageUrl,
            },
          },
        ],
        parameters: {
          aspectRatio: input.aspectRatio,
          durationSeconds: input.durationSeconds,
        },
      }),
    });

    if (!response.ok) {
      throw await toVideoApiError(response, "createVideo");
    }

    const payload = (await response.json()) as GeminiOperationPayload;
    return normalizeOperationPayload(payload);
  }

  async getJob(providerJobId: string): Promise<VideoGenerationResult> {
    const env = getEnv();
    if (!env.VEO_API_KEY) {
      throw new ApiError(503, "INTERNAL_ERROR", "Veo video setup is missing. Add VEO_API_KEY and try again.");
    }

    const normalizedId = providerJobId.replace(/^\/+/, "");
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${normalizedId}`, {
      method: "GET",
      headers: {
        "x-goog-api-key": env.VEO_API_KEY,
      },
    });

    if (!response.ok) {
      throw await toVideoApiError(response, "getJob");
    }

    const payload = (await response.json()) as GeminiOperationPayload;
    return normalizeOperationPayload(payload);
  }
}

function normalizeOperationPayload(payload: GeminiOperationPayload): VideoGenerationResult {
  const providerJobId = payload.name ?? "";
  const errorMessage = payload.error?.message ?? null;
  const video: GeminiGeneratedVideo | null =
    payload.response?.generatedVideos?.[0] ??
    payload.response?.generated_videos?.[0] ??
    null;
  const outputUrl = video?.video?.uri ?? null;
  const previewImageUrl = getPreviewImageUrl(video);

  return {
    providerJobId,
    status: inferVideoStatus(payload.done, outputUrl, errorMessage),
    outputUrl,
    previewImageUrl,
    metadata: payload.response ? { response: payload.response } : null,
    errorMessage,
  };
}

function getPreviewImageUrl(video: GeminiGeneratedVideo | null): string | null {
  if (!video) return null;
  if ("previewImage" in video) return video.previewImage?.uri ?? null;
  if ("preview_image" in video) return video.preview_image?.uri ?? null;
  return null;
}

function inferVideoStatus(done: boolean | undefined, outputUrl: string | null, errorMessage: string | null): VideoGenerationStatus {
  if (errorMessage) return "FAILED";
  if (done && outputUrl) return "COMPLETED";
  if (done) return "FAILED";
  return "PROCESSING";
}

async function toVideoApiError(response: Response, operation: "createVideo" | "getJob"): Promise<ApiError> {
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
      : `Video provider request failed during ${operation}.`;

  return new ApiError(502, "INTERNAL_ERROR", message, {
    provider: "veo",
    operation,
    upstream_status: response.status,
    response: responseBody,
  });
}
