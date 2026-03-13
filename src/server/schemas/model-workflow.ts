import { z } from "zod";
import { imageModelProviderSchema } from "@/server/schemas/creative";

export const modelWorkflowStepSchema = z.enum(["character_design", "personality", "social_strategy"]);
export const photoImportStatusSchema = z.enum(["IDLE", "UPLOADING", "ANALYZING", "READY", "FAILED"]);

export const canonicalPackTemplateSchema = z.enum(["balanced_8"]);
export const canonicalPackStyleSchema = z.enum(["strict_studio"]);
export const canonicalGenerationModeSchema = z.enum(["front_only", "remaining", "full"]);

export const canonicalShotCodeSchema = z.enum([
	"frontal_closeup",
	"left45_closeup",
	"right45_closeup",
	"neutral_head_shoulders",
	"half_body_front",
	"full_body_front",
	"soft_smile_closeup",
	"serious_closeup"
]);

const bodyProfileSchema = z.object({
	height_cm: z.number().int().min(130).max(230),
	build: z.enum(["petite", "slim", "athletic", "curvy", "muscular", "average"]),
	skin_tone: z.string().min(2).max(60),
	hair_color: z.string().min(2).max(60),
	hair_length: z.enum(["shaved", "short", "medium", "long", "very_long"]),
	hair_style: z.string().min(2).max(80),
	eye_color: z.string().min(2).max(40),
	distinguishing_features: z.array(z.string().min(2).max(120)).max(10).default([]),
	advanced_traits: z
		.object({
			shoulder_width: z.enum(["narrow", "balanced", "broad"]).default("balanced"),
			body_ratio_notes: z.string().max(240).optional(),
			posture_signature: z.string().max(120).optional()
		})
		.default({
			shoulder_width: "balanced"
		})
});

const faceProfileSchema = z.object({
	face_shape: z.enum(["oval", "round", "square", "heart", "diamond", "oblong"]),
	jawline: z.enum(["soft", "defined", "angular"]),
	nose_profile: z.enum(["straight", "aquiline", "button", "wide", "narrow"]),
	lip_profile: z.enum(["thin", "balanced", "full"]),
	brow_profile: z.enum(["straight", "arched", "soft_arch"]),
	eye_spacing: z.enum(["close", "balanced", "wide"]),
	eye_shape: z.enum(["almond", "round", "hooded", "monolid"]),
	forehead_height: z.enum(["short", "balanced", "tall"]),
	cheekbones: z.enum(["soft", "defined", "prominent"]),
	advanced_traits: z
		.object({
			smile_signature: z.string().max(160).optional(),
			gaze_signature: z.string().max(160).optional(),
			micro_asymmetry_notes: z.string().max(240).optional()
		})
		.default({})
});

const imperfectionEntrySchema = z.object({
	type: z.string().min(2).max(80),
	location: z.string().min(2).max(120),
	intensity: z.number().min(0).max(1)
});

export const characterDesignSchema = z.object({
	body_profile: bodyProfileSchema,
	face_profile: faceProfileSchema,
	imperfection_fingerprint: z.array(imperfectionEntrySchema).max(5).default([])
});

export const personalityProfileSchema = z.object({
	social_voice: z.enum(["warm", "witty", "playful", "minimal", "bold"]),
	temperament: z.enum(["calm", "energetic", "mysterious", "confident", "soft"]),
	interests: z.array(z.string().min(2).max(80)).max(20).default([]),
	boundaries: z.array(z.string().min(2).max(120)).max(20).default([]),
	communication_style: z.object({
		caption_tone: z.enum(["casual", "editorial", "storytelling", "aspirational"]),
		emoji_usage: z.enum(["none", "minimal", "moderate"]).default("minimal"),
		language_style: z.enum(["concise", "balanced", "expressive"]).default("balanced")
	}),
	notes: z.string().max(600).optional()
});

const socialTrackConfigSchema = z.object({
	enabled: z.boolean().default(true),
	style_brief: z.string().min(3).max(260),
	prompt_bias: z.string().max(240).optional(),
	target_ratio_percent: z.number().int().min(0).max(100),
	weekly_post_goal: z.number().int().min(0).max(21).default(3)
});

