import { describe, expect, it } from "vitest";
import { estimateImageGenerationCost } from "@/lib/image-cost";

describe("image-cost", () => {
	it("estimates base 1K batch cost for nano banana", () => {
		const result = estimateImageGenerationCost({
			provider: "nano_banana_2",
			batchSize: 4,
			width: 1024,
			height: 1024,
			referenceCount: 0,
			promptLength: 120
		});

		expect(result.perImageUsd).toBe(0.03);
		expect(result.totalUsd).toBe(0.12);
		expect(result.resolutionTier).toBe("1K");
		expect(result.thinkingLevel).toBe("Minimal");
	});

	it("applies reference and thinking multipliers", () => {
		const result = estimateImageGenerationCost({
			provider: "openai",
			batchSize: 2,
			width: 1024,
			height: 1024,
			referenceCount: 8,
			promptLength: 900
		});

		expect(result.thinkingLevel).toBe("High");
		expect(result.multipliers.reference).toBe(1.4);
		expect(result.multipliers.thinking).toBe(1.3);
		expect(result.totalUsd).toBe(0.6188);
	});

	it("supports custom provider base costs", () => {
		const result = estimateImageGenerationCost({
			provider: "openai",
			batchSize: 1,
			width: 1024,
			height: 1024,
			referenceCount: 0,
			promptLength: 50,
			providerBaseCosts: {
				openai: 0.1
			}
		});

		expect(result.perImageUsd).toBe(0.1);
		expect(result.totalUsd).toBe(0.1);
	});

	it("maps high resolution to 2K and 4K tiers", () => {
		const twoK = estimateImageGenerationCost({
			provider: "gpu",
			batchSize: 1,
			width: 2048,
			height: 1536,
			referenceCount: 0,
			promptLength: 80
		});
		const fourK = estimateImageGenerationCost({
			provider: "gpu",
			batchSize: 1,
			width: 4096,
			height: 2160,
			referenceCount: 0,
			promptLength: 80
		});

		expect(twoK.resolutionTier).toBe("2K");
		expect(twoK.multipliers.resolution).toBe(2);
		expect(fourK.resolutionTier).toBe("4K");
		expect(fourK.multipliers.resolution).toBe(4);
	});

	it("supports z.ai glm provider pricing", () => {
		const result = estimateImageGenerationCost({
			provider: "zai_glm",
			batchSize: 2,
			width: 1024,
			height: 1024,
			referenceCount: 0,
			promptLength: 120
		});

		expect(result.perImageUsd).toBe(0.08);
		expect(result.totalUsd).toBe(0.16);
	});
});
