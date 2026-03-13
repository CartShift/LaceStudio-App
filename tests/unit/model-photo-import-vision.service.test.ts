import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getEnvMock } = vi.hoisted(() => ({
	getEnvMock: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
	getEnv: getEnvMock,
}));

vi.mock("@/lib/ssrf", () => ({
	assertSafePublicHttpUrl: vi.fn(async () => undefined),
}));

import { analyzeModelPhotosWithVision } from "@/server/services/model-photo-import-vision.service";

describe("model-photo-import-vision.service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("uses Z.AI vision when available", async () => {
		getEnvMock.mockReturnValue({
			ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
			ZAI_API_KEY: "zai-key",
			ZAI_VISION_MODEL: "glm-4.6v",
			NANO_BANANA_API_URL: undefined,
			NANO_BANANA_API_KEY: undefined,
			NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
		});

		const outputJson = JSON.stringify(buildSuggestionJson());
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: outputJson,
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: "https://cdn.example.com/face-1.png",
				},
			],
		});

		expect(result.provider).toBe("zai_vision");
		expect(result.suggestion.image_reviews[0]?.accepted).toBe(true);
		expect(result.suggestion.image_reviews[0]?.view_angle).toBe("frontal");
		expect(result.suggestion.image_reviews[0]?.identity_anchor_score).toBe(0.95);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("sends current model data baseline and accepts model_data wrapper from LLM", async () => {
		getEnvMock.mockReturnValue({
			ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
			ZAI_API_KEY: "zai-key",
			ZAI_VISION_MODEL: "glm-4.6v",
			NANO_BANANA_API_URL: undefined,
			NANO_BANANA_API_KEY: undefined,
			NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
		});

		const suggestion = buildSuggestionJson();
		const currentModelData = {
			character_design: {
				body_profile: {
					height_cm: 169,
					build: "athletic" as const,
					skin_tone: "light olive",
					hair_color: "dark brown",
					hair_length: "long" as const,
					hair_style: "soft wave",
					eye_color: "brown",
					distinguishing_features: [],
					advanced_traits: {
						shoulder_width: "balanced" as const,
					},
				},
				face_profile: {
					face_shape: "oval" as const,
					jawline: "defined" as const,
					nose_profile: "straight" as const,
					lip_profile: "balanced" as const,
					brow_profile: "soft_arch" as const,
					eye_spacing: "balanced" as const,
					eye_shape: "almond" as const,
					forehead_height: "balanced" as const,
					cheekbones: "defined" as const,
					advanced_traits: {},
				},
				imperfection_fingerprint: [],
			},
			personality: {
				social_voice: "warm" as const,
				temperament: "confident" as const,
				interests: ["fashion"],
				boundaries: ["No explicit content"],
				communication_style: {
					caption_tone: "aspirational" as const,
					emoji_usage: "minimal" as const,
					language_style: "balanced" as const,
				},
			},
			social_strategy: {
				reality_like_daily: {
					enabled: true,
					style_brief: "daily",
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
		};
		const outputJson = JSON.stringify({
			model_data: {
				character_design: suggestion.character_design,
				personality: suggestion.personality,
				social_strategy: suggestion.social_strategy,
			},
			confidence: suggestion.confidence,
			warnings: suggestion.warnings,
			image_reviews: suggestion.image_reviews,
		});
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: outputJson,
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: "https://cdn.example.com/face-1.png",
				},
			],
			currentModelData,
		});

		expect(result.provider).toBe("zai_vision");
		expect(result.suggestion.character_design.body_profile.height_cm).toBe(171);

		const fetchCalls = fetchMock.mock.calls as unknown as Array<
			[string, RequestInit | undefined]
		>;
		const firstCallBody = fetchCalls[0]?.[1]?.body;
		expect(typeof firstCallBody).toBe("string");
		const parsedBody =
			typeof firstCallBody === "string"
				? (JSON.parse(firstCallBody) as {
						messages?: Array<{
							content?: Array<{ type?: string; text?: string }>;
						}>;
				  })
				: {};
		const promptText =
			parsedBody.messages?.[0]?.content?.find(part => part.type === "text")?.text ?? "";
		expect(promptText).toContain('"height_cm":169');
	});

	it("falls back to OpenAI vision when Z.AI fails", async () => {
		getEnvMock.mockReturnValue({
			OPENAI_API_KEY: "openai-key",
			OPENAI_VISION_MODEL: "gpt-4.1-mini",
			ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
			ZAI_API_KEY: "zai-key",
			ZAI_VISION_MODEL: "glm-4.6v",
			NANO_BANANA_API_URL: undefined,
			NANO_BANANA_API_KEY: undefined,
			NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
		});

		const outputJson = JSON.stringify(buildSuggestionJson());
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response("zai failed", { status: 500 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [
							{
								message: {
									content: outputJson,
								},
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				),
			);
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: sampleDataUrl(),
				},
			],
		});

		expect(result.provider).toBe("openai_vision");
		expect(result.suggestion.image_reviews[0]?.view_angle).toBe("frontal");
		expect(result.suggestion.image_reviews[0]?.identity_anchor_score).toBe(0.95);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/chat/completions");
	});

	it("falls back to heuristic when Z.AI fails and Gemini cannot recover", async () => {
		getEnvMock.mockReturnValue({
			ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
			ZAI_API_KEY: "zai-key",
			ZAI_VISION_MODEL: "glm-4.6v",
			NANO_BANANA_API_URL: "https://generativelanguage.googleapis.com/v1beta/models",
			NANO_BANANA_API_KEY: "gem-key",
			NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
		});

		const fetchMock = vi.fn().mockResolvedValueOnce(new Response("zai failed", { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: "https://cdn.example.com/face-1.png",
				},
			],
		});

		expect(result.provider).toBe("heuristic");
		expect(result.suggestion.image_reviews).toHaveLength(1);
		expect(result.suggestion.warnings.length).toBeGreaterThan(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("falls back to heuristic defaults when providers are unavailable", async () => {
		getEnvMock.mockImplementation(() => {
			throw new Error("env missing");
		});

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: "https://cdn.example.com/face-1.png",
				},
			],
		});

		expect(result.provider).toBe("heuristic");
		expect(result.suggestion.warnings.length).toBeGreaterThan(0);
	});

	it("does not reject a solo face when accepted flag is omitted", async () => {
		getEnvMock.mockReturnValue({
			ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
			ZAI_API_KEY: "zai-key",
			ZAI_VISION_MODEL: "glm-4.6v",
			NANO_BANANA_API_URL: undefined,
			NANO_BANANA_API_KEY: undefined,
			NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview",
		});

		const outputJson = JSON.stringify(
			buildSuggestionJson({
				image_reviews: [
					{
						reference_id: "11111111-1111-4111-8111-111111111111",
						solo_subject: true,
						face_visible: true,
					},
				],
			}),
		);
		const fetchMock = vi.fn(async () =>
			new Response(
				JSON.stringify({
					choices: [
						{
							message: {
								content: outputJson,
							},
						},
					],
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		vi.stubGlobal("fetch", fetchMock);

		const result = await analyzeModelPhotosWithVision({
			modelName: "Ava",
			references: [
				{
					reference_id: "11111111-1111-4111-8111-111111111111",
					url: "https://cdn.example.com/face-1.png",
				},
			],
		});

		expect(result.provider).toBe("zai_vision");
		expect(result.suggestion.image_reviews[0]?.accepted).toBe(true);
		expect(result.suggestion.image_reviews[0]?.solo_subject).toBe(true);
		expect(result.suggestion.image_reviews[0]?.face_visible).toBe(true);
	});
});

function buildSuggestionJson(overrides?: Partial<Record<string, unknown>>) {
	const base = {
		character_design: {
			body_profile: {
				height_cm: 171,
				build: "athletic",
				skin_tone: "light olive",
				hair_color: "dark brown",
				hair_length: "long",
				hair_style: "soft wave",
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
			boundaries: ["No explicit content"],
			communication_style: {
				caption_tone: "aspirational",
				emoji_usage: "minimal",
				language_style: "balanced",
			},
		},
		social_strategy: {
			reality_like_daily: {
				enabled: true,
				style_brief: "daily",
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
				view_angle: "frontal",
				framing: "closeup",
				expression: "neutral",
				sharpness_score: 0.92,
				identity_anchor_score: 0.95,
			},
		],
	};

	return {
		...base,
		...(overrides ?? {}),
	};
}

function sampleDataUrl(): string {
	const pngBase64 =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+6m0AAAAASUVORK5CYII=";
	return `data:image/png;base64,${pngBase64}`;
}
