import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock, prismaMock } = vi.hoisted(() => ({
  getEnvMock: vi.fn(),
  prismaMock: {
    instagramProfile: { findUnique: vi.fn() },
    postingStrategy: { findUnique: vi.fn() },
    postingPlanItem: { findUnique: vi.fn() },
    asset: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/env", () => ({
  getEnv: getEnvMock,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import { buildPublishingCopyFromContext } from "@/server/services/publishing-copy.service";
import type { PublishingCopyContext } from "@/server/services/publishing-copy.service";

describe("publishing-copy.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a structured metadata draft with caption text and hashtag caps", async () => {
    getEnvMock.mockImplementation(() => {
      throw new Error("env missing");
    });

    const result = await buildPublishingCopyFromContext({
      mode: "metadata_draft",
      context: createContext(),
    });

    expect(result.source).toBe("metadata_draft");
    expect(result.caption).toBe(result.captionPackage.caption);
    expect(result.captionPackage.source).toBe("metadata_draft");
    expect(result.captionPackage.hook.length).toBeGreaterThan(0);
    expect(result.captionPackage.body.length).toBeGreaterThan(0);
    expect(result.captionPackage.call_to_action.length).toBeGreaterThan(0);
    expect(result.captionPackage.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(result.captionPackage.hashtags.length).toBeLessThanOrEqual(8);
    expect(result.captionPackage.caption).toContain(result.captionPackage.hook);
  });

  it("uses vision output when preview is available and strips blocked phrases from the caption package", async () => {
    getEnvMock.mockReturnValue({
      ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
      ZAI_API_KEY: "zai-key",
      ZAI_VISION_MODEL: "glm-4.6v",
      ZAI_TEXT_MODEL: "glm-4.6",
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primary_keyword: "bad lighting editorial",
                  hook: "No explicit content, but this frame still lands.",
                  body: "Bad lighting disappears once the styling takes over.",
                  call_to_action: "Avoid political endorsements and send it to a friend.",
                  hashtags: ["#StoryOne", "#Bad_Lighting", "#StoryTwo", "#Explicit_Content", "#StoryThree"],
                  rationale: "Bad lighting is ignored in favor of polish.",
                  strategy_alignment: "Story coverage with bad lighting hidden.",
                  compliance_summary: "Respect boundaries.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildPublishingCopyFromContext({
      mode: "vision_refined",
      context: createContext({
        postType: "story",
        variantType: "story_9x16",
        asset: {
          id: "asset-1",
          sequenceNumber: 3,
          promptText: "Editorial portrait with clean daylight.",
          issueTags: ["bad lighting"],
          previewUrl: "https://cdn.example.com/asset-1.jpg",
          campaign: {
            id: "campaign-1",
            name: "Editorial Edit",
            promptText: "Clean editorial fashion image.",
          },
        },
      }),
    });

    expect(result.source).toBe("vision_refined");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.captionPackage.source).toBe("vision_refined");
    expect(result.captionPackage.hashtags.length).toBeLessThanOrEqual(3);
    expect(result.captionPackage.caption).not.toMatch(/explicit content|political endorsements|bad lighting/i);
    expect(result.captionPackage.primary_keyword).not.toMatch(/bad lighting/i);
    expect(result.captionPackage.hashtags.join(" ")).not.toMatch(/bad_lighting|explicit_content/i);
  });

  it("falls back to text-only metadata copy when preview is unavailable", async () => {
    getEnvMock.mockReturnValue({
      ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
      ZAI_API_KEY: "zai-key",
      ZAI_VISION_MODEL: "glm-4.6v",
      ZAI_TEXT_MODEL: "glm-4.6",
    });

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  primary_keyword: "ava editorial",
                  hook: "Metadata-driven hook.",
                  body: "This caption is based on strategy and asset metadata only.",
                  call_to_action: "Save this for later.",
                  hashtags: ["#AvaStyle", "#EditorialIdentity", "#CampaignEdit", "#Moodboard", "#SaveForLater"],
                  rationale: "Metadata fallback rationale.",
                  strategy_alignment: "Metadata fallback alignment.",
                  compliance_summary: "Metadata fallback summary.",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildPublishingCopyFromContext({
      mode: "vision_refined",
      context: createContext({
        asset: {
          id: "asset-1",
          sequenceNumber: 3,
          promptText: "Editorial portrait with clean daylight.",
          issueTags: [],
          previewUrl: null,
          campaign: {
            id: "campaign-1",
            name: "Editorial Edit",
            promptText: "Clean editorial fashion image.",
          },
        },
      }),
    });

    expect(result.source).toBe("metadata_fallback");
    expect(result.captionPackage.source).toBe("metadata_fallback");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    expect(body.model).toBe("glm-4.6");
    expect(result.captionPackage.caption).toContain("Metadata-driven hook.");
  });

  it("falls back to deterministic metadata copy when provider calls fail", async () => {
    getEnvMock.mockReturnValue({
      ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
      ZAI_API_KEY: "zai-key",
      ZAI_VISION_MODEL: "glm-4.6v",
      ZAI_TEXT_MODEL: "glm-4.6",
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("vision failed", { status: 500 }))
      .mockResolvedValueOnce(new Response("text failed", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await buildPublishingCopyFromContext({
      mode: "vision_refined",
      context: createContext(),
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.source).toBe("metadata_fallback");
    expect(result.captionPackage.source).toBe("metadata_fallback");
    expect(result.captionPackage.hashtags.length).toBeGreaterThanOrEqual(5);
    expect(result.captionPackage.hashtags.length).toBeLessThanOrEqual(8);
    expect(result.captionPackage.caption.length).toBeLessThanOrEqual(2200);
  });
});

function createContext(overrides?: Partial<PublishingCopyContext>): PublishingCopyContext {
  return {
    profileId: "11111111-1111-4111-8111-111111111111",
    displayName: "Ava Stone",
    handle: "@ava_stone",
    postType: "feed",
    variantType: "feed_4x5",
    scheduledAt: new Date("2026-03-13T16:00:00.000Z"),
    daypart: "evening",
    primaryGoal: "balanced_growth",
    strategyNotes: "Lean into premium editorial storytelling.",
    pillar: {
      key: "editorial_identity",
      name: "Editorial Identity",
      description: "Polished editorial frames that reinforce the visual brand.",
    },
    experimentTag: "feed_evening_test_1",
    personality: {
      social_voice: "bold",
      temperament: "confident",
      interests: ["fashion", "creative direction"],
      boundaries: ["No explicit content", "No political endorsements"],
      communication_style: {
        caption_tone: "editorial",
        emoji_usage: "minimal",
        language_style: "balanced",
      },
      notes: "",
    },
    socialTracks: {
      reality_like_daily: {
        enabled: true,
        style_brief: "Natural daily fashion moments.",
        prompt_bias: "candid framing, daylight",
        target_ratio_percent: 60,
        weekly_post_goal: 3,
      },
      fashion_editorial: {
        enabled: true,
        style_brief: "High-polish editorial frames.",
        prompt_bias: "clean compositions, premium lighting",
        target_ratio_percent: 40,
        weekly_post_goal: 2,
      },
    },
    asset: {
      id: "asset-1",
      sequenceNumber: 3,
      promptText: "Editorial fashion portrait in premium daylight.",
      issueTags: [],
      previewUrl: "https://cdn.example.com/asset-1.jpg",
      campaign: {
        id: "campaign-1",
        name: "Editorial Edit",
        promptText: "Premium editorial campaign prompt.",
      },
    },
    ...overrides,
  };
}
