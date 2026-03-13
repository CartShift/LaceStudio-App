import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { isRetryableNetworkError, withRetry } from "@/lib/retry";
import type { GpuGeneratePayload, GpuGenerateResponse, GpuProvider } from "./types";

const GPU_REQUEST_TIMEOUT_MS = 120_000;
const GPU_RETRY_MAX_ATTEMPTS = 3;
const GPU_RETRY_BASE_DELAY_MS = 1_200;
const GPU_RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class LiveGpuProvider implements GpuProvider {
  async generate(payload: GpuGeneratePayload): Promise<GpuGenerateResponse> {
    const env = getEnv();
    const endpoint = `${env.GPU_SERVICE_URL.replace(/\/$/, "")}/generate`;

    const response = await requestGpuWithRetry({
      maxAttempts: GPU_RETRY_MAX_ATTEMPTS,
      timeoutMs: GPU_REQUEST_TIMEOUT_MS,
      request: (signal) =>
        fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.GPU_API_KEY}`,
          },
          body: JSON.stringify(payload),
          signal,
        }),
    });

    if (!response.ok) {
      throw new ApiError(502, "INTERNAL_ERROR", "GPU image creation failed for this request. Please try again.", {
        status: response.status,
      });
    }

    return (await response.json()) as GpuGenerateResponse;
  }
}

async function requestGpuWithRetry(input: {
  maxAttempts: number;
  timeoutMs: number;
  request: (signal: AbortSignal) => Promise<Response>;
}): Promise<Response> {
  return withRetry<Response>({
    maxAttempts: input.maxAttempts,
    baseDelayMs: GPU_RETRY_BASE_DELAY_MS,
    jitterMs: 400,
    shouldRetry: ({ result, error }) => {
      if (result) return GPU_RETRYABLE_STATUS_CODES.has(result.status);
      if (error) return isRetryableNetworkError(error);
      return false;
    },
    run: () => fetchWithTimeout(input.request, input.timeoutMs),
  });
}

async function fetchWithTimeout(
  request: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}
