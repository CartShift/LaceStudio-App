import { describe, expect, it } from "vitest";
import { buildDefaultStrategyFromLegacy } from "@/server/services/posting-strategy.service";

describe("posting-strategy.service", () => {
  it("builds a balanced-growth strategy with reels, stories, and learned timing defaults", () => {
    const strategy = buildDefaultStrategyFromLegacy({
      profileId: "profile_123",
      timezone: "Europe/Berlin",
      socialTracksProfile: {
        reality_like_daily: {
          enabled: true,
          style_brief: "Candid lifestyle moments",
          target_ratio_percent: 70,
          weekly_post_goal: 4,
        },
        fashion_editorial: {
          enabled: false,
          style_brief: "Editorial studio portraits",
          target_ratio_percent: 30,
          weekly_post_goal: 2,
        },
      },
    });

    expect(strategy.profile_id).toBe("profile_123");
    expect(strategy.timezone).toBe("Europe/Berlin");
    expect(strategy.primary_goal).toBe("balanced_growth");
    expect(strategy.weekly_post_target).toBe(7);
    expect(strategy.weekly_feed_target).toBe(2);
    expect(strategy.weekly_reel_target).toBe(2);
    expect(strategy.weekly_story_target).toBe(3);
    expect(strategy.cooldown_hours).toBe(16);
    expect(strategy.auto_queue_enabled).toBe(true);
    expect(strategy.experimentation_rate_percent).toBe(20);
    expect(strategy.best_time_windows.length).toBeGreaterThan(0);

    expect(strategy.pillars).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "discoverability_reels",
          target_share_percent: 35,
          supported_post_types: ["reel"],
        }),
        expect.objectContaining({
          key: "editorial_identity",
          description: "Editorial studio portraits",
        }),
      ]),
    );

    expect(strategy.slot_templates).toHaveLength(7);
    expect(strategy.slot_templates.some((slot) => slot.post_type === "reel" && slot.variant_type === "reel_9x16")).toBe(true);
    expect(strategy.slot_templates.some((slot) => slot.post_type === "story")).toBe(true);
    expect(strategy.slot_templates.every((slot) => slot.local_time.length === 5)).toBe(true);
  });
});
