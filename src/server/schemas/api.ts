import { z } from "zod";
import {
  creativeControlsPatchSchema,
  creativeControlsSchema,
  creativeIssueTagSchema,
  imageModelConfigSchema,
  referenceSourceSchema,
  referenceWeightSchema,
} from "@/server/schemas/creative";
import {
  personalityProfileSchema,
  socialTracksSchema,
} from "@/server/schemas/model-workflow";
import {
  instagramProfileCreateSchema,
  generatePublishingCopySchema,
  recommendationAcceptSchema,
  recommendationSkipSchema,
  postingStrategyInputSchema,
  postTypeSchema,
  variantTypeSchema,
} from "@/server/schemas/instagram-publishing";

export const uuidSchema = z.uuid();

export const modelCreateSchema = z.object({
  name: z.string().min(2).max(50),
  description: z.string().max(500).optional(),
});

export const modelUpdateSchema = z.object({
  name: z.string().min(2).max(50).optional(),
  description: z.string().max(500).optional(),
  body_profile: z.record(z.string(), z.unknown()).optional(),
  face_profile: z.record(z.string(), z.unknown()).optional(),
  imperfection_fingerprint: z.array(z.record(z.string(), z.unknown())).optional(),
  personality_profile: personalityProfileSchema.optional(),
  social_tracks_profile: socialTracksSchema.optional(),
  onboarding_state: z.record(z.string(), z.unknown()).optional(),
});

export const campaignCreateSchema = z.object({
  name: z.string().max(200).optional(),
  model_id: uuidSchema,
  product_asset_url: z.string().url().optional(),
  batch_size: z.int().min(1).max(12).default(8),
  resolution_width: z.int().default(1024),
  resolution_height: z.int().default(1024),
  upscale: z.boolean().default(true),
  custom_prompt_additions: z.string().optional(),
  negative_prompt: z.string().optional(),
  image_model: imageModelConfigSchema.optional(),
  creative_controls: creativeControlsSchema.optional(),
});

export const generateCampaignSchema = z
  .object({
    prompt_text: z.string().min(1),
    generation_mode: z.enum(["anchor", "batch"]).default("batch"),
    anchor_asset_id: uuidSchema.optional(),
    creative_controls_override: creativeControlsPatchSchema.optional(),
    regenerate_asset_id: uuidSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.generation_mode === "anchor" && value.regenerate_asset_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["regenerate_asset_id"],
        message: "You can't use regenerate_asset_id when generation_mode is anchor.",
      });
    }
  });

export const reviewAssetSchema = z.object({
  action: z.enum(["approve", "reject", "flag"]).default("approve"),
  quality_score: z.number().min(0).max(100).optional(),
  notes: z.string().max(1000).optional(),
  issue_tags: z.array(creativeIssueTagSchema).max(10).default([]),
  flag_artifacts: z.boolean().default(false),
});

export const campaignCreativeUpdateSchema = z.object({
  creative_controls: creativeControlsPatchSchema,
});

export const campaignReferenceAddSchema = z.object({
  source: referenceSourceSchema.default("pinterest_url"),
  url: z.url(),
  thumbnail_url: z.url().optional(),
  title: z.string().max(120).optional(),
  notes: z.string().max(240).optional(),
  weight: referenceWeightSchema.default("secondary"),
});

export const assetRefineSchema = z.object({
  reason: z.string().max(300).optional(),
  prompt_text: z.string().min(1).optional(),
  outfit_micro_adjustment: z
    .object({
      hem_length: z.number().min(-1).max(1).optional(),
      sleeve_roll: z.number().min(-1).max(1).optional(),
      collar_opening: z.number().min(-1).max(1).optional(),
    })
    .optional(),
  pose_micro_rotation: z
    .object({
      shoulder_angle: z.number().min(-1).max(1).optional(),
      hip_shift: z.number().min(-1).max(1).optional(),
      chin_tilt: z.number().min(-1).max(1).optional(),
    })
    .optional(),
  expression_micro_adjustment: z
    .object({
      smile_intensity: z.number().min(0).max(1).optional(),
      brow_tension: z.number().min(0).max(1).optional(),
      lip_tension: z.number().min(0).max(1).optional(),
    })
    .optional(),
  realism_tuning: z
    .object({
      skin_texture_realism: z.number().min(0).max(1).optional(),
      shadow_accuracy: z.number().min(0).max(1).optional(),
      depth_of_field: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export const schedulePostSchema = z.object({
  asset_id: uuidSchema,
  profile_id: uuidSchema,
  plan_item_id: uuidSchema.optional(),
  variant_type: variantTypeSchema,
  post_type: postTypeSchema,
  caption: z.string().min(1).max(2200),
  hashtag_preset_id: uuidSchema.optional(),
  scheduled_at: z.iso.datetime(),
});

export const createReelVariantSchema = z.object({
  prompt_text: z.string().trim().min(8).max(1200).optional(),
  duration_seconds: z.number().int().min(6).max(8).default(8),
  variant_id: uuidSchema.optional(),
});

export const rejectPublishingSchema = z.object({
  reason: z.string().min(3),
});

export const gpuWebhookAssetSchema = z.object({
  file_path: z.string().min(1),
  seed: z.int(),
  width: z.int(),
  height: z.int(),
  generation_time_ms: z.int(),
  prompt_text: z.string(),
});

export const gpuWebhookPayloadSchema = z.object({
  job_id: uuidSchema,
  status: z.enum(["completed", "failed"]),
  error_message: z.string().optional(),
  assets: z.array(gpuWebhookAssetSchema).default([]),
  total_generation_time_ms: z.int().optional(),
  gpu_type: z.string().optional(),
});

export const clientCreateSchema = z.object({
  name: z.string().min(2).max(120),
  notes: z.string().optional(),
  status: z.string().default("active"),
});

export const brandCreateSchema = z.object({
  client_id: uuidSchema,
  name: z.string().min(2).max(120),
  visual_direction: z.record(z.string(), z.unknown()).optional(),
  voice_notes: z.string().optional(),
});

export const revenueContractCreateSchema = z.object({
  client_id: uuidSchema,
  contract_type: z.enum(["RETAINER", "RETAINER_PLUS_BONUS"]).default("RETAINER_PLUS_BONUS"),
  monthly_retainer_usd: z.number().min(0),
  starts_at: z.iso.datetime(),
  ends_at: z.iso.datetime().optional(),
});

export const revenueEntryCreateSchema = z.object({
  contract_id: uuidSchema,
  type: z.enum(["RETAINER", "BONUS", "ADJUSTMENT"]),
  amount_usd: z.number(),
  reference_month: z.iso.datetime(),
  notes: z.string().optional(),
});

export {
  instagramProfileCreateSchema,
  generatePublishingCopySchema,
  postingStrategyInputSchema,
  recommendationAcceptSchema,
  recommendationSkipSchema,
};
