export const CAMPAIGN_VIDEO_SCOPE_VALUES = ["anchor_only", "all_images"] as const;
export const CAMPAIGN_VIDEO_DURATION_VALUES = [6, 8] as const;

export type CampaignVideoGenerationScope = (typeof CAMPAIGN_VIDEO_SCOPE_VALUES)[number];
export type CampaignVideoDurationSeconds = (typeof CAMPAIGN_VIDEO_DURATION_VALUES)[number];

export type CampaignVideoSettings = {
  enabled: boolean;
  generation_scope: CampaignVideoGenerationScope;
  duration_seconds: CampaignVideoDurationSeconds;
  prompt_text?: string | null;
};

export const DEFAULT_CAMPAIGN_VIDEO_SETTINGS: CampaignVideoSettings = {
  enabled: false,
  generation_scope: "all_images",
  duration_seconds: 8,
  prompt_text: "",
};

export function sanitizeCampaignVideoPrompt(promptText: string | null | undefined): string {
  return promptText?.trim() ?? "";
}

export function buildCampaignVideoPrompt(input: {
  campaignPromptText?: string | null;
  motionPromptText?: string | null;
  modelName?: string | null;
}): string {
  const campaignPromptText = input.campaignPromptText?.trim();
  const motionPromptText = sanitizeCampaignVideoPrompt(input.motionPromptText);

  const lines = [
    input.modelName
      ? `Create a polished 9:16 fashion reel for ${input.modelName} from this exact campaign frame.`
      : "Create a polished 9:16 fashion reel from this exact campaign frame.",
    "Preserve the exact subject identity, outfit, lighting, grading, and scene continuity established by the campaign anchor and reference board.",
    "Introduce only natural editorial motion: subtle camera drift, believable body movement, fabric response, and a clean loop-friendly finish.",
  ];

  if (campaignPromptText) {
    lines.push(`Campaign direction: ${campaignPromptText}.`);
  }

  if (motionPromptText) {
    lines.push(`Motion direction: ${motionPromptText}.`);
  }

  return lines.join(" ");
}
