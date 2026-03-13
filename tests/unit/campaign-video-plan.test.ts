import { describe, expect, it } from "vitest";
import { resolveCampaignVideoSettings, selectCampaignVideoAssetIds } from "@/server/services/campaign-video-plan";

describe("campaign-video-plan", () => {
  it("returns the default disabled settings when video controls are absent", () => {
    expect(resolveCampaignVideoSettings(null)).toMatchObject({
      enabled: false,
      generation_scope: "all_images",
      duration_seconds: 8,
      prompt_text: "",
    });
  });

  it("skips batch-mode video jobs when the plan is anchor only", () => {
    const assetIds = selectCampaignVideoAssetIds({
      videoSettings: {
        enabled: true,
        generation_scope: "anchor_only",
        duration_seconds: 8,
        prompt_text: "",
      },
      generationMode: "batch",
      assetIds: ["asset-1", "asset-2"],
    });

    expect(assetIds).toHaveLength(0);
  });

  it("keeps all generated assets when videos are enabled for the whole run", () => {
    const assetIds = selectCampaignVideoAssetIds({
      videoSettings: {
        enabled: true,
        generation_scope: "all_images",
        duration_seconds: 6,
        prompt_text: "slow luxury pacing",
      },
      generationMode: "batch",
      assetIds: ["asset-1", "asset-2"],
    });

    expect(assetIds).toEqual(["asset-1", "asset-2"]);
  });
});
