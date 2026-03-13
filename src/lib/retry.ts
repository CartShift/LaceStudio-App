import { sleep } from "@/lib/utils";

type RetryContext<T> = {
  attempt: number;
  maxAttempts: number;
  result?: T;
  error?: unknown;
};

type RetryScheduleContext<T> = RetryContext<T> & {
  delayMs: number;
  nextAttempt: number;
};

export async function withRetry<T>(input: {
  maxAttempts: number;
  baseDelayMs: number;
  jitterMs?: number;
  shouldRetry?: (context: RetryContext<T>) => boolean;
  onRetry?: (context: RetryScheduleContext<T>) => void | Promise<void>;
  run: (attempt: number) => Promise<T>;
}): Promise<T> {
  const maxAttempts = Math.max(1, Math.trunc(input.maxAttempts));
  const jitterMs = Math.max(0, input.jitterMs ?? 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await input.run(attempt);
      const retryable =
        attempt < maxAttempts &&
        (input.shouldRetry?.({
          attempt,
          maxAttempts,
          result,
        }) ??
          false);

      if (!retryable) {
        return result;
      }

      const delayMs = computeBackoffDelayMs(input.baseDelayMs, jitterMs, attempt);
      await input.onRetry?.({
        attempt,
        maxAttempts,
        result,
        delayMs,
        nextAttempt: attempt + 1,
      });
      await sleep(delayMs);
    } catch (error) {
      const retryable =
        attempt < maxAttempts &&
        (input.shouldRetry?.({
          attempt,
          maxAttempts,
          error,
        }) ??
          false);

      if (!retryable) {
        throw error;
      }

      const delayMs = computeBackoffDelayMs(input.baseDelayMs, jitterMs, attempt);
      await input.onRetry?.({
        attempt,
        maxAttempts,
        error,
        delayMs,
        nextAttempt: attempt + 1,
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Retry loop exhausted unexpectedly.");
}

export function isRetryableNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("econn") ||
    message.includes("fetch failed") ||
    message.includes("aborted")
  );
}

function computeBackoffDelayMs(baseDelayMs: number, jitterMs: number, attempt: number): number {
  const normalizedBase = Math.max(0, baseDelayMs);
  return normalizedBase * 2 ** Math.max(0, attempt - 1) + Math.random() * jitterMs;
}
