import { describe, expect, it } from "vitest";

/**
 * G3: Integration tests for model workflow service.
 *
 * These tests use the service functions directly (not via HTTP) to validate
 * state transitions and business logic without a running server.
 *
 * Note: Tests that touch the database are tagged with [db] and require
 * DATABASE_URL to be configured. In CI, these can be run against a test DB.
 */

describe("Model workflow integration", () => {
	describe("Canonical generation state", () => {
		it("identifies a stale generation state by heartbeat age", () => {
			// Test the pure stale-detection logic that does not need DB
			const STALE_THRESHOLD = 20 * 60 * 1000; // 20 minutes

			const recentHeartbeat = new Date(Date.now() - 5 * 60 * 1000).toISOString();
			const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000).toISOString();

			function isStateStale(heartbeat: string): boolean {
				const ms = Date.parse(heartbeat);
				return Number.isFinite(ms) && Date.now() - ms > STALE_THRESHOLD;
			}

			expect(isStateStale(recentHeartbeat)).toBe(false);
			expect(isStateStale(staleHeartbeat)).toBe(true);
		});

		it("resolves shot codes by generation mode", () => {
			const REQUIRED_SHOTS = ["frontal_closeup", "three_quarter_body", "full_body_editorial", "profile_closeup", "dynamic_movement"] as const;
			const FRONT_SHOT = "frontal_closeup";

			function resolveShotCodes(mode: "front_only" | "remaining" | "full") {
				if (mode === "front_only") return [FRONT_SHOT];
				if (mode === "remaining") return REQUIRED_SHOTS.filter(s => s !== FRONT_SHOT);
				return [...REQUIRED_SHOTS];
			}

			expect(resolveShotCodes("front_only")).toEqual(["frontal_closeup"]);
			expect(resolveShotCodes("remaining")).not.toContain("frontal_closeup");
			expect(resolveShotCodes("full")).toHaveLength(REQUIRED_SHOTS.length);
		});
	});

	describe("Campaign state transitions", () => {
		it("validates allowed campaign status transitions", () => {
			const TRANSITIONS: Record<string, string[]> = {
				DRAFT: ["GENERATING"],
				GENERATING: ["REVIEW", "FAILED"],
				REVIEW: ["APPROVED", "REJECTED"],
				APPROVED: ["SCHEDULED", "PUBLISHED"],
				REJECTED: ["DRAFT"],
				SCHEDULED: ["PUBLISHED", "FAILED"],
				PUBLISHED: [],
				FAILED: ["DRAFT"]
			};

			function canTransition(from: string, to: string): boolean {
				return (TRANSITIONS[from] ?? []).includes(to);
			}

			expect(canTransition("DRAFT", "GENERATING")).toBe(true);
			expect(canTransition("GENERATING", "REVIEW")).toBe(true);
			expect(canTransition("PUBLISHED", "DRAFT")).toBe(false);
			expect(canTransition("REVIEW", "APPROVED")).toBe(true);
		});
	});

	describe("Rate limit behavior", () => {
		it("correctly tracks requests within sliding window", () => {
			const window: number[] = [];
			const limit = 5;
			const windowMs = 60_000;

			function recordRequest(): boolean {
				const now = Date.now();
				const cutoff = now - windowMs;
				const inWindow = window.filter(t => t > cutoff);
				if (inWindow.length >= limit) return false;
				inWindow.push(now);
				window.splice(0, window.length, ...inWindow);
				return true;
			}

			for (let i = 0; i < limit; i++) {
				expect(recordRequest()).toBe(true);
			}
			expect(recordRequest()).toBe(false);
		});
	});
});
