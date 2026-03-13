import { Buffer } from "node:buffer";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { assertSafePublicHttpUrl } from "@/lib/ssrf";
import {
	characterDesignSchema,
	personalityProfileSchema,
	photoImportSuggestionSchema,
	socialTracksSchema,
} from "@/server/schemas/model-workflow";

type PhotoImportVisionProvider = "zai_vision" | "gemini_fallback" | "heuristic";

export type PhotoImportVisionReference = {
	reference_id: string;
	url: string;
	file_name?: string | null;
};

export type PhotoImportVisionResult = {
	provider: PhotoImportVisionProvider;
	suggestion: ReturnType<typeof normalizeSuggestionPayload>;
};

type PhotoImportModelData = {
	character_design: z.infer<typeof characterDesignSchema>;
	personality: z.infer<typeof personalityProfileSchema>;
	social_strategy: z.infer<typeof socialTracksSchema>;
};

type PhotoImportVisionInput = {
	modelName: string;
	references: PhotoImportVisionReference[];
	currentModelData: PhotoImportModelData;
};

type ZaiChatCompletionPayload = {
	choices?: Array<{
		message?: {
			content?:
				| string
				| Array<{
						type?: string;
						text?: string;
				  }>;
		};
	}>;
	error?: {
		message?: string;
	};
};

type GeminiInlineData = {
	mime_type?: string;
	data?: string;
};

type GeminiPart = {
	text?: string;
	inline_data?: GeminiInlineData;
};

type GeminiGenerateContentPayload = {
	candidates?: Array<{
		content?: {
			parts?: GeminiPart[];
		};
	}>;
	error?: {
		message?: string;
	};
};

const ZAI_TIMEOUT_MS = 60_000;
const GEMINI_TIMEOUT_MS = 90_000;
const MAX_GEMINI_REFERENCE_BYTES = 4 * 1024 * 1024;
const ALLOWED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PHOTO_REVIEW_VIEW_ANGLES = ["frontal", "left_45", "right_45", "left_profile", "right_profile", "unknown"] as const;
const PHOTO_REVIEW_FRAMINGS = ["closeup", "head_shoulders", "half_body", "full_body", "unknown"] as const;
const PHOTO_REVIEW_EXPRESSIONS = ["neutral", "soft_smile", "serious", "other"] as const;

export async function analyzeModelPhotosWithVision(input: {
	modelName: string;
	references: PhotoImportVisionReference[];
	currentModelData?: Partial<PhotoImportModelData>;
}): Promise<PhotoImportVisionResult> {
	const normalizedInput: PhotoImportVisionInput = {
		modelName: input.modelName,
		references: input.references,
		currentModelData: normalizeModelDataSeed(input.currentModelData),
	};

	const zai = await tryZaiVision(normalizedInput);
	if (zai) return zai;

	const gemini = await tryGeminiFallback(normalizedInput);
	if (gemini) return gemini;

	return {
		provider: "heuristic",
		suggestion: buildHeuristicSuggestion(normalizedInput.references, normalizedInput.currentModelData),
	};
}

