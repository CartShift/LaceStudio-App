import { z } from "zod";
import {
  CAMPAIGN_VIDEO_DURATION_VALUES,
  CAMPAIGN_VIDEO_SCOPE_VALUES,
} from "@/lib/campaign-video";

export const imageModelProviderSchema = z.enum(["gpu", "openai", "nano_banana_2", "zai_glm"]);

export const referenceWeightSchema = z.enum(["primary", "secondary"]);
export const referenceSourceSchema = z.enum(["pinterest_upload", "pinterest_url", "external_url"]);

export const creativeIssueTagSchema = z.enum([
  "pose_error",
  "face_drift",
  "lighting_mismatch",
  "artifact",
  "wardrobe_issue",
  "expression_mismatch",
  "composition_issue",
]);

const referenceItemSchema = z.object({
  id: z.uuid().optional(),
  source: referenceSourceSchema.default("pinterest_url"),
  url: z.url(),
  thumbnail_url: z.url().optional(),
  title: z.string().max(120).optional(),
  notes: z.string().max(240).optional(),
  weight: referenceWeightSchema.default("secondary"),
  embedding: z.array(z.number().finite()).max(64).optional(),
  similarity_score: z.number().min(0).max(1).optional(),
  version: z.int().min(1).default(1),
  created_at: z.iso.datetime().optional(),
});

const referenceVersionSchema = z.object({
  version: z.int().min(1),
  label: z.string().min(1).max(120),
  created_at: z.iso.datetime(),
  reference_ids: z.array(z.uuid()).default([]),
});

export const referenceBoardSchema = z.object({
  items: z.array(referenceItemSchema).max(40).default([]),
  active_version: z.int().min(1).default(1),
  history: z.array(referenceVersionSchema).default([]),
  preview_mode: z.enum(["split", "overlay"]).default("split"),
});

export const outfitControlsSchema = z.object({
  fabric: z.string().max(120).default("mixed premium fabrics"),
  color: z.string().max(80).default("neutral"),
  fit: z.string().max(80).default("tailored"),
  texture: z.string().max(80).default("natural detail"),
  silhouette: z.enum(["fitted", "oversized", "structured", "flowing"]).default("structured"),
  accessories: z.array(z.string().max(80)).max(12).default([]),
  material_realism: z.enum(["balanced", "enhanced", "ultra"]).default("enhanced"),
  movement_preset: z.enum(["still", "walk", "twirl", "wind"]).default("still"),
  wardrobe_lock_across_batch: z.boolean().default(false),
  micro_adjustment: z
    .object({
      hem_length: z.number().min(-1).max(1).default(0),
      sleeve_roll: z.number().min(-1).max(1).default(0),
      collar_opening: z.number().min(-1).max(1).default(0),
    })
    .default({ hem_length: 0, sleeve_roll: 0, collar_opening: 0 }),
});

export const poseControlsSchema = z.object({
  preset: z
    .enum(["editorial", "casual", "jewelry_focus", "seated", "walking"])
    .default("editorial"),
  pose_reference_url: z.url().optional(),
  controlnet_pose_lock: z.boolean().default(true),
  protect_body_proportions: z.boolean().default(true),
  limb_correction_refinement: z.boolean().default(true),
  micro_rotation: z
    .object({
      shoulder_angle: z.number().min(-1).max(1).default(0),
      hip_shift: z.number().min(-1).max(1).default(0),
      chin_tilt: z.number().min(-1).max(1).default(0),
    })
    .default({ shoulder_angle: 0, hip_shift: 0, chin_tilt: 0 }),
  batch_variation_count: z.int().min(1).max(24).default(4),
});

export const expressionControlsSchema = z.object({
  preset: z
    .enum(["neutral", "soft_smile", "intense_gaze", "contemplative", "distant"])
    .default("neutral"),
  smile_intensity: z.number().min(0).max(1).default(0.15),
  eye_focus: z.enum(["direct_gaze", "off_camera", "downward"]).default("direct_gaze"),
  brow_tension: z.number().min(0).max(1).default(0.2),
  lip_tension: z.number().min(0).max(1).default(0.2),
  consistency_across_campaign: z.boolean().default(true),
  expression_lock_mode: z.boolean().default(false),
});

export const identityConsistencySchema = z.object({
  face_embedding_lock: z.boolean().default(true),
  body_ratio_enforcement: z.boolean().default(true),
  skin_texture_mapping: z.boolean().default(true),
  hair_density_control: z.number().min(0).max(1).default(0.7),
  hair_movement_control: z.number().min(0).max(1).default(0.4),
  imperfection_persistence: z.boolean().default(true),
  rollback_version: z.int().min(1).optional(),
  drift_alert_threshold: z.number().min(0).max(1).default(0.15),
});

