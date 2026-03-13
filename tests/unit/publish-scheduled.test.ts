import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/http";
import { classifyPublishFailure, extractUpstreamError } from "@/server/services/publish-scheduled";

describe("publish-scheduled failure mapping", () => {
  it("maps 429 failures to RETRY with default delay", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const error = new ApiError(429, "RATE_LIMITED", "Rate limited", {
      upstream_status: 429,
    });

    const result = classifyPublishFailure(error, 0, now);

    expect(result.status).toBe("RETRY");
    expect(result.httpStatus).toBe(429);
    expect(result.retryAfter?.toISOString()).toBe("2026-03-03T12:05:00.000Z");
  });

  it("fails permanently after third rate-limit failure", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const error = new ApiError(429, "RATE_LIMITED", "Rate limited", {
      upstream_status: 429,
    });

    const result = classifyPublishFailure(error, 2, now);

    expect(result.status).toBe("FAILED");
    expect(result.retryAfter).toBeNull();
    expect(result.message).toContain("retry budget exhausted");
  });

  it("maps auth and permission failures to FAILED", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const authError = new ApiError(401, "UNAUTHENTICATED", "Token expired", {
      upstream_status: 401,
    });
    const forbiddenError = new ApiError(403, "FORBIDDEN", "Permission missing", {
      upstream_status: 403,
    });

    expect(classifyPublishFailure(authError, 0, now).status).toBe("FAILED");
    expect(classifyPublishFailure(forbiddenError, 0, now).status).toBe("FAILED");
  });

  it("extracts upstream metadata from ApiError details", () => {
    const error = new ApiError(502, "INTERNAL_ERROR", "Upstream failed", {
      upstream_status: 500,
      response: { error: { code: 100, message: "Bad request" } },
    });

    const extracted = extractUpstreamError(error);

    expect(extracted.status).toBe(500);
    expect(extracted.responsePayload).toMatchObject({
      error: {
        code: 100,
      },
    });
  });

  it("maps unknown errors to FAILED without retry", () => {
    const now = new Date("2026-03-03T12:00:00.000Z");
    const result = classifyPublishFailure(new Error("Unexpected failure"), 0, now);

    expect(result.status).toBe("FAILED");
    expect(result.retryAfter).toBeNull();
    expect(result.message).toBe("Unexpected failure");
  });
});
