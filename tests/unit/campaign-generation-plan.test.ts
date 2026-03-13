import { describe, expect, it } from "vitest";
import { CampaignGenerationValidationError, resolveCampaignGenerationPlan } from "@/server/services/campaign-generation-plan";

describe("campaign-generation-plan", () => {
  it("returns anchor-mode plan with single image", () => {
    const plan = resolveCampaignGenerationPlan({
      generationMode: "anchor",
      isSelectiveRegeneration: false,
      batchSize: 8,
      provider: "nano_banana_2",
    });

    expect(plan.generationMode).toBe("anchor");
    expect(plan.generationBatchSize).toBe(1);
    expect(plan.anchorAssetId).toBeUndefined();
    expect(plan.shouldPersistAnchor).toBe(false);
  });

  it("requires anchor for non-regeneration batch mode", () => {
    expect(() =>
      resolveCampaignGenerationPlan({
        generationMode: "batch",
        isSelectiveRegeneration: false,
        batchSize: 8,
        provider: "openai",
      }),
    ).toThrowError(CampaignGenerationValidationError);
  });

  it("uses anchor and generates batch_size - 1 for batch mode", () => {
    const plan = resolveCampaignGenerationPlan({
      generationMode: "batch",
      isSelectiveRegeneration: false,
      batchSize: 8,
      provider: "openai",
      persistedAnchorAssetId: "anchor-1",
    });

    expect(plan.generationMode).toBe("batch");
    expect(plan.generationBatchSize).toBe(7);
    expect(plan.anchorAssetId).toBe("anchor-1");
    expect(plan.requiresAnchorValidation).toBe(true);
  });

  it("rejects gpu provider for anchor-based batch mode", () => {
    expect(() =>
      resolveCampaignGenerationPlan({
        generationMode: "batch",
        isSelectiveRegeneration: false,
        batchSize: 6,
        provider: "gpu",
        persistedAnchorAssetId: "anchor-1",
      }),
    ).toThrowError(CampaignGenerationValidationError);
  });

  it("keeps selective regeneration behavior unchanged", () => {
    const plan = resolveCampaignGenerationPlan({
      generationMode: "batch",
      isSelectiveRegeneration: true,
      batchSize: 6,
      provider: "gpu",
    });

    expect(plan.generationBatchSize).toBe(6);
    expect(plan.anchorAssetId).toBeUndefined();
    expect(plan.requiresAnchorValidation).toBe(false);
  });
});
