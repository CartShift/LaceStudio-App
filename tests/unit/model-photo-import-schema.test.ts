import { describe, expect, it } from "vitest";
import {
	photoImportApplySchema,
	photoImportStartOptionsSchema,
	photoImportSuggestionSchema,
} from "@/server/schemas/model-workflow";

describe("model-photo-import schema", () => {
	it("applies defaults for photo import start options", () => {
		const parsed = photoImportStartOptionsSchema.parse({});
		expect(parsed.keep_as_references).toBe(true);
		expect(parsed.auto_generate_on_apply).toBe(false);
		expect(parsed.canonical_candidates_per_shot).toBe(1);
	});

	it("rejects invalid canonical candidates per shot", () => {
		const result = photoImportStartOptionsSchema.safeParse({
			canonical_candidates_per_shot: 9,
		});
		expect(result.success).toBe(false);
	});

	it("accepts apply payload with explicit sections", () => {
		const parsed = photoImportApplySchema.parse({
			sections: ["character_design", "personality"],
			start_canonical_generation: true,
		});
		expect(parsed.sections).toEqual(["character_design", "personality"]);
	});

	it("validates normalized suggestion payload", () => {
		const parsed = photoImportSuggestionSchema.parse({
			character_design: {
				body_profile: {
					height_cm: 170,
					build: "athletic",
					skin_tone: "olive",
					hair_color: "brown",
					hair_length: "long",
					hair_style: "wavy",
					eye_color: "brown",
					distinguishing_features: [],
					advanced_traits: {
						shoulder_width: "balanced",
					},
				},
				face_profile: {
					face_shape: "oval",
					jawline: "defined",
					nose_profile: "straight",
					lip_profile: "balanced",
					brow_profile: "soft_arch",
					eye_spacing: "balanced",
					eye_shape: "almond",
					forehead_height: "balanced",
					cheekbones: "defined",
					advanced_traits: {},
				},
				imperfection_fingerprint: [],
			},
			personality: {
				social_voice: "warm",
				temperament: "confident",
				interests: ["fashion"],
				boundaries: ["no explicit content"],
				communication_style: {
					caption_tone: "aspirational",
					emoji_usage: "minimal",
					language_style: "balanced",
				},
			},
			social_strategy: {
				reality_like_daily: {
					enabled: true,
					style_brief: "daily life",
					target_ratio_percent: 60,
					weekly_post_goal: 3,
				},
				fashion_editorial: {
					enabled: true,
					style_brief: "editorial",
					target_ratio_percent: 40,
					weekly_post_goal: 2,
				},
			},
			confidence: {
				character_design: 0.8,
				personality: 0.7,
				social_strategy: 0.6,
			},
			warnings: [],
			image_reviews: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					accepted: true,
					solo_subject: true,
					face_visible: true,
				},
			],
		});

		expect(parsed.confidence.character_design).toBe(0.8);
		expect(parsed.image_reviews).toHaveLength(1);
	});
});
