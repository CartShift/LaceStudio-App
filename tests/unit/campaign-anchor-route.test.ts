import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "00000000-0000-0000-0000-000000000001" })),
  assertRoleMock: vi.fn(),
  getCampaignMock: vi.fn(),
  setCampaignAnchorMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: mocks.getSessionContextMock,
  assertRole: mocks.assertRoleMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: () => true,
}));

vi.mock("@/server/demo/store", () => ({
  demoStore: {
    getCampaign: mocks.getCampaignMock,
    setCampaignAnchor: mocks.setCampaignAnchorMock,
  },
}));

import { PATCH } from "@/app/api/campaigns/[id]/anchor/route";

describe("PATCH /api/campaigns/[id]/anchor", () => {
  beforeEach(() => {
    mocks.getSessionContextMock.mockClear();
    mocks.assertRoleMock.mockClear();
    mocks.getCampaignMock.mockReset();
    mocks.setCampaignAnchorMock.mockReset();
  });

  it("sets anchor when campaign and asset exist", async () => {
    const campaignId = "11111111-1111-4111-8111-111111111111";
    const assetId = "22222222-2222-4222-8222-222222222222";

    mocks.getCampaignMock.mockReturnValue({ id: campaignId });
    mocks.setCampaignAnchorMock.mockReturnValue({
      campaign_id: campaignId,
      anchor_asset_id: assetId,
    });

    const response = await PATCH(
      new Request(`http://localhost/api/campaigns/${campaignId}/anchor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: assetId }),
      }),
      { params: Promise.resolve({ id: campaignId }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      campaign_id: campaignId,
      anchor_asset_id: assetId,
    });
  });

  it("returns not found when asset does not belong to campaign", async () => {
    const campaignId = "11111111-1111-4111-8111-111111111111";
    const assetId = "22222222-2222-4222-8222-222222222222";

    mocks.getCampaignMock.mockReturnValue({ id: campaignId });
    mocks.setCampaignAnchorMock.mockReturnValue(null);

    const response = await PATCH(
      new Request(`http://localhost/api/campaigns/${campaignId}/anchor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset_id: assetId }),
      }),
      { params: Promise.resolve({ id: campaignId }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "NOT_FOUND",
      },
    });
  });
});
