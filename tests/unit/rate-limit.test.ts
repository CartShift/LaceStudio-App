import { describe, it, expect, vi, beforeEach } from "vitest";
import { withRateLimit } from "@/lib/rate-limit";
import { ApiError } from "@/lib/http";

describe("withRateLimit", () => {
	beforeEach(() => {
		// Use a unique identifier per test to avoid cross-test pollution
		vi.unstubAllEnvs();
	});

	it("allows requests under the limit", () => {
		const id = `test-user-${Math.random()}`;
		expect(() => withRateLimit(id, { maxRequests: 3 })).not.toThrow();
		expect(() => withRateLimit(id, { maxRequests: 3 })).not.toThrow();
		expect(() => withRateLimit(id, { maxRequests: 3 })).not.toThrow();
	});

	it("throws ApiError(429) when limit is exceeded", () => {
		const id = `test-user-${Math.random()}`;
		// Fill the limit
		for (let i = 0; i < 5; i++) {
			withRateLimit(id, { maxRequests: 5 });
		}
		// The 6th call should throw
		expect(() => withRateLimit(id, { maxRequests: 5 })).toThrowError(ApiError);
	});

	it("429 error has RATE_LIMITED code", () => {
		const id = `test-user-${Math.random()}`;
		for (let i = 0; i < 3; i++) {
			withRateLimit(id, { maxRequests: 3 });
		}
		try {
			withRateLimit(id, { maxRequests: 3 });
			expect.fail("Should have thrown");
		} catch (error) {
			expect(error instanceof ApiError).toBe(true);
			if (error instanceof ApiError) {
				expect(error.code).toBe("RATE_LIMITED");
				expect(error.status).toBe(429);
			}
		}
	});

	it("different identifiers have independent windows", () => {
		const idA = `test-user-a-${Math.random()}`;
		const idB = `test-user-b-${Math.random()}`;

		// Fill up idA
		for (let i = 0; i < 2; i++) {
			withRateLimit(idA, { maxRequests: 2 });
		}
		expect(() => withRateLimit(idA, { maxRequests: 2 })).toThrow();

		// idB should still be fine
		expect(() => withRateLimit(idB, { maxRequests: 2 })).not.toThrow();
	});

	it("resets after the window expires", async () => {
		const id = `test-user-${Math.random()}`;
		const SHORT_WINDOW_MS = 50;

		for (let i = 0; i < 2; i++) {
			withRateLimit(id, { maxRequests: 2, windowMs: SHORT_WINDOW_MS });
		}
		expect(() => withRateLimit(id, { maxRequests: 2, windowMs: SHORT_WINDOW_MS })).toThrow();

		// Wait for the window to expire
		await new Promise(resolve => setTimeout(resolve, SHORT_WINDOW_MS + 10));

		// Should be OK again
		expect(() => withRateLimit(id, { maxRequests: 2, windowMs: SHORT_WINDOW_MS })).not.toThrow();
	});
});
