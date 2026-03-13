import { describe, expect, it } from "vitest";
import { buildDefaultStrategyFromLegacy } from "@/server/services/posting-strategy.service";

describe("posting-strategy.service", () => {
  it("builds a profile strategy from legacy social tracks", () => {
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
    expect(strategy.weekly_post_target).toBe(4);
    expect(strategy.cooldown_hours).toBe(18);
    expect(strategy.auto_queue_enabled).toBe(false);

    expect(strategy.pillars).toEqual([
      expect.objectContaining({
        key: "reality_like_daily",
        name: "Reality-like Daily",
        target_share_percent: 70,
        active: true,
      }),
    ]);

    expect(strategy.slot_templates).toHaveLength(4);
    expect(strategy.slot_templates.every((slot) => slot.pillar_key === "reality_like_daily")).toBe(true);
    expect(strategy.slot_templates.some((slot) => slot.post_type === "story")).toBe(true);
    expect(strategy.slot_templates.every((slot) => slot.local_time.length === 5)).toBe(true);
  });
});
