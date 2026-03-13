import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "00000000-0000-0000-0000-000000000001" })),
  assertRoleMock: vi.fn(),
  getEnvMock: vi.fn(() => ({
    NEXT_PUBLIC_APP_URL: "https://app.example.com",
    GPU_WEBHOOK_SECRET: "secret",
  })),
  getCampaignMock: vi.fn(),
  setCampaignAnchorMock: vi.fn(),
  generateCampaignMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: mocks.getSessionContextMock,
  assertRole: mocks.assertRoleMock,
}));

vi.mock("@/lib/env", () => ({
  getEnv: mocks.getEnvMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: () => true,
}));

vi.mock("@/server/demo/store", () => ({
  demoStore: {
    getCampaign: mocks.getCampaignMock,
    setCampaignAnchor: mocks.setCampaignAnchorMock,
    generateCampaign: mocks.generateCampaignMock,
  },
}));

import { POST, buildModelIdentityReferences } from "@/app/api/campaigns/[id]/generate/route";

describe("POST /api/campaigns/[id]/generate (demo mode)", () => {
  beforeEach(() => {
    mocks.getSessionContextMock.mockClear();
    mocks.assertRoleMock.mockClear();
    mocks.getEnvMock.mockClear();
    mocks.getCampaignMock.mockReset();
    mocks.setCampaignAnchorMock.mockReset();
    mocks.generateCampaignMock.mockReset();

    mocks.setCampaignAnchorMock.mockReturnValue({
      campaign_id: "11111111-1111-4111-8111-111111111111",
      anchor_asset_id: "22222222-2222-4222-8222-222222222222",
    });
    mocks.generateCampaignMock.mockReturnValue({
      job_id: "job-1",
      campaign_status: "GENERATING",
      identity_drift_alert: false,
      anchor_asset_id: null,
    });
  });

  it("runs anchor generation mode", async () => {
    mocks.getCampaignMock.mockReturnValue(createDemoCampaign());

    const response = await runGenerateRequest({
      prompt_text: "Anchor prompt",
      generation_mode: "anchor",
    });

    expect(response.status).toBe(202);
    expect(mocks.generateCampaignMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.any(String),
      undefined,
      undefined,
      "anchor",
      undefined,
    );
  });

  it("fails batch generation when anchor is missing", async () => {
    mocks.getCampaignMock.mockReturnValue(createDemoCampaign({ anchor_asset_id: null, assets: [] }));

    const response = await runGenerateRequest({
      prompt_text: "Batch prompt",
      generation_mode: "batch",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(mocks.generateCampaignMock).not.toHaveBeenCalled();
  });

  it("fails batch generation for gpu provider", async () => {
    mocks.getCampaignMock.mockReturnValue(
      createDemoCampaign({
        image_model_provider: "gpu",
        anchor_asset_id: "22222222-2222-4222-8222-222222222222",
      }),
    );

    const response = await runGenerateRequest({
      prompt_text: "Batch prompt",
      generation_mode: "batch",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
      },
    });
    expect(mocks.generateCampaignMock).not.toHaveBeenCalled();
  });

  it("uses explicit anchor_asset_id for batch generation and persists it", async () => {
    mocks.getCampaignMock.mockReturnValue(
      createDemoCampaign({
        anchor_asset_id: null,
        assets: [
          {
            id: "22222222-2222-4222-8222-222222222222",
            sequence_number: 1,
          },
        ],
      }),
    );

    const response = await runGenerateRequest({
      prompt_text: "Batch prompt",
      generation_mode: "batch",
      anchor_asset_id: "22222222-2222-4222-8222-222222222222",
    });

    expect(response.status).toBe(202);
    expect(mocks.setCampaignAnchorMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    expect(mocks.generateCampaignMock).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.any(String),
      undefined,
      undefined,
      "batch",
      "22222222-2222-4222-8222-222222222222",
    );
  });

  it("reports when matching video generation is planned for the run", async () => {
    mocks.getCampaignMock.mockReturnValue(createDemoCampaign());

    const response = await runGenerateRequest({
      prompt_text: "Anchor prompt",
      generation_mode: "anchor",
      creative_controls_override: {
        video: {
          enabled: true,
          generation_scope: "all_images",
          duration_seconds: 6,
        },
      },
    });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      video_generation_planned: true,
      video_generation_scope: "all_images",
      video_generation_duration_seconds: 6,
    });
  });
});

describe("buildModelIdentityReferences", () => {
  it("appends imported references after canonical references", () => {
    const result = buildModelIdentityReferences(
      2,
      [
        {
          pack_version: 2,
          sort_order: 0,
          shot_code: "frontal_closeup",
          reference_image_url: "gs://bucket/canonical-1.png",
        },
      ],
      [
        {
          sort_order: 0,
          image_gcs_uri: "gs://bucket/imported-1.png",
        },
      ],
    );

    expect(result).toHaveLength(2);
    expect(result[0]?.origin).toBe("model_identity");
    expect(result[1]?.origin).toBe("model_imported");
  });

  it("caps imported references to configured maximum", () => {
    const imported = Array.from({ length: 8 }, (_, index) => ({
      sort_order: index,
      image_gcs_uri: `gs://bucket/imported-${index + 1}.png`,
    }));

    const result = buildModelIdentityReferences(0, [], imported);
    expect(result).toHaveLength(4);
    expect(result[0]?.weight).toBe("primary");
    expect(result[3]?.origin).toBe("model_imported");
  });
});

async function runGenerateRequest(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/campaigns/11111111-1111-4111-8111-111111111111/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "11111111-1111-4111-8111-111111111111" }) },
  );
}

function createDemoCampaign(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    status: "REVIEW",
    batch_size: 8,
    image_model_provider: "openai",
    anchor_asset_id: "22222222-2222-4222-8222-222222222222",
    prompt_text: "Editorial campaign",
    creative_controls: createDefaultCreativeControls(),
    assets: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        sequence_number: 1,
      },
    ],
    ...overrides,
  };
}