export const socialTracksSchema = z
	.object({
		reality_like_daily: socialTrackConfigSchema,
		fashion_editorial: socialTrackConfigSchema,
		instagram_setup: z
			.object({
				handle: z.string().min(1).max(30).optional(),
				connected_at: z.string().optional()
			})
			.optional()
	})
	.superRefine((value, ctx) => {
		const total = value.reality_like_daily.target_ratio_percent + value.fashion_editorial.target_ratio_percent;

		if (total !== 100) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "The two content track ratios must add up to 100.",
				path: ["reality_like_daily", "target_ratio_percent"]
			});
		}
	});

export const workflowPatchSchema = z.discriminatedUnion("step", [
	z.object({
		step: z.literal("character_design"),
		payload: characterDesignSchema
	}),
	z.object({
		step: z.literal("personality"),
		payload: personalityProfileSchema
	}),
	z.object({
		step: z.literal("social_strategy"),
		payload: socialTracksSchema
	})
]);

export const canonicalPackGenerateSchema = z.object({
	provider: imageModelProviderSchema.default("zai_glm"),
	model_id: z.string().min(1).max(120).optional(),
	pack_template: canonicalPackTemplateSchema.default("balanced_8"),
	candidates_per_shot: z.int().min(1).max(5).default(3),
	style: canonicalPackStyleSchema.default("strict_studio"),
	generation_mode: canonicalGenerationModeSchema.default("front_only"),
	pack_version: z.coerce.number().int().positive().optional()
});

export const canonicalPackUploadSchema = z.object({
	image_data_url: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/),
	shot_code: canonicalShotCodeSchema,
	candidate_index: z.coerce.number().int().positive().optional(),
	pack_version: z.coerce.number().int().positive().optional()
});

export const canonicalPackReadSchema = z.object({
	pack_version: z.coerce.number().int().positive().optional()
});

export const canonicalPackApproveSchema = z
	.object({
		pack_version: z.int().positive(),
		selections: z.array(
			z.object({
				shot_code: canonicalShotCodeSchema,
				candidate_id: z.uuid()
			})
		)
	})
	.superRefine((value, ctx) => {
		if (value.selections.length !== 8) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Select exactly 8 options, one for each reference angle.",
				path: ["selections"]
			});
		}

		const uniqueShots = new Set(value.selections.map(item => item.shot_code));
		if (uniqueShots.size !== value.selections.length) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: "Each reference angle can only be selected once.",
				path: ["selections"]
			});
		}
	});

export const canonicalPackFrontApproveSchema = z.object({
	pack_version: z.int().positive(),
	candidate_id: z.uuid()
});

export const workflowFinalizeSchema = z.object({});

export const photoImportStartOptionsSchema = z.object({
	keep_as_references: z.boolean().default(true),
	auto_generate_on_apply: z.boolean().default(false),
	canonical_provider: imageModelProviderSchema.optional(),
	canonical_model_id: z.string().min(1).max(120).optional(),
	canonical_candidates_per_shot: z.coerce.number().int().min(1).max(5).default(1)
});

export const photoImportSuggestionSchema = z.object({
	character_design: characterDesignSchema,
	personality: personalityProfileSchema,
	social_strategy: socialTracksSchema,
	confidence: z.object({
		character_design: z.number().min(0).max(1),
		personality: z.number().min(0).max(1),
		social_strategy: z.number().min(0).max(1)
	}),
	warnings: z.array(z.string().min(1).max(240)).max(20).default([]),
	image_reviews: z
		.array(
			z.object({
				reference_id: z.uuid(),
				accepted: z.boolean(),
				reason: z.string().max(240).optional(),
				solo_subject: z.boolean().optional(),
				face_visible: z.boolean().optional()
			})
		)
		.default([])
});

const photoImportApplySectionsSchema = z
	.array(modelWorkflowStepSchema)
	.min(1)
	.max(3)
	.default(["character_design", "personality", "social_strategy"])
	.transform(value => Array.from(new Set(value)));

export const photoImportApplySchema = z.object({
	sections: photoImportApplySectionsSchema.optional(),
	start_canonical_generation: z.boolean().optional(),
	canonical_provider: imageModelProviderSchema.optional(),
	canonical_model_id: z.string().min(1).max(120).optional(),
	canonical_candidates_per_shot: z.coerce.number().int().min(1).max(5).optional()
});