export const realismControlsSchema = z.object({
  skin_texture_realism: z.number().min(0).max(1).default(0.8),
  pore_detail: z.number().min(0).max(1).default(0.6),
  natural_lighting_calibration: z.number().min(0).max(1).default(0.8),
  shadow_accuracy: z.number().min(0).max(1).default(0.8),
  lens_simulation: z.enum(["35mm_doc", "50mm_portrait", "85mm_editorial", "105mm_beauty"]).default("85mm_editorial"),
  depth_of_field: z.number().min(0).max(1).default(0.45),
  noise_consistency: z.number().min(0).max(1).default(0.6),
  fabric_physics_realism: z.number().min(0).max(1).default(0.7),
  artifact_detection: z.boolean().default(true),
});

export const batchRefinementSchema = z.object({
  iterative_loop_enabled: z.boolean().default(true),
  selective_regeneration_enabled: z.boolean().default(true),
  compare_side_by_side: z.boolean().default(true),
  save_refinement_states: z.boolean().default(true),
  undo_rollback_per_image: z.boolean().default(true),
  batch_scoring_enabled: z.boolean().default(true),
});

export const aestheticControlsSchema = z.object({
  campaign_preset_id: z.uuid().optional(),
  lighting_profile_name: z.string().max(120).optional(),
  color_grading_lut_url: z.url().optional(),
  mood_tags: z.array(z.string().min(1).max(40)).max(12).default([]),
  lock_aesthetic_for_campaign: z.boolean().default(false),
});

export const moderationControlsSchema = z.object({
  require_approval: z.boolean().default(true),
  quality_score_threshold: z.number().min(0).max(100).default(82),
  auto_flag_artifacts: z.boolean().default(true),
});

export const campaignVideoControlsSchema = z.object({
  enabled: z.boolean().default(false),
  generation_scope: z.enum(CAMPAIGN_VIDEO_SCOPE_VALUES).default("all_images"),
  duration_seconds: z.union([
    z.literal(CAMPAIGN_VIDEO_DURATION_VALUES[0]),
    z.literal(CAMPAIGN_VIDEO_DURATION_VALUES[1]),
  ]).default(8),
  prompt_text: z.string().trim().max(500).optional(),
});

export const creativeControlsSchema = z.object({
  reference_board: referenceBoardSchema.default({
    items: [],
    active_version: 1,
    history: [],
    preview_mode: "split",
  }),
  outfit: outfitControlsSchema.default({
    fabric: "mixed premium fabrics",
    color: "neutral",
    fit: "tailored",
    texture: "natural detail",
    silhouette: "structured",
    accessories: [],
    material_realism: "enhanced",
    movement_preset: "still",
    wardrobe_lock_across_batch: false,
    micro_adjustment: {
      hem_length: 0,
      sleeve_roll: 0,
      collar_opening: 0,
    },
  }),
  pose: poseControlsSchema.default({
    preset: "editorial",
    controlnet_pose_lock: true,
    protect_body_proportions: true,
    limb_correction_refinement: true,
    micro_rotation: {
      shoulder_angle: 0,
      hip_shift: 0,
      chin_tilt: 0,
    },
    batch_variation_count: 4,
  }),
  expression: expressionControlsSchema.default({
    preset: "neutral",
    smile_intensity: 0.15,
    eye_focus: "direct_gaze",
    brow_tension: 0.2,
    lip_tension: 0.2,
    consistency_across_campaign: true,
    expression_lock_mode: false,
  }),
  identity: identityConsistencySchema.default({
    face_embedding_lock: true,
    body_ratio_enforcement: true,
    skin_texture_mapping: true,
    hair_density_control: 0.7,
    hair_movement_control: 0.4,
    imperfection_persistence: true,
    drift_alert_threshold: 0.15,
  }),
  realism: realismControlsSchema.default({
    skin_texture_realism: 0.8,
    pore_detail: 0.6,
    natural_lighting_calibration: 0.8,
    shadow_accuracy: 0.8,
    lens_simulation: "85mm_editorial",
    depth_of_field: 0.45,
    noise_consistency: 0.6,
    fabric_physics_realism: 0.7,
    artifact_detection: true,
  }),
  refinement: batchRefinementSchema.default({
    iterative_loop_enabled: true,
    selective_regeneration_enabled: true,
    compare_side_by_side: true,
    save_refinement_states: true,
    undo_rollback_per_image: true,
    batch_scoring_enabled: true,
  }),
  aesthetic: aestheticControlsSchema.default({
    mood_tags: [],
    lock_aesthetic_for_campaign: false,
  }),
  moderation: moderationControlsSchema.default({
    require_approval: true,
    quality_score_threshold: 82,
    auto_flag_artifacts: true,
  }),
  video: campaignVideoControlsSchema.default({
    enabled: false,
    generation_scope: "all_images",
    duration_seconds: 8,
    prompt_text: "",
  }),
});

export const imageModelConfigSchema = z.object({
  provider: imageModelProviderSchema.default("gpu"),
  model_id: z.string().min(1).max(120).optional(),
});

export const creativeControlsPatchSchema = creativeControlsSchema.partial();

export type CreativeControls = z.infer<typeof creativeControlsSchema>;
export type CreativeIssueTag = z.infer<typeof creativeIssueTagSchema>;
export type ImageModelProvider = z.infer<typeof imageModelProviderSchema>;
