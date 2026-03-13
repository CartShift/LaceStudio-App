export type ImageCostProvider = "gpu" | "openai" | "nano_banana_2" | "zai_glm";

export type ImageCostEstimate = {
	perImageUsd: number;
	totalUsd: number;
	totalTokens: number;
	resolutionTier: "1K" | "2K" | "4K";
	thinkingLevel: "High" | "Minimal";
	multipliers: {
		resolution: number;
		reference: number;
		thinking: number;
	};
};

export type ImageCostEstimateInput = {
	provider: ImageCostProvider;
	batchSize: number;
	width: number;
	height: number;
	referenceCount: number;
	promptLength: number;
	providerBaseCosts?: Partial<Record<ImageCostProvider, number>>;
};

export const DEFAULT_COST_PER_IMAGE_BASE: Record<ImageCostProvider, number> = {
	gpu: 0.035,
	openai: 0.17,
	nano_banana_2: 0.03,
	zai_glm: 0.08
};

export function estimateImageGenerationCost(input: ImageCostEstimateInput): ImageCostEstimate {
	const providerCost = resolveProviderBaseCost(input.provider, input.providerBaseCosts);
	const safeBatchSize = Math.max(1, Math.floor(input.batchSize));
	const safeReferenceCount = Math.max(0, Math.floor(input.referenceCount));
	const safePromptLength = Math.max(0, input.promptLength);
	const maxDim = Math.max(input.width, input.height);

	const resolution = resolveResolution(maxDim);
	const referenceMultiplier = 1 + safeReferenceCount * 0.05;
	const thinkingLevel: ImageCostEstimate["thinkingLevel"] =
		safePromptLength > 700 || safeReferenceCount >= 8 ? "High" : "Minimal";
	const thinkingMultiplier = thinkingLevel === "High" ? 1.3 : 1;

	const perImageUsd = round4(providerCost * resolution.multiplier * referenceMultiplier * thinkingMultiplier);
	const totalUsd = round4(perImageUsd * safeBatchSize);

	const promptTokens = Math.ceil(safePromptLength / 4);
	const imageTokens = safeReferenceCount * 258;
	const outputTokens = safeBatchSize * 1000;
	const totalTokens = promptTokens + imageTokens + outputTokens;

	return {
		perImageUsd,
		totalUsd,
		totalTokens,
		resolutionTier: resolution.tier,
		thinkingLevel,
		multipliers: {
			resolution: resolution.multiplier,
			reference: round4(referenceMultiplier),
			thinking: thinkingMultiplier
		}
	};
}

function resolveProviderBaseCost(provider: ImageCostProvider, overrides?: Partial<Record<ImageCostProvider, number>>): number {
	const configured = overrides?.[provider];
	if (typeof configured === "number" && Number.isFinite(configured) && configured > 0) {
		return configured;
	}

	return DEFAULT_COST_PER_IMAGE_BASE[provider];
}

function resolveResolution(maxDim: number): { multiplier: number; tier: "1K" | "2K" | "4K" } {
	if (maxDim >= 3840) {
		return { multiplier: 4, tier: "4K" };
	}

	if (maxDim >= 1920) {
		return { multiplier: 2, tier: "2K" };
	}

	return { multiplier: 1, tier: "1K" };
}

function round4(value: number): number {
	return Number(value.toFixed(4));
}
