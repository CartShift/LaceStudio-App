import { describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/retry";

describe("withRetry", () => {
  it("retries retryable errors until success", async () => {
    let attempts = 0;

    const result = await withRetry({
      maxAttempts: 4,
      baseDelayMs: 0,
      run: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("temporary");
        }
        return "ok";
      },
      shouldRetry: ({ error }) => Boolean(error),
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("retries based on response/result inspection", async () => {
    const statuses = [503, 200];
    const onRetry = vi.fn();

    const responseStatus = await withRetry({
      maxAttempts: 3,
      baseDelayMs: 0,
      run: async () => statuses.shift() ?? 200,
      shouldRetry: ({ result }) => (result ?? 0) >= 500,
      onRetry,
    });

    expect(responseStatus).toBe(200);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({
      attempt: 1,
      nextAttempt: 2,
      maxAttempts: 3,
    });
  });

  it("throws the final non-retryable error", async () => {
    await expect(
      withRetry({
        maxAttempts: 3,
        baseDelayMs: 0,
        run: async () => {
          throw new Error("fatal");
        },
        shouldRetry: () => false,
      }),
    ).rejects.toThrow("fatal");
  });
});