async function tryZaiVision(input: PhotoImportVisionInput): Promise<PhotoImportVisionResult | null> {
	let env: ReturnType<typeof getEnv>;
	try {
		env = getEnv();
	} catch {
		return null;
	}

	if (!env.ZAI_API_KEY || !env.ZAI_VISION_MODEL) {
		return null;
	}

	try {
		const endpoint = `${env.ZAI_API_BASE_URL.trim().replace(/\/$/, "")}/chat/completions`;
		const response = await fetchWithTimeout(
			endpoint,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${env.ZAI_API_KEY}`,
				},
				body: JSON.stringify({
					model: env.ZAI_VISION_MODEL,
					messages: [
						{
							role: "user",
							content: [
								{
									type: "text",
									text: buildVisionPrompt(input),
								},
								...input.references.map(reference => ({
									type: "image_url" as const,
									image_url: {
										url: reference.url,
									},
								})),
							],
						},
					],
				}),
			},
			ZAI_TIMEOUT_MS,
		);

		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as ZaiChatCompletionPayload;
		const text = extractZaiMessageText(payload);
		if (!text) return null;

		const suggestion = normalizeSuggestionFromText(
			text,
			input.references,
			input.currentModelData,
		);
		if (!suggestion) return null;

		return {
			provider: "zai_vision",
			suggestion,
		};
	} catch {
		return null;
	}
}

async function tryGeminiFallback(input: PhotoImportVisionInput): Promise<PhotoImportVisionResult | null> {
	let env: ReturnType<typeof getEnv>;
	try {
		env = getEnv();
	} catch {
		return null;
	}

	if (!env.NANO_BANANA_API_URL || !env.NANO_BANANA_API_KEY) {
		return null;
	}

	const endpoint = buildGeminiEndpoint(
		env.NANO_BANANA_API_URL,
		env.NANO_BANANA_MODEL,
	);
	const inlineParts = await resolveGeminiInlineParts(input.references.slice(0, 8));
	if (inlineParts.length === 0) {
		return null;
	}

	try {
		const response = await fetchWithTimeout(
			endpoint,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-goog-api-key": env.NANO_BANANA_API_KEY,
				},
				body: JSON.stringify({
					contents: [
						{
							role: "user",
							parts: [
								{ text: buildGeminiPrompt(input) },
								...inlineParts,
							],
						},
					],
					generationConfig: {
						responseModalities: ["TEXT"],
					},
				}),
			},
			GEMINI_TIMEOUT_MS,
		);

		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as GeminiGenerateContentPayload;
		const text = extractGeminiText(payload);
		if (!text) return null;

		const suggestion = normalizeSuggestionFromText(
			text,
			input.references,
			input.currentModelData,
		);
		if (!suggestion) return null;

		return {
			provider: "gemini_fallback",
			suggestion,
		};
	} catch {
		return null;
	}
}

function normalizeSuggestionFromText(
	text: string,
	references: PhotoImportVisionReference[],
	currentModelData: PhotoImportModelData,
): ReturnType<typeof normalizeSuggestionPayload> | null {
	const parsed = parseJsonObjectFromText(text);
	if (!parsed) return null;
	return normalizeSuggestionPayload(parsed, references, currentModelData);
}

function normalizeSuggestionPayload(
	raw: Record<string, unknown>,
	references: PhotoImportVisionReference[],
	currentModelData: PhotoImportModelData,
) {
	const modelDataRaw = resolveModelDataPayload(raw);
	const characterDesign = characterDesignSchema.safeParse(modelDataRaw.character_design);
	const personality = personalityProfileSchema.safeParse(modelDataRaw.personality);
	const socialTracks = socialTracksSchema.safeParse(modelDataRaw.social_strategy);

	const confidenceRaw = asRecord(raw.confidence) ?? {};
	const warningsRaw = Array.isArray(raw.warnings)
		? raw.warnings
				.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
				.slice(0, 20)
		: [];

	const reviews = buildImageReviewList(raw.image_reviews, references);

	const normalized = {
		character_design: characterDesign.success
			? characterDesign.data
			: currentModelData.character_design,
		personality: personality.success ? personality.data : currentModelData.personality,
		social_strategy: socialTracks.success
			? socialTracks.data
			: currentModelData.social_strategy,
		confidence: {
			character_design: clamp01(asNumber(confidenceRaw.character_design, 0.7)),
			personality: clamp01(asNumber(confidenceRaw.personality, 0.55)),
			social_strategy: clamp01(asNumber(confidenceRaw.social_strategy, 0.55)),
		},
		warnings: warningsRaw,
		image_reviews: reviews,
	};

	return photoImportSuggestionSchema.parse(normalized);
}

function resolveModelDataPayload(raw: Record<string, unknown>): Record<string, unknown> {
	const modelData = asRecord(raw.model_data);
	if (!modelData) {
		return raw;
	}

	return {
		character_design: modelData.character_design,
		personality: modelData.personality,
		social_strategy: modelData.social_strategy,
	};
}

function buildImageReviewList(
	raw: unknown,
	references: PhotoImportVisionReference[],
): Array<{
	reference_id: string;
	accepted: boolean;
	reason?: string;
	solo_subject?: boolean;
	face_visible?: boolean;
	view_angle?: (typeof PHOTO_REVIEW_VIEW_ANGLES)[number];
	framing?: (typeof PHOTO_REVIEW_FRAMINGS)[number];
	expression?: (typeof PHOTO_REVIEW_EXPRESSIONS)[number];
	sharpness_score?: number;
	identity_anchor_score?: number;
}> {
	const parsed = Array.isArray(raw)
		? raw
				.map(entry => {
					const record = asRecord(entry);
					if (!record) return null;

					const reference_id = typeof record.reference_id === "string" ? record.reference_id : "";
					const accepted =
						typeof record.accepted === "boolean"
							? record.accepted
							: undefined;
					const reason =
						typeof record.reason === "string" && record.reason.trim().length > 0
							? record.reason.trim().slice(0, 240)
							: undefined;
					const solo_subject =
						typeof record.solo_subject === "boolean"
							? record.solo_subject
							: undefined;
					const face_visible =
						typeof record.face_visible === "boolean"
							? record.face_visible
							: undefined;
					const view_angle = readOptionalEnum(record.view_angle, PHOTO_REVIEW_VIEW_ANGLES);
					const framing = readOptionalEnum(record.framing, PHOTO_REVIEW_FRAMINGS);
					const expression = readOptionalEnum(record.expression, PHOTO_REVIEW_EXPRESSIONS);
					const sharpness_score = readOptionalScore(record.sharpness_score);
					const identity_anchor_score = readOptionalScore(record.identity_anchor_score);

					if (!reference_id) return null;
					return {
						reference_id,
						accepted,
						reason,
						solo_subject,
						face_visible,
						view_angle,
						framing,
						expression,
						sharpness_score,
						identity_anchor_score,
					};
				})
				.filter((value): value is NonNullable<typeof value> => Boolean(value))
		: [];

	const byId = new Map(parsed.map(entry => [entry.reference_id, entry]));

	return references.map(reference => {
		const existing = byId.get(reference.reference_id);
		if (!existing) {
			return {
				reference_id: reference.reference_id,
				accepted: true,
				solo_subject: true,
				face_visible: true,
				view_angle: "unknown",
				framing: "unknown",
				expression: "other",
				sharpness_score: 0.5,
				identity_anchor_score: 0.5,
			};
		}

		const facePolicyAccepted =
			existing.accepted !== false &&
			existing.solo_subject !== false &&
			existing.face_visible !== false;

		return {
			reference_id: reference.reference_id,
			accepted: facePolicyAccepted,
			reason:
				facePolicyAccepted
					? existing.reason
					: existing.reason ?? "Rejected: non-solo subject or face visibility is insufficient.",
			solo_subject: existing.solo_subject,
			face_visible: existing.face_visible,
			view_angle: existing.view_angle ?? "unknown",
			framing: existing.framing ?? "unknown",
			expression: existing.expression ?? "other",
			sharpness_score: existing.sharpness_score ?? 0.5,
			identity_anchor_score: existing.identity_anchor_score ?? 0.5,
		};
	});
}

function defaultSuggestion() {
	return {
		character_design: {
			body_profile: {
				height_cm: 172,
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
			interests: ["fashion", "lifestyle"],
			boundaries: ["No explicit content", "No political endorsements"],
			communication_style: {
				caption_tone: "aspirational" as const,
				emoji_usage: "minimal" as const,
				language_style: "balanced" as const,
			},
			notes: "AI-generated starter profile. Review and edit before activation.",
		},
		social_strategy: {
			reality_like_daily: {
				enabled: true,
				style_brief: "Natural day-in-the-life visuals with realistic settings.",
				prompt_bias: "candid framing, daylight realism, lifestyle moments",
				target_ratio_percent: 60,
				weekly_post_goal: 3,
			},
			fashion_editorial: {
				enabled: true,
				style_brief: "High-polish fashion editorials with premium styling.",
				prompt_bias: "studio precision, luxury wardrobe, clean compositions",
				target_ratio_percent: 40,
				weekly_post_goal: 2,
			},
		},
	};
}

function normalizeModelDataSeed(raw?: Partial<PhotoImportModelData>): PhotoImportModelData {
	const defaults = defaultSuggestion();

	const characterDesign = characterDesignSchema.safeParse(raw?.character_design);
	const personality = personalityProfileSchema.safeParse(raw?.personality);
	const socialTracks = socialTracksSchema.safeParse(raw?.social_strategy);

	return {
		character_design: characterDesign.success
			? characterDesign.data
			: defaults.character_design,
		personality: personality.success ? personality.data : defaults.personality,
		social_strategy: socialTracks.success
			? socialTracks.data
			: defaults.social_strategy,
	};
}

function stringifyModelDataForPrompt(value: PhotoImportModelData): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "{}";
	}
}

function buildHeuristicSuggestion(
	references: PhotoImportVisionReference[],
	currentModelData: PhotoImportModelData,
) {
	return photoImportSuggestionSchema.parse({
		...currentModelData,
		confidence: {
			character_design: 0.45,
			personality: 0.3,
			social_strategy: 0.3,
		},
		warnings: [
			"Vision providers were unavailable. The existing model profile baseline was kept.",
		],
		image_reviews: references.map(reference => ({
			reference_id: reference.reference_id,
			accepted: true,
			solo_subject: true,
			face_visible: true,
			view_angle: "unknown",
			framing: "unknown",
			expression: "other",
			sharpness_score: 0.5,
			identity_anchor_score: 0.5,
		})),
	});
}

function buildVisionPrompt(input: {
	modelName: string;
	references: PhotoImportVisionReference[];
	currentModelData: PhotoImportModelData;
}): string {
	const modelDataJson = stringifyModelDataForPrompt(input.currentModelData);
	return [
		`You are analyzing uploaded identity photos for model: ${input.modelName}.`,
		"Return ONLY strict JSON with these top-level keys:",
		"model_data, confidence, warnings, image_reviews",
		"model_data must contain: character_design, personality, social_strategy.",
		"All fields inside model_data must be present (no missing required keys, no partial objects).",
		"Use this current model_data JSON as baseline; keep unchanged fields when unsure and update what can be inferred from photos:",
		modelDataJson,
		"Use enum-safe values matching these constraints:",
		"body_profile.build: petite|slim|athletic|curvy|muscular|average",
		"body_profile.hair_length: shaved|short|medium|long|very_long",
		"body_profile.advanced_traits.shoulder_width: narrow|balanced|broad",
		"face_profile.face_shape: oval|round|square|heart|diamond|oblong",
		"face_profile.jawline: soft|defined|angular",
		"face_profile.nose_profile: straight|aquiline|button|wide|narrow",
		"face_profile.lip_profile: thin|balanced|full",
		"face_profile.brow_profile: straight|arched|soft_arch",
		"face_profile.eye_spacing: close|balanced|wide",
		"face_profile.eye_shape: almond|round|hooded|monolid",
		"face_profile.forehead_height: short|balanced|tall",
		"face_profile.cheekbones: soft|defined|prominent",
		"personality.social_voice: warm|witty|playful|minimal|bold",
		"personality.temperament: calm|energetic|mysterious|confident|soft",
		"personality.communication_style.caption_tone: casual|editorial|storytelling|aspirational",
		"personality.communication_style.emoji_usage: none|minimal|moderate",
		"personality.communication_style.language_style: concise|balanced|expressive",
		"social_strategy.reality_like_daily.target_ratio_percent + social_strategy.fashion_editorial.target_ratio_percent must equal 100.",
		"Face policy is strict: mark image as rejected when not exactly one person OR face is unclear.",
		"Close-up headshots and tightly cropped portraits of one person are valid and should be accepted.",
		"Do not reject for styling, makeup, hats, sunglasses, side profile, partial crop, or expression if one face is clearly visible.",
		"image_reviews must include one entry per uploaded image with keys:",
		"reference_id, accepted, reason, solo_subject, face_visible, view_angle, framing, expression, sharpness_score, identity_anchor_score",
		"view_angle must be one of: frontal, left_45, right_45, left_profile, right_profile, unknown.",
		"framing must be one of: closeup, head_shoulders, half_body, full_body, unknown.",
		"expression must be one of: neutral, soft_smile, serious, other.",
		"sharpness_score must be 0..1 and reflect facial sharpness/detail quality.",
		"identity_anchor_score must be 0..1 and reflect how useful the image is for preserving the exact same identity across generations.",
		"Prefer high identity_anchor_score for sharp, unobstructed images where the face shape, eyes, nose, lips, jawline, hairline, skin tone, and distinctive marks are clearly visible.",
		`Uploaded reference ids in order: ${input.references.map(item => item.reference_id).join(", ")}`,
	].join("\n");
}

function buildGeminiPrompt(input: {
	modelName: string;
	references: PhotoImportVisionReference[];
	currentModelData: PhotoImportModelData;
}): string {
	const modelDataJson = stringifyModelDataForPrompt(input.currentModelData);
	return [
		`Analyze these uploaded identity photos for ${input.modelName}.`,
		"Return JSON only. No markdown.",
		"Required keys: model_data, confidence, warnings, image_reviews.",
		"model_data must include full character_design, personality, social_strategy with all required fields populated.",
		"Use this current model_data JSON as baseline and return a complete updated model_data object:",
		modelDataJson,
		"Face policy: reject image when not exactly one person or face visibility is poor.",
		"Close-up portraits of one person are valid; do not reject just because framing is tight or stylized.",
		"Each image_reviews item must also include view_angle, framing, expression, sharpness_score, identity_anchor_score.",
		`Reference IDs: ${input.references.map(item => item.reference_id).join(", ")}`,
	].join("\n");
}

function extractZaiMessageText(payload: ZaiChatCompletionPayload): string | null {
	for (const choice of payload.choices ?? []) {
		const content = choice.message?.content;
		if (typeof content === "string" && content.trim().length > 0) {
			return content.trim();
		}

		if (Array.isArray(content)) {
			for (const part of content) {
				if (typeof part.text === "string" && part.text.trim().length > 0) {
					return part.text.trim();
				}
			}
		}
	}
	return null;
}

function extractGeminiText(payload: GeminiGenerateContentPayload): string | null {
	for (const candidate of payload.candidates ?? []) {
		for (const part of candidate.content?.parts ?? []) {
			if (typeof part.text === "string" && part.text.trim().length > 0) {
				return part.text.trim();
			}
		}
	}
	return null;
}

function parseJsonObjectFromText(text: string): Record<string, unknown> | null {
	const trimmed = text.trim();
	const direct = parseJsonObject(trimmed);
	if (direct) return direct;

	const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	if (fenced) {
		const fromFence = parseJsonObject(fenced.trim());
		if (fromFence) return fromFence;
	}

	const objectStart = trimmed.indexOf("{");
	const objectEnd = trimmed.lastIndexOf("}");
	if (objectStart >= 0 && objectEnd > objectStart) {
		const sliced = trimmed.slice(objectStart, objectEnd + 1);
		const fromSlice = parseJsonObject(sliced);
		if (fromSlice) return fromSlice;
	}

	return null;
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(raw) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback: number): number {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return fallback;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function readOptionalEnum<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | undefined {
	return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T[number]) : undefined;
}

function readOptionalScore(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return clamp01(parsed);
	}
	return undefined;
}

function buildGeminiEndpoint(baseUrl: string, model: string): string {
	const trimmed = baseUrl.trim().replace(/\/$/, "");

	if (trimmed.includes(":generateContent")) {
		return trimmed;
	}

	if (/\/models\/[^/]+$/.test(trimmed)) {
		return `${trimmed}:generateContent`;
	}

	if (/\/v1beta\/models$/.test(trimmed) || /\/v1\/models$/.test(trimmed)) {
		return `${trimmed}/${encodeURIComponent(model)}:generateContent`;
	}

	if (/\/v1beta$/.test(trimmed) || /\/v1$/.test(trimmed)) {
		return `${trimmed}/models/${encodeURIComponent(model)}:generateContent`;
	}

	return `${trimmed}/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

async function resolveGeminiInlineParts(references: PhotoImportVisionReference[]) {
	const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];

	for (const reference of references) {
		const resolved = await resolveReferenceImage(reference.url);
		if (!resolved) continue;
		parts.push({
			inline_data: {
				mime_type: resolved.mime_type,
				data: resolved.data,
			},
		});
	}

	return parts;
}

async function resolveReferenceImage(url: string): Promise<{ mime_type: string; data: string } | null> {
	const trimmed = url.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("data:image/")) {
		const parsed = fromDataUrl(trimmed);
		return parsed;
	}

	try {
		await assertSafePublicHttpUrl(trimmed);
		const response = await fetchWithTimeout(trimmed, {}, 15_000);
		if (!response.ok) return null;

		const mimeType = normalizeMimeType(response.headers.get("content-type"));
		if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) return null;

		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_GEMINI_REFERENCE_BYTES) {
			return null;
		}

		return {
			mime_type: mimeType,
			data: bytes.toString("base64"),
		};
	} catch {
		return null;
	}
}

function fromDataUrl(dataUrl: string): { mime_type: string; data: string } | null {
	const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
	if (!match) return null;

	const mimeType = normalizeMimeType(match[1]);
	if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) return null;

	const data = match[2];
	if (!data) return null;

	const estimatedBytes = Math.floor(data.length * 0.75);
	if (estimatedBytes <= 0 || estimatedBytes > MAX_GEMINI_REFERENCE_BYTES) return null;

	return {
		mime_type: mimeType,
		data,
	};
}

function normalizeMimeType(value: string | null | undefined): string {
	return (value ?? "image/png").split(";")[0]?.trim().toLowerCase() || "image/png";
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} catch (error) {
		if (error instanceof Error && error.name === "AbortError") {
			throw new ApiError(502, "INTERNAL_ERROR", "Vision request timed out.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
