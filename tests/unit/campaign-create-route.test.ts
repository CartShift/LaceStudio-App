import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "00000000-0000-0000-0000-000000000001" })),
  assertRoleMock: vi.fn(),
  getEnvMock: vi.fn(() => ({
    IMAGE_PROVIDER_DEFAULT: "zai_glm",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
    NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
    ZAI_IMAGE_MODEL: "glm-image",
  })),
  withRateLimitMock: vi.fn(),
  listModelsMock: vi.fn(),
  getModelMock: vi.fn(),
  getDefaultCampaignMoodTagMock: vi.fn(() => "editorial luxe"),
  createCampaignMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: mocks.getSessionContextMock,
  assertRole: mocks.assertRoleMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.getEnvMock,
}));

vi.mock("@/lib/rate-limit", () => ({
  withRateLimit: mocks.withRateLimitMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: () => true,
}));

vi.mock("@/server/demo/store", () => ({
  demoStore: {
    listModels: mocks.listModelsMock,
    getModel: mocks.getModelMock,
    getDefaultCampaignMoodTag: mocks.getDefaultCampaignMoodTagMock,
    createCampaign: mocks.createCampaignMock,
  },
}));

import { POST } from "@/app/api/campaigns/route";

describe("POST /api/campaigns (demo mode)", () => {
  beforeEach(() => {
    mocks.getSessionContextMock.mockClear();
    mocks.assertRoleMock.mockClear();
    mocks.getEnvMock.mockClear();
    mocks.withRateLimitMock.mockClear();
    mocks.listModelsMock.mockReset();
    mocks.getModelMock.mockReset();
    mocks.getDefaultCampaignMoodTagMock.mockReset();
    mocks.getDefaultCampaignMoodTagMock.mockReturnValue("editorial luxe");
    mocks.createCampaignMock.mockReset();

    mocks.listModelsMock.mockReturnValue([
      { id: "11111111-1111-4111-8111-111111111111", name: "Ava Prime", status: "ACTIVE" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Nova Lux", status: "ACTIVE" },
    ]);
    mocks.getModelMock.mockImplementation((id: string) => ({
      id,
      model_versions: [{ id: `${id}-version`, is_active: true }],
    }));
    mocks.createCampaignMock.mockImplementation((input: { model_id: string; name: string; campaign_group_id?: string | null }) => ({
      id: `${input.model_id}-campaign`,
      name: input.name,
      model_id: input.model_id,
      campaign_group_id: input.campaign_group_id ?? null,
    }));
  });

  it("creates a single campaign when one model is selected", async () => {
    const response = await runCreateRequest({
      name: "SS26 Jewelry Drop",
      model_ids: ["11111111-1111-4111-8111-111111111111"],
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      id: "11111111-1111-4111-8111-111111111111-campaign",
      primary_campaign_id: "11111111-1111-4111-8111-111111111111-campaign",
      campaigns: [{ id: "11111111-1111-4111-8111-111111111111-campaign" }],
    });
    expect(mocks.createCampaignMock).toHaveBeenCalledTimes(1);
    expect(mocks.createCampaignMock.mock.calls[0]?.[0]).toMatchObject({
      name: "SS26 Jewelry Drop",
      model_id: "11111111-1111-4111-8111-111111111111",
      campaign_group_id: null,
    });
  });

  it("creates one linked campaign per selected model", async () => {
    const response = await runCreateRequest({
      name: "Holiday Capsule",
      model_ids: [
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
      ],
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      primary_campaign_id: "11111111-1111-4111-8111-111111111111-campaign",
      campaigns: [
        { id: "11111111-1111-4111-8111-111111111111-campaign", model_id: "11111111-1111-4111-8111-111111111111" },
        { id: "22222222-2222-4222-8222-222222222222-campaign", model_id: "22222222-2222-4222-8222-222222222222" },
      ],
    });

    expect(mocks.createCampaignMock).toHaveBeenCalledTimes(2);
    const firstGroupId = mocks.createCampaignMock.mock.calls[0]?.[0]?.campaign_group_id;
    expect(firstGroupId).toBeTruthy();
    expect(mocks.createCampaignMock.mock.calls[1]?.[0]).toMatchObject({
      campaign_group_id: firstGroupId,
      name: "Holiday Capsule · Nova Lux",
    });
    expect(mocks.createCampaignMock.mock.calls[0]?.[0]).toMatchObject({
      campaign_group_id: firstGroupId,
      name: "Holiday Capsule · Ava Prime",
    });
  });
});

async function runCreateRequest(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batch_size: 8,
        resolution_width: 1024,
        resolution_height: 1024,
        upscale: true,
        image_model: { provider: "zai_glm", model_id: "glm-image" },
        creative_controls: {},
        ...body,
      }),
    })
  );
}
