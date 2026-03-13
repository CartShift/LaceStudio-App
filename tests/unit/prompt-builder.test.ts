import { describe, expect, it } from "vitest";
import { buildPrompt, generateDeterministicSeeds } from "@/server/services/prompt-builder";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";

describe("prompt-builder", () => {
	it("builds prompt with optional additions", () => {
		const controls = createDefaultCreativeControls();
		controls.reference_board.items.push({
			source: "pinterest_url",
			url: "https://www.pinterest.com/pin/1234",
			weight: "primary",
			version: 1
		});

		const prompt = buildPrompt({
			modelName: "Ava",
			moodTag: "editorial luxury",
			customPromptAdditions: "high contrast shadows",
			creativeControls: controls
		});

		expect(prompt.promptText).toContain("Ava");
		expect(prompt.promptText).toContain("editorial luxury");
		expect(prompt.promptText).toContain("high contrast shadows");
		expect(prompt.promptText).toContain("primary reference");
		expect(prompt.negativePrompt.length).toBeGreaterThan(10);
	});

	it("creates deterministic seed sequence", () => {
		expect(generateDeterministicSeeds(42, 4)).toEqual([42, 84, 126, 168]);
	});
});
