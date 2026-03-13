/**
 * In-memory sliding-window rate limiter.
 *
 * Uses env vars API_RATE_LIMIT_WINDOW_MS and API_RATE_LIMIT_MAX_REQUESTS
 * (or API_RATE_LIMIT_MAX_REQUESTS_PER_USER) to configure limits.
 *
 * NOTE: This is a single-process limiter. For multi-instance deployments,
 * replace the in-memory store with a shared Redis counter.
 */

import { ApiError } from "@/lib/http";
import { log } from "@/lib/logger";

const DEFAULT_WINDOW_MS = 60_000; // 1 minute
const DEFAULT_MAX_REQUESTS = 60; // 60 requests per minute per identifier

// Map of identifier -> array of request timestamps within the current window
const requestLog = new Map<string, number[]>();

// Periodically clean up expired entries to prevent unbounded memory growth
// (every 5 minutes, but only if there's been at least one request)
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60_000;

function cleanup(windowMs: number): void {
	const now = Date.now();
	if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
	lastCleanup = now;
	const cutoff = now - windowMs;
	for (const [key, timestamps] of requestLog.entries()) {
		const filtered = timestamps.filter(t => t > cutoff);
		if (filtered.length === 0) {
			requestLog.delete(key);
		} else {
			requestLog.set(key, filtered);
		}
	}
}

export interface RateLimitOptions {
	/** Sliding window in milliseconds. Defaults to API_RATE_LIMIT_WINDOW_MS or 60 000. */
	windowMs?: number;
	/** Max requests per window. Defaults to API_RATE_LIMIT_MAX_REQUESTS or 60. */
	maxRequests?: number;
}

/**
 * Check and record a request for `identifier` (typically a user ID or IP).
 * Throws `ApiError(429, "RATE_LIMITED")` when the limit is exceeded.
 */
export function withRateLimit(identifier: string, options?: RateLimitOptions): void {
	const windowMs = options?.windowMs ?? (process.env.API_RATE_LIMIT_WINDOW_MS ? parseInt(process.env.API_RATE_LIMIT_WINDOW_MS, 10) : undefined) ?? DEFAULT_WINDOW_MS;

	const maxRequests =
		options?.maxRequests ??
		(process.env.API_RATE_LIMIT_MAX_REQUESTS_PER_USER ? parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS_PER_USER, 10) : undefined) ??
		(process.env.API_RATE_LIMIT_MAX_REQUESTS ? parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS, 10) : undefined) ??
		DEFAULT_MAX_REQUESTS;

	cleanup(windowMs);

	const now = Date.now();
	const cutoff = now - windowMs;
	const existing = requestLog.get(identifier) ?? [];
	const inWindow = existing.filter(t => t > cutoff);

	if (inWindow.length >= maxRequests) {
		const oldestInWindow = inWindow[0] ?? now;
		const retryAfterMs = Math.max(0, oldestInWindow + windowMs - now);
		const retryAfterSecs = Math.ceil(retryAfterMs / 1000);

		log({
			level: "warn",
			service: "api",
			action: "rate_limited",
			user_id: identifier,
			metadata: {
				requests_in_window: inWindow.length,
				limit: maxRequests,
				window_ms: windowMs,
				retry_after_ms: retryAfterMs
			}
		});

		throw new ApiError(429, "RATE_LIMITED", `You're sending requests too quickly. Wait ${retryAfterSecs} seconds and try again.`, {
			retry_after_seconds: retryAfterSecs
		});
	}

	inWindow.push(now);
	requestLog.set(identifier, inWindow);
}
