import {
  DEFAULT_CAMPAIGN_VIDEO_SETTINGS,
  sanitizeCampaignVideoPrompt,
  type CampaignVideoSettings,
} from "@/lib/campaign-video";
import type { CreativeControls } from "@/server/schemas/creative";
import type { CampaignGenerationMode } from "@/server/services/campaign-generation-plan";

export function resolveCampaignVideoSettings(
  controls: Pick<CreativeControls, "video"> | CreativeControls | null | undefined,
): CampaignVideoSettings {
  const video = controls?.video;

  return {
    enabled: video?.enabled ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.enabled,
    generation_scope: video?.generation_scope ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.generation_scope,
    duration_seconds: video?.duration_seconds ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.duration_seconds,
    prompt_text: sanitizeCampaignVideoPrompt(video?.prompt_text),
  };
}

export function selectCampaignVideoAssetIds(input: {
  videoSettings: CampaignVideoSettings;
  generationMode: CampaignGenerationMode;
  assetIds: string[];
}): string[] {
  if (!input.videoSettings.enabled) {
    return [];
  }

  if (input.videoSettings.generation_scope === "anchor_only" && input.generationMode !== "anchor") {
    return [];
  }

  return input.assetIds;
}
