import { beforeEach, describe, expect, it } from "vitest";
import { demoStore } from "@/server/demo/store";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";
import type { ImageModelProvider } from "@/server/schemas/creative";

describe("demoStore anchor-first campaign generation", () => {
  beforeEach(() => {
    (globalThis as { laceStudioDemoStore?: unknown }).laceStudioDemoStore = undefined;
  });

  it("sets campaign anchor from existing campaign asset", () => {
    const campaign = createCampaign("openai", 6);

    const anchorRun = demoStore.generateCampaign(campaign.id, "Anchor shot", undefined, undefined, "anchor");
    expect(anchorRun).not.toBeNull();

    const detailAfterAnchor = demoStore.getCampaign(campaign.id);
    const anchorAssetId = detailAfterAnchor?.assets[0]?.id;
    expect(anchorAssetId).toBeTruthy();

    const setAnchor = demoStore.setCampaignAnchor(campaign.id, anchorAssetId!);
    expect(setAnchor).toEqual({
      campaign_id: campaign.id,
      anchor_asset_id: anchorAssetId,
    });

    const detailAfterSet = demoStore.getCampaign(campaign.id);
    expect(detailAfterSet?.anchor_asset_id).toBe(anchorAssetId);
  });

  it("requires anchor before batch generation", () => {
    const campaign = createCampaign("openai", 5);

    const batchRun = demoStore.generateCampaign(campaign.id, "Batch shot", undefined, undefined, "batch");
    expect(batchRun).toBeNull();
  });

  it("generates batch_size - 1 images for batch mode after anchor is set", () => {
    const campaign = createCampaign("nano_banana_2", 5);

    const anchorRun = demoStore.generateCampaign(campaign.id, "Anchor shot", undefined, undefined, "anchor");
    expect(anchorRun).not.toBeNull();

    const anchorAssetId = demoStore.getCampaign(campaign.id)?.assets[0]?.id;
    expect(anchorAssetId).toBeTruthy();

    const setAnchor = demoStore.setCampaignAnchor(campaign.id, anchorAssetId!);
    expect(setAnchor?.anchor_asset_id).toBe(anchorAssetId);

    const batchRun = demoStore.generateCampaign(campaign.id, "Batch shots", undefined, undefined, "batch", anchorAssetId);
    expect(batchRun).not.toBeNull();

    const detail = demoStore.getCampaign(campaign.id);
    expect(detail?.assets).toHaveLength(5);
  });

  it("blocks anchor-based batch generation for gpu provider", () => {
    const campaign = createCampaign("gpu", 6);

    const anchorRun = demoStore.generateCampaign(campaign.id, "Anchor shot", undefined, undefined, "anchor");
    expect(anchorRun).not.toBeNull();

    const anchorAssetId = demoStore.getCampaign(campaign.id)?.assets[0]?.id;
    expect(anchorAssetId).toBeTruthy();

    const setAnchor = demoStore.setCampaignAnchor(campaign.id, anchorAssetId!);
    expect(setAnchor?.anchor_asset_id).toBe(anchorAssetId);

    const batchRun = demoStore.generateCampaign(campaign.id, "Batch shots", undefined, undefined, "batch", anchorAssetId);
    expect(batchRun).toBeNull();
  });
});

function createCampaign(provider: ImageModelProvider, batchSize: number) {
  const model = demoStore.listModels().find(item => item.status === "ACTIVE") ?? demoStore.listModels()[0];

  if (!model) {
    throw new Error("Demo seed data is missing active model");
  }

  return demoStore.createCampaign({
    name: `Campaign ${provider}`,
    model_id: model.id,
    batch_size: batchSize,
    resolution_width: 1024,
    resolution_height: 1024,
    upscale: true,
    prompt_text: "Editorial campaign",
    image_model_provider: provider,
    image_model_id:
      provider === "gpu"
        ? "sdxl-1.0"
        : provider === "openai"
          ? "gpt-image-1"
          : provider === "zai_glm"
            ? "glm-image"
            : "gemini-3.1-flash-image-preview",
    creative_controls: createDefaultCreativeControls(),
    userId: model.created_by,
  });
}
