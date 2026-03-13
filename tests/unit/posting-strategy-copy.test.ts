import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, buildPublishingCopyFromContextMock } = vi.hoisted(() => ({
  prismaMock: {
    postingStrategy: { findUnique: vi.fn() },
    instagramProfile: { findUnique: vi.fn() },
    postingPlanItem: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    publishingQueue: { findMany: vi.fn() },
    asset: { findMany: vi.fn() },
  },
  buildPublishingCopyFromContextMock: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

vi.mock("@/server/services/publishing-copy.service", async () => {
  const actual = await vi.importActual<typeof import("@/server/services/publishing-copy.service")>(
    "@/server/services/publishing-copy.service",
  );

  return {
    ...actual,
    buildPublishingCopyFromContext: buildPublishingCopyFromContextMock,
  };
});

import { buildDefaultStrategyFromLegacy, generatePostingPlanForProfile } from "@/server/services/posting-strategy.service";

describe("posting-strategy copy integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores structured caption packages from the smart copy service on recommended plan items", async () => {
    const now = new Date("2026-03-13T10:00:00.000Z");
    const strategyDraft = buildDefaultStrategyFromLegacy({
      profileId: "profile-1",
      timezone: "Europe/Berlin",
      socialTracksProfile: {
        reality_like_daily: {
          enabled: true,
          style_brief: "Daily style moments",
          target_ratio_percent: 55,
          weekly_post_goal: 3,
        },
        fashion_editorial: {
          enabled: true,
          style_brief: "Polished editorial fashion",
          target_ratio_percent: 45,
          weekly_post_goal: 2,
        },
      },
    });

    const strategy = {
      ...strategyDraft,
      id: "strategy-1",
      weekly_post_target: 1,
      weekly_feed_target: 1,
      weekly_reel_target: 0,
      weekly_story_target: 0,
      best_time_windows: [
        {
          weekday: 5,
          local_time: "18:00",
          daypart: "evening",
          score: 0.92,
          source: "learned" as const,
        },
      ],
      pillars: strategyDraft.pillars.map((pillar, index) => ({
        ...pillar,
        id: `pillar-${index + 1}`,
      })),
      slot_templates: [
        {
          id: "slot-1",
          pillar_key: "editorial_identity",
          label: "Friday Feed",
          weekday: 5,
          local_time: "18:00",
          daypart: "evening",
          post_type: "feed" as const,
          variant_type: "feed_4x5" as const,
          priority: 0,
          active: true,
        },
      ],
    };

    prismaMock.postingStrategy.findUnique.mockResolvedValue({
      ...strategy,
      pillars: strategy.pillars,
      slot_templates: strategy.slot_templates.map((slot) => ({
        ...slot,
        pillar: slot.pillar_key ? { key: slot.pillar_key } : null,
      })),
    });
    prismaMock.instagramProfile.findUnique.mockResolvedValue({
      id: "profile-1",
      model_id: "model-1",
      created_by: "user-1",
      handle: "@ava_stone",
      display_name: "Ava Stone",
      timezone: "Europe/Berlin",
      model: {
        name: "Ava Stone",
        personality_profile: {
          social_voice: "bold",
          temperament: "confident",
          interests: ["fashion", "styling"],
          boundaries: ["No explicit content"],
          communication_style: {
            caption_tone: "editorial",
            emoji_usage: "minimal",
            language_style: "balanced",
          },
          notes: "",
        },
        social_tracks_profile: {
          reality_like_daily: {
            enabled: true,
            style_brief: "Daily style moments",
            target_ratio_percent: 55,
            weekly_post_goal: 3,
          },
          fashion_editorial: {
            enabled: true,
            style_brief: "Polished editorial fashion",
            target_ratio_percent: 45,
            weekly_post_goal: 2,
          },
        },
      },
    });

    const captionPackage = {
      caption: "Structured smart caption",
      primary_keyword: "ava editorial",
      hook: "Structured hook",
      opening_hook: "Structured hook",
      body: "Structured body",
      call_to_action: "Structured CTA",
      hashtags: ["#AvaStyle", "#EditorialIdentity", "#FridayFeed", "#ContentStrategy", "#StyledShoot"],
      rationale: "Structured rationale",
      strategy_alignment: "Structured alignment",
      compliance_summary: "Structured compliance",
      source: "metadata_draft" as const,
    };

    buildPublishingCopyFromContextMock.mockResolvedValue({
      caption: captionPackage.caption,
      captionPackage,
      source: "metadata_draft",
    });

    let storedItem: Record<string, unknown> | null = null;
    prismaMock.postingPlanItem.findMany
      .mockResolvedValueOnce([])
      .mockImplementationOnce(async () => {
        if (!storedItem) return [];

        return [
          {
            ...storedItem,
            decided_at: null,
            asset: {
              id: "asset-1",
              sequence_number: 4,
              campaign: { id: "campaign-1", name: "Editorial Edit" },
            },
          },
        ];
      });
    prismaMock.publishingQueue.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    prismaMock.asset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        sequence_number: 4,
        prompt_text: "Editorial fashion portrait with clean daylight.",
        issue_tags: [],
        campaign: {
          id: "campaign-1",
          name: "Editorial Edit",
          prompt_text: "Clean premium editorial campaign.",
        },
        variants: [
          {
            format_type: "feed_4x5",
            media_kind: "image",
          },
        ],
      },
    ]);
    prismaMock.postingPlanItem.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      storedItem = {
        id: "plan-1",
        ...data,
      };
      return storedItem;
    });

    const result = await generatePostingPlanForProfile({
      profileId: "profile-1",
      horizonDays: 7,
      limit: 5,
      now,
    });

    expect(buildPublishingCopyFromContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "metadata_draft",
        context: expect.objectContaining({
          displayName: "Ava Stone",
          handle: "@ava_stone",
          asset: expect.objectContaining({
            promptText: "Editorial fashion portrait with clean daylight.",
            campaign: expect.objectContaining({
              promptText: "Clean premium editorial campaign.",
            }),
          }),
        }),
      }),
    );

    const createdPayload = prismaMock.postingPlanItem.create.mock.calls[0]?.[0]?.data as {
      caption_suggestion: string;
      autopilot_metadata: { caption_package?: typeof captionPackage };
    };

    expect(createdPayload.caption_suggestion).toBe("Structured smart caption");
    expect(createdPayload.autopilot_metadata.caption_package).toMatchObject({
      hook: "Structured hook",
      call_to_action: "Structured CTA",
      source: "metadata_draft",
    });

    expect(result[0]).toMatchObject({
      caption_suggestion: "Structured smart caption",
      caption_package: {
        caption: "Structured smart caption",
        hook: "Structured hook",
        body: "Structured body",
        call_to_action: "Structured CTA",
        source: "metadata_draft",
      },
    });
  });
});
