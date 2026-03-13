import type { ImageModelProvider } from "@/server/schemas/creative";

export type CampaignGenerationMode = "anchor" | "batch";

export class CampaignGenerationValidationError extends Error {
  readonly code: "INVALID_MODE_COMBINATION" | "ANCHOR_REQUIRED" | "ANCHOR_GPU_UNSUPPORTED";

  constructor(code: CampaignGenerationValidationError["code"], message: string) {
    super(message);
    this.name = "CampaignGenerationValidationError";
    this.code = code;
  }
}

export function resolveCampaignGenerationPlan(input: {
  generationMode: CampaignGenerationMode;
  isSelectiveRegeneration: boolean;
  batchSize: number;
  provider: ImageModelProvider;
  persistedAnchorAssetId?: string | null;
  requestedAnchorAssetId?: string;
}): {
  generationMode: CampaignGenerationMode;
  generationBatchSize: number;
  anchorAssetId?: string;
  shouldPersistAnchor: boolean;
  requiresAnchorValidation: boolean;
} {
  if (input.generationMode === "anchor" && input.isSelectiveRegeneration) {
    throw new CampaignGenerationValidationError(
      "INVALID_MODE_COMBINATION",
      "Anchor mode cannot be combined with single-look regeneration. Choose one mode and try again.",
    );
  }

  if (input.isSelectiveRegeneration) {
    return {
      generationMode: input.generationMode,
      generationBatchSize: input.batchSize,
      anchorAssetId: undefined,
      shouldPersistAnchor: false,
      requiresAnchorValidation: false,
    };
  }

  if (input.generationMode === "anchor") {
    return {
      generationMode: "anchor",
      generationBatchSize: 1,
      anchorAssetId: undefined,
      shouldPersistAnchor: false,
      requiresAnchorValidation: false,
    };
  }

  if (input.provider === "gpu") {
    throw new CampaignGenerationValidationError(
      "ANCHOR_GPU_UNSUPPORTED",
      "Multi-shot Run with an anchor is not available on GPU. Choose OpenAI, Nano Banana 2, or Z.AI GLM.",
    );
  }

  const anchorAssetId = input.requestedAnchorAssetId ?? input.persistedAnchorAssetId ?? undefined;
  if (!anchorAssetId) {
    throw new CampaignGenerationValidationError(
      "ANCHOR_REQUIRED",
      "An anchor look is required before a Multi-shot Run. Create one anchor look and set it first.",
    );
  }

  return {
    generationMode: "batch",
    generationBatchSize: Math.max(1, input.batchSize - 1),
    anchorAssetId,
    shouldPersistAnchor: Boolean(input.requestedAnchorAssetId),
    requiresAnchorValidation: true,
  };
}
