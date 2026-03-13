import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionContextMock, assertRoleMock, isDemoModeMock, generatePublishingCopyMock, buildPublishingCopyFromContextMock } = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "user-1" })),
  assertRoleMock: vi.fn(),
  isDemoModeMock: vi.fn(() => false),
  generatePublishingCopyMock: vi.fn(),
  buildPublishingCopyFromContextMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: getSessionContextMock,
  assertRole: assertRoleMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: isDemoModeMock,
}));

vi.mock("@/server/services/publishing-copy.service", () => ({
  generatePublishingCopy: generatePublishingCopyMock,
  buildPublishingCopyFromContext: buildPublishingCopyFromContextMock,
}));

import { POST } from "@/app/api/publishing/copy/generate/route";

describe("POST /api/publishing/copy/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoModeMock.mockReturnValue(false);
    generatePublishingCopyMock.mockResolvedValue(createCopyResult("vision_refined"));
    buildPublishingCopyFromContextMock.mockResolvedValue(createCopyResult("metadata_fallback"));
  });

  it("calls the live copy service and returns the generated payload", async () => {
    const response = await POST(
      new Request("http://localhost/api/publishing/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: "11111111-1111-4111-8111-111111111111",
          plan_item_id: "22222222-2222-4222-8222-222222222222",
          asset_id: "33333333-3333-4333-8333-333333333333",
          post_type: "feed",
          variant_type: "feed_4x5",
          scheduled_at: "2026-03-14T10:30:00.000Z",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      caption: "Smart caption",
      source: "vision_refined",
      caption_package: {
        source: "vision_refined",
      },
    });
    expect(generatePublishingCopyMock).toHaveBeenCalledTimes(1);

    const input = generatePublishingCopyMock.mock.calls[0]?.[0] as { scheduledAt?: Date; profileId: string; planItemId?: string };
    expect(input.profileId).toBe("11111111-1111-4111-8111-111111111111");
    expect(input.planItemId).toBe("22222222-2222-4222-8222-222222222222");
    expect(input.scheduledAt).toBeInstanceOf(Date);
    expect(input.scheduledAt?.toISOString()).toBe("2026-03-14T10:30:00.000Z");
  });

  it("uses the demo builder when demo mode is enabled", async () => {
    isDemoModeMock.mockReturnValue(true);

    const response = await POST(
      new Request("http://localhost/api/publishing/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: "11111111-1111-4111-8111-111111111111",
          post_type: "story",
          variant_type: "story_9x16",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      source: "metadata_fallback",
      caption_package: {
        source: "metadata_fallback",
      },
    });
    expect(buildPublishingCopyFromContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "vision_refined",
      }),
    );
    expect(generatePublishingCopyMock).not.toHaveBeenCalled();
  });

  it("returns a validation error for invalid payloads", async () => {
    const response = await POST(
      new Request("http://localhost/api/publishing/copy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: "not-a-uuid",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(generatePublishingCopyMock).not.toHaveBeenCalled();
  });
});

function createCopyResult(source: "metadata_draft" | "vision_refined" | "metadata_fallback") {
  return {
    caption: "Smart caption",
    source,
    captionPackage: {
      caption: "Smart caption",
      primary_keyword: "ava editorial",
      hook: "Hook",
      opening_hook: "Hook",
      body: "Body",
      call_to_action: "CTA",
      hashtags: ["#AvaStyle"],
      rationale: "Rationale",
      strategy_alignment: "Alignment",
      compliance_summary: "Compliance",
      source,
    },
  };
}
