import type { CreativeControls } from "@/server/schemas/creative";
import { buildCreativePromptFragments } from "@/server/services/creative-controls";

export function buildPrompt(input: {
  modelName: string;
  moodTag: string;
  customPromptAdditions?: string;
  negativePrompt?: string;
  creativeControls?: CreativeControls;
}): { promptText: string; negativePrompt: string } {
  const base = [
    `Editorial campaign of ${input.modelName}`,
    `Mood: ${input.moodTag}`,
    "Cinematic lighting, high-fidelity skin texture, premium magazine quality",
  ];

  if (input.creativeControls) {
    base.push(...buildCreativePromptFragments(input.creativeControls));
  }

  if (input.customPromptAdditions) {
    base.push(input.customPromptAdditions.trim());
  }

  const negativeClauses = [
    "deformed anatomy",
    "extra limbs",
    "blurry face",
    "low detail",
    "low contrast",
    "watermark",
  ];

  if (input.creativeControls?.realism.artifact_detection) {
    negativeClauses.push("ai artifacts", "plastic skin", "incorrect shadow geometry");
  }

  return {
    promptText: base.join(", "),
    negativePrompt: input.negativePrompt ?? negativeClauses.join(", "),
  };
}

export function generateDeterministicSeeds(baseSeed: number, batchSize: number): number[] {
  const seeds: number[] = [];
  for (let index = 0; index < batchSize; index += 1) {
    seeds.push(baseSeed + index * 42);
  }

  return seeds;
}
