import { Buffer } from "node:buffer";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { isRetryableNetworkError, withRetry } from "@/lib/retry";
import { assertSafePublicHttpUrl } from "@/lib/ssrf";
import type { ImageGenerationAsset, ImageGenerationRequest, ImageGenerationResponse, ImageProvider } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NanoBananaGatewayAsset = {
	url?: string;
	image_url?: string;
	seed?: number;
	width?: number;
	height?: number;
	generation_time_ms?: number;
};

type NanoBananaGatewayResponse = {
	job_id?: string;
	status?: "accepted" | "completed" | "processing";
	estimated_time_ms?: number;
	assets?: NanoBananaGatewayAsset[];
};

type GeminiInlineData = {
	data?: string;
	mimeType?: string;
	mime_type?: string;
};

type GeminiCandidatePart = {
	text?: string;
	thought?: boolean;
	thought_signature?: string;
	inlineData?: GeminiInlineData;
	inline_data?: GeminiInlineData;
};

type GeminiGenerateContentResponse = {
	candidates?: Array<{
		content?: {
			parts?: GeminiCandidatePart[];
		};
		groundingMetadata?: {
			searchEntryPoint?: { renderedContent?: string };
			groundingChunks?: Array<Record<string, unknown>>;
		};
	}>;
	error?: {
		code?: number;
		message?: string;
		status?: string;
	};
};

type ResolvedReferenceImage = {
	mimeType: string;
	data: string;
};

type GeminiThinkingLevel = "minimal" | "High";

type GeminiModelProfile = "gemini_3_1_flash_image" | "gemini_3_pro_image" | "gemini_2_5_flash_image" | "unknown";

type GeminiModelCapabilities = {
	supportsThinkingConfig: boolean;
	supportsSearchGrounding: boolean;
	supportsImageSearchGrounding: boolean;
	supportsImageSizeConfig: boolean;
	supports512ImageSize: boolean;
	maxReferences: number;
	maxCharacterReferences: number;
	maxObjectReferences: number;
};

type ConfiguredNanoBananaEnv = ReturnType<typeof getEnv> & {
	NANO_BANANA_API_URL: string;
	NANO_BANANA_API_KEY: string;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ABSOLUTE_MAX_REFERENCE_IMAGES = 14;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** Max concurrent image generations within a batch. */
const MAX_BATCH_CONCURRENCY = 4;

/** Retry configuration for transient Gemini API failures. */
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1_500;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class NanoBananaImageProvider implements ImageProvider {
	readonly provider = "nano_banana_2" as const;

	async generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
		const env = getEnv();
		const apiUrl = env.NANO_BANANA_API_URL;
		const apiKey = env.NANO_BANANA_API_KEY;

		if (!apiUrl || !apiKey) {
			throw new ApiError(503, "INTERNAL_ERROR", "Nano Banana 2 setup is missing. Add NANO_BANANA_API_URL and NANO_BANANA_API_KEY, then try again.");
		}

		const configuredEnv: ConfiguredNanoBananaEnv = {
			...env,
			NANO_BANANA_API_URL: apiUrl,
			NANO_BANANA_API_KEY: apiKey
		};

		if (isGeminiApiUrl(apiUrl)) {
			return this.generateViaGemini(input, configuredEnv);
		}

		return this.generateViaGateway(input, configuredEnv);
	}

	// -----------------------------------------------------------------------
	// Gateway backend (self‑hosted / third‑party relay)
	// -----------------------------------------------------------------------

	private async generateViaGateway(input: ImageGenerationRequest, env: ConfiguredNanoBananaEnv): Promise<ImageGenerationResponse> {
		const model = input.model_id ?? env.NANO_BANANA_MODEL;
		const response = await fetch(`${env.NANO_BANANA_API_URL.replace(/\/$/, "")}/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${env.NANO_BANANA_API_KEY}`
			},
			body: JSON.stringify({
				model,
				prompt: input.prompt_text,
				negative_prompt: input.negative_prompt,
				width: input.width,
				height: input.height,
				batch_size: input.batch_size,
				seeds: input.seeds,
				references: input.references,
				creative_controls: input.creative_controls
			})
		});

		if (!response.ok) {
			throw new ApiError(502, "INTERNAL_ERROR", "Nano Banana 2 could not complete the request. Please try again.", {
				status: response.status
			});
		}

		const payload = (await response.json()) as NanoBananaGatewayResponse;
		const remoteAssets = payload.assets ?? [];

		if (remoteAssets.length === 0) {
			return {
				job_id: payload.job_id ?? input.job_id,
				status: "accepted",
				estimated_time_ms: payload.estimated_time_ms ?? input.batch_size * 70_000,
				provider_payload: {
					provider: this.provider,
					backend: "gateway",
					model
				}
			};
		}

		const assets: ImageGenerationAsset[] = remoteAssets
			.map((asset, index) => {
				const uri = asset.url ?? asset.image_url;
				if (!uri) return null;
				return {
					uri,
					seed: asset.seed ?? input.seeds[index] ?? input.seeds[0] ?? 42,
					width: asset.width ?? input.width,
					height: asset.height ?? input.height,
					generation_time_ms: asset.generation_time_ms ?? 12_000 + index * 300
				} satisfies ImageGenerationAsset;
			})
			.flatMap(asset => (asset ? [asset] : []));

		if (assets.length === 0) {
			return {
				job_id: payload.job_id ?? input.job_id,
				status: "accepted",
				estimated_time_ms: payload.estimated_time_ms ?? input.batch_size * 70_000,
				provider_payload: {
					provider: this.provider,
					backend: "gateway",
					model
				}
			};
		}

		return {
			job_id: payload.job_id ?? input.job_id,
			status: payload.status === "accepted" || payload.status === "processing" ? "accepted" : "completed",
			estimated_time_ms: payload.estimated_time_ms ?? assets.reduce((total, asset) => total + asset.generation_time_ms, 0),
			assets,
			provider_payload: {
				provider: this.provider,
				backend: "gateway",
				model
			}
		};
	}

	// -----------------------------------------------------------------------
	// Gemini backend (direct Gemini API)
	// -----------------------------------------------------------------------

	private async generateViaGemini(input: ImageGenerationRequest, env: ConfiguredNanoBananaEnv): Promise<ImageGenerationResponse> {
		const model = normalizeGeminiModelName(input.model_id ?? env.NANO_BANANA_MODEL);
		const modelCapabilities = resolveGeminiModelCapabilities(model);
		const endpoint = buildGeminiEndpoint(env.NANO_BANANA_API_URL, model);

		// 1) Resolve references — PARALLEL fetch for all reference URLs.
		const prioritizedReferences = selectReferencesForModel(input.references, modelCapabilities);
		const resolvedReferences = await resolveReferenceImagesParallel(prioritizedReferences);
		const failedReferences = prioritizedReferences.length - resolvedReferences.length;
		// Keep generation resilient even when all references fail to load.

		// 2) Determine whether to use Google Search grounding.
		const useSearchGrounding = shouldUseSearchGrounding(input.prompt_text, modelCapabilities);

		// 3) Determine optimal thinking level based on prompt complexity.
		const thinkingLevel = modelCapabilities.supportsThinkingConfig
			? selectThinkingLevel({
					request: input,
					referenceCount: resolvedReferences.length,
					useSearchGrounding
				})
			: undefined;

		// 4) Image-only responses are enough for this app's pipeline.
		const responseModalities: string[] = ["IMAGE"];

		// 5) Build the shared generation config (aspect ratio + resolution).
		const aspectRatio = toGeminiAspectRatio(input.width, input.height);
		const imageSize = resolveGeminiImageSize(input.width, input.height, modelCapabilities);

		// 6) Build the reference parts array (shared across batch items).
		const referenceParts = resolvedReferences.map(reference => ({
			inline_data: {
				mime_type: reference.mimeType,
				data: reference.data
			}
		}));

		// 7) Generate batch items — PARALLEL with bounded concurrency.
		const generationTasks = Array.from({ length: input.batch_size }, (_, index) => {
			const seed = input.seeds[index] ?? input.seeds[0] ?? 42;
			return () =>
				this.generateSingleGeminiImage({
					endpoint,
					apiKey: env.NANO_BANANA_API_KEY,
					prompt: buildGeminiPrompt({
						basePrompt: input.prompt_text,
						negativePrompt: input.negative_prompt,
						seed,
						referenceCount: resolvedReferences.length,
						failedReferenceCount: failedReferences,
						creativeControls: input.creative_controls
					}),
					referenceParts,
					responseModalities,
					aspectRatio,
					imageSize,
					thinkingLevel,
					useSearchGrounding,
					useImageSearchGrounding: modelCapabilities.supportsImageSearchGrounding,
					seed,
					width: input.width,
					height: input.height,
					index
				});
		});

		const assets = await runWithConcurrency(generationTasks, MAX_BATCH_CONCURRENCY);

		return {
			job_id: input.job_id,
			status: "completed",
			estimated_time_ms: assets.reduce((total, asset) => total + asset.generation_time_ms, 0),
			assets,
			provider_payload: {
				provider: this.provider,
				backend: "gemini",
				model,
				endpoint,
				thinking_level: thinkingLevel,
				response_modalities: responseModalities,
				aspect_ratio: aspectRatio,
				image_size: imageSize ?? null,
				search_grounding: useSearchGrounding,
				reference_images_attempted: prioritizedReferences.length,
				reference_images_used: resolvedReferences.length,
				reference_images_failed: failedReferences,
				reference_images_input_total: input.references.length,
				reference_images_dropped: Math.max(input.references.length - prioritizedReferences.length, 0),
				model_profile: resolveGeminiModelProfile(model)
			}
		};
	}

	// -----------------------------------------------------------------------
	// Single Gemini image generation (with retry + error extraction)
	// -----------------------------------------------------------------------

	private async generateSingleGeminiImage(params: {
		endpoint: string;
		apiKey: string;
		prompt: string;
		referenceParts: Array<{ inline_data: { mime_type: string; data: string } }>;
		responseModalities: string[];
		aspectRatio: string;
		imageSize?: "512px" | "1K" | "2K" | "4K";
		thinkingLevel?: GeminiThinkingLevel;
		useSearchGrounding: boolean;
		useImageSearchGrounding: boolean;
		seed: number;
		width: number;
		height: number;
		index: number;
	}): Promise<ImageGenerationAsset> {
		const startTime = Date.now();

		const tools = params.useSearchGrounding
			? [
					{
						google_search: params.useImageSearchGrounding
							? {
									searchTypes: {
										webSearch: {},
										imageSearch: {}
									}
								}
							: {}
					}
				]
			: undefined;

		const imageConfig: { aspectRatio: string; imageSize?: string } = {
			aspectRatio: params.aspectRatio
		};
		if (params.imageSize) {
			imageConfig.imageSize = params.imageSize;
		}

		const requestBody = {
			contents: [
				{
					role: "user",
					parts: [{ text: params.prompt }, ...params.referenceParts]
				}
			],
			...(tools ? { tools } : {}),
			generationConfig: {
				responseModalities: params.responseModalities,
				imageConfig,
				...(params.thinkingLevel
					? {
							thinkingConfig: {
								thinkingLevel: params.thinkingLevel,
								includeThoughts: false
							}
						}
					: {})
			}
		};

		const payload = await fetchWithRetry(params.endpoint, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-goog-api-key": params.apiKey
			},
			body: JSON.stringify(requestBody)
		});

		const image = extractGeminiImage(payload);
		if (!image) {
			const errorDetail = payload.error?.message ?? extractGeminiText(payload) ?? "The response did not include an image.";
			throw new ApiError(502, "INTERNAL_ERROR", `Nano Banana 2 could not create an image: ${errorDetail}`);
		}

		const generationTimeMs = Date.now() - startTime;

		return {
			uri: `data:${image.mimeType};base64,${image.data}`,
			seed: params.seed,
			width: params.width,
			height: params.height,
			generation_time_ms: generationTimeMs,
			provider_metadata: {
				thinking_level: params.thinkingLevel,
				search_grounding: params.useSearchGrounding
			}
		};
	}
}

// ---------------------------------------------------------------------------
// Gemini endpoint construction
// ---------------------------------------------------------------------------

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

function normalizeGeminiModelName(model: string): string {
	const normalized = model.trim();
	if (normalized === "nano-banana-2") return "gemini-3.1-flash-image-preview";
	if (normalized === "nano-banana-pro") return "gemini-3-pro-image-preview";
	if (normalized === "nano-banana") return "gemini-2.5-flash-image";
	return normalized;
}

function resolveGeminiModelProfile(model: string): GeminiModelProfile {
	const normalized = model.trim().toLowerCase();
	if (normalized.startsWith("gemini-3.1-flash-image-preview")) return "gemini_3_1_flash_image";
	if (normalized.startsWith("gemini-3-pro-image-preview")) return "gemini_3_pro_image";
	if (normalized.startsWith("gemini-2.5-flash-image")) return "gemini_2_5_flash_image";
	return "unknown";
}

function resolveGeminiModelCapabilities(model: string): GeminiModelCapabilities {
	const profile = resolveGeminiModelProfile(model);

	if (profile === "gemini_3_1_flash_image") {
		return {
			supportsThinkingConfig: true,
			supportsSearchGrounding: true,
			supportsImageSearchGrounding: true,
			supportsImageSizeConfig: true,
			supports512ImageSize: true,
			maxReferences: 14,
			maxCharacterReferences: 4,
			maxObjectReferences: 10
		};
	}

	if (profile === "gemini_3_pro_image") {
		return {
			supportsThinkingConfig: true,
			supportsSearchGrounding: true,
			supportsImageSearchGrounding: false,
			supportsImageSizeConfig: true,
			supports512ImageSize: false,
			maxReferences: 14,
			maxCharacterReferences: 5,
			maxObjectReferences: 6
		};
	}

	if (profile === "gemini_2_5_flash_image") {
		return {
			supportsThinkingConfig: false,
			supportsSearchGrounding: false,
			supportsImageSearchGrounding: false,
			supportsImageSizeConfig: false,
			supports512ImageSize: false,
			maxReferences: 3,
			maxCharacterReferences: 3,
			maxObjectReferences: 3
		};
	}

	return {
		supportsThinkingConfig: true,
		supportsSearchGrounding: true,
		supportsImageSearchGrounding: false,
		supportsImageSizeConfig: true,
		supports512ImageSize: false,
		maxReferences: 14,
		maxCharacterReferences: 4,
		maxObjectReferences: 10
	};
}

function isGeminiApiUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.hostname === "generativelanguage.googleapis.com";
	} catch {
		return false;
	}
}

// ---------------------------------------------------------------------------
// Gemini response extraction
// ---------------------------------------------------------------------------

function extractGeminiImage(payload: GeminiGenerateContentResponse): { mimeType: string; data: string } | null {
	const candidates = payload.candidates ?? [];

	for (const candidate of candidates) {
		const parts = candidate.content?.parts ?? [];

		// Filter to only non-thought inline image parts, then pick the LAST one
		// (the final rendered image after thinking intermediaries).
		const imageParts = parts.filter(p => {
			if (p.thought) return false;
			const inline = p.inlineData ?? p.inline_data;
			return inline?.data != null;
		});

		const finalPart = imageParts[imageParts.length - 1];
		if (!finalPart) continue;

		const inlineData = finalPart.inlineData ?? finalPart.inline_data;
		const data = inlineData?.data;
		if (!data) continue;

		const mimeType = normalizeMimeType(inlineData?.mimeType ?? inlineData?.mime_type ?? "image/png");
		if (mimeType.startsWith("image/")) {
			return { mimeType, data };
		}
	}

	return null;
}

function extractGeminiText(payload: GeminiGenerateContentResponse): string | null {
	for (const candidate of payload.candidates ?? []) {
		for (const part of candidate.content?.parts ?? []) {
			const text = part.text?.trim();
			if (text) {
				return text;
			}
		}
	}

	return null;
}

// ---------------------------------------------------------------------------
// Prompt engineering
// ---------------------------------------------------------------------------

function buildGeminiPrompt(input: {
	basePrompt: string;
	negativePrompt?: string;
	seed: number;
	referenceCount: number;
	failedReferenceCount: number;
	creativeControls?: ImageGenerationRequest["creative_controls"];
}): string {
	const lines: string[] = [];

	// Core prompt
	lines.push(input.basePrompt);

	// Identity consistency instruction (critical for fashion / model photography)
	lines.push(
		"Character consistency lock: preserve exact identity across all outputs — face geometry, skin tone, skin texture, hairline, eye color, and key facial details must remain identical. " +
			"Maintain body proportions and posture signature."
	);
	lines.push(
		"Match the exact same person from the attached identity references. Do not average faces, reinterpret features, beautify away distinguishing traits, or change skull shape, eye spacing, nose structure, lip shape, jaw contour, hairline, skin undertone, or natural marks."
	);

	// Creative controls → structured prompt enrichment
	if (input.creativeControls) {
		const cc = input.creativeControls;

		// Outfit
		if (cc.outfit) {
			const o = cc.outfit;
			const outfitParts = [o.silhouette, o.fabric, o.color, o.fit, o.texture].filter(Boolean);
			if (outfitParts.length > 0) {
				lines.push(`Outfit: ${outfitParts.join(", ")}.`);
			}
			if (o.accessories.length > 0) {
				lines.push(`Accessories: ${o.accessories.join(", ")}.`);
			}
			if (o.movement_preset !== "still") {
				lines.push(`Movement: ${o.movement_preset} — fabric should react naturally to motion.`);
			}
		}

		// Pose
		if (cc.pose) {
			const p = cc.pose;
			lines.push(`Pose: ${p.preset} pose.`);
			const hasRotation = Math.abs(p.micro_rotation.shoulder_angle) > 0.05 || Math.abs(p.micro_rotation.hip_shift) > 0.05 || Math.abs(p.micro_rotation.chin_tilt) > 0.05;
			if (hasRotation) {
				lines.push(
					`Micro-rotation adjustments: shoulder ${p.micro_rotation.shoulder_angle > 0 ? "+" : ""}${p.micro_rotation.shoulder_angle.toFixed(2)}, ` +
						`hip ${p.micro_rotation.hip_shift > 0 ? "+" : ""}${p.micro_rotation.hip_shift.toFixed(2)}, ` +
						`chin ${p.micro_rotation.chin_tilt > 0 ? "+" : ""}${p.micro_rotation.chin_tilt.toFixed(2)}.`
				);
			}
		}

		// Expression
		if (cc.expression) {
			const e = cc.expression;
			const expressionDesc = [
				e.preset !== "neutral" ? `${e.preset} expression` : null,
				e.smile_intensity > 0.3 ? `smile intensity ${(e.smile_intensity * 100).toFixed(0)}%` : null,
				e.eye_focus !== "direct_gaze" ? `eyes ${e.eye_focus.replace("_", " ")}` : null
			]
				.filter(Boolean)
				.join(", ");
			if (expressionDesc) {
				lines.push(`Expression: ${expressionDesc}.`);
			}
		}

		// Realism & lens
		if (cc.realism) {
			const r = cc.realism;
			lines.push(
				`Photography: ${r.lens_simulation.replace("_", " ")} lens, ` + `depth of field ${(r.depth_of_field * 100).toFixed(0)}%, ` + `skin realism ${(r.skin_texture_realism * 100).toFixed(0)}%.`
			);
			if (r.pore_detail > 0.7) {
				lines.push("Render fine pore-level skin detail.");
			}
		}

		// Aesthetic mood
		if (cc.aesthetic?.mood_tags && cc.aesthetic.mood_tags.length > 0) {
			lines.push(`Mood: ${cc.aesthetic.mood_tags.join(", ")}.`);
		}
		if (cc.aesthetic?.lighting_profile_name) {
			lines.push(`Lighting profile: ${cc.aesthetic.lighting_profile_name}.`);
		}
	}

	// Reference image instructions
	if (input.referenceCount > 0) {
		lines.push(
			`${input.referenceCount} reference image(s) are attached. ` +
				"Use them for identity consistency, styling, and compositional guidance. " +
				"The first reference marked as primary should be the strongest influence."
		);
		lines.push("When reference images disagree because of lighting, makeup, or expression, preserve the invariant identity traits shared across them.");
	}

	if (input.failedReferenceCount > 0) {
		lines.push(`Note: ${input.failedReferenceCount} reference image(s) could not be loaded. ` + "Approximate their contribution from the text description.");
	}

	// Negative prompt
	if (input.negativePrompt && input.negativePrompt.trim().length > 0) {
		lines.push(`Strictly avoid: ${input.negativePrompt.trim()}.`);
	}

	// Seed hint (helps with reproducibility across reruns)
	lines.push(`Seed hint: ${input.seed}.`);

	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Adaptive thinking level
// ---------------------------------------------------------------------------

function selectThinkingLevel(input: {
	request: ImageGenerationRequest;
	referenceCount: number;
	useSearchGrounding: boolean;
}): GeminiThinkingLevel {
	const prompt = input.request.prompt_text.toLowerCase();
	const promptLength = input.request.prompt_text.length;
	const negativePromptLength = input.request.negative_prompt?.trim().length ?? 0;

	// Search-grounded prompts tend to benefit from stronger planning.
	if (input.useSearchGrounding) return "High";

	// Many references usually indicate complex conditioning.
	if (input.referenceCount >= 8) return "High";

	// Very long prompts are generally multi-step compositions.
	if (promptLength > 700) return "High";

	// Text-heavy layouts are precision-sensitive.
	if (/\b(text|title|heading|label|caption|sign|logo|infographic|menu|diagram|poster|typography)\b/.test(prompt)) {
		return "High";
	}

	// Edit/refinement workflows are sensitive to instruction drift.
	if (/\b(base image|refinement|inpaint|edit|modify|change only|preserve|update|retouch|replace)\b/.test(prompt)) {
		return "High";
	}

	// Complex spatial composition terms.
	if (/\b(isometric|miniature|3d scene|blueprint|architectural|multi-layer|crowd scene)\b/.test(prompt)) {
		return "High";
	}

	// Long negative prompts usually imply strict constraints.
	if (negativePromptLength > 250) {
		return "High";
	}

	return "minimal";
}

// ---------------------------------------------------------------------------
// Adaptive search grounding
// ---------------------------------------------------------------------------

/**
 * Only enable Google Search grounding when the prompt references real-world
 * information that benefits from live data (weather, current events, real
 * people or places by name, recent news, etc.).
 *
 * Disabling search grounding for pure creative / editorial prompts avoids
 * unnecessary latency and token cost.
 */
function shouldUseSearchGrounding(prompt: string, modelCapabilities: GeminiModelCapabilities): boolean {
	if (!modelCapabilities.supportsSearchGrounding) {
		return false;
	}

	const lower = prompt.toLowerCase();
	const triggers = [
		"current",
		"weather",
		"forecast",
		"today",
		"yesterday",
		"last night",
		"recent",
		"latest",
		"news",
		"real-time",
		"stock",
		"score",
		"game",
		"match",
		"search",
		"find information",
		"look up",
		"what happened"
	];
	return triggers.some(trigger => lower.includes(trigger));
}

// ---------------------------------------------------------------------------
// Reference image resolution
// ---------------------------------------------------------------------------

function prioritizeReferences(references: ImageGenerationRequest["references"]): ImageGenerationRequest["references"] {
	return [...references].sort((a, b) => {
		const weightDelta = weightRank(a.weight) - weightRank(b.weight);
		if (weightDelta !== 0) return weightDelta;

		const similarityA = typeof a.similarity_score === "number" ? a.similarity_score : 0;
		const similarityB = typeof b.similarity_score === "number" ? b.similarity_score : 0;
		return similarityB - similarityA;
	});
}

function weightRank(weight: "primary" | "secondary"): number {
	return weight === "primary" ? 0 : 1;
}

function selectReferencesForModel(
	references: ImageGenerationRequest["references"],
	modelCapabilities: GeminiModelCapabilities
): ImageGenerationRequest["references"] {
	if (references.length === 0) return [];

	const ordered = prioritizeReferences(references).slice(0, ABSOLUTE_MAX_REFERENCE_IMAGES);
	if (ordered.length <= modelCapabilities.maxReferences) {
		return ordered;
	}

	const selected: ImageGenerationRequest["references"] = [];
	let characterCount = 0;
	let objectCount = 0;

	for (const reference of ordered) {
		const isCharacter = isCharacterReference(reference);

		if (isCharacter) {
			if (characterCount >= modelCapabilities.maxCharacterReferences) continue;
			characterCount += 1;
		} else {
			if (objectCount >= modelCapabilities.maxObjectReferences) continue;
			objectCount += 1;
		}

		selected.push(reference);
		if (selected.length >= modelCapabilities.maxReferences) break;
	}

	return selected;
}

function isCharacterReference(reference: ImageGenerationRequest["references"][number]): boolean {
	const haystack = `${reference.title ?? ""} ${reference.source ?? ""}`.toLowerCase();
	return /\b(model identity|character|portrait|headshot|avatar)\b/.test(haystack);
}

/** Resolve all reference images in parallel for faster startup. */
async function resolveReferenceImagesParallel(references: ImageGenerationRequest["references"]): Promise<ResolvedReferenceImage[]> {
	const results = await Promise.allSettled(references.map(ref => resolveReferenceImage(ref)));
	const resolved: ResolvedReferenceImage[] = [];
	for (const result of results) {
		if (result.status === "fulfilled" && result.value) {
			resolved.push(result.value);
		}
	}
	return resolved;
}

async function resolveReferenceImage(reference: ImageGenerationRequest["references"][number] | undefined): Promise<ResolvedReferenceImage | null> {
	const url = reference?.url?.trim();
	if (!url) return null;

	if (url.startsWith("data:image/")) {
		return fromDataUrl(url);
	}

	if (!isHttpUrl(url)) {
		return null;
	}

	try {
		await assertSafePublicHttpUrl(url);
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15_000);

		const response = await fetch(url, { signal: controller.signal });
		clearTimeout(timeout);

		if (!response.ok) return null;

		const contentLength = Number(response.headers.get("content-length") ?? "0");
		if (Number.isFinite(contentLength) && contentLength > MAX_REFERENCE_IMAGE_BYTES) {
			return null;
		}

		const mimeType = normalizeMimeType(response.headers.get("content-type"));
		if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
			return null;
		}

		const bytes = Buffer.from(await response.arrayBuffer());
		if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
			return null;
		}

		return {
			mimeType,
			data: bytes.toString("base64")
		};
	} catch {
		return null;
	}
}

function fromDataUrl(dataUrl: string): ResolvedReferenceImage | null {
	const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
	if (!match) return null;

	const mimeType = normalizeMimeType(match[1]);
	const encoded = match[2];
	if (!encoded) return null;

	if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
		return null;
	}

	// Validate size without re-encoding — estimate from base64 length
	const estimatedBytes = Math.floor(encoded.length * 0.75);
	if (estimatedBytes === 0 || estimatedBytes > MAX_REFERENCE_IMAGE_BYTES) {
		return null;
	}

	return {
		mimeType,
		data: encoded
	};
}

// ---------------------------------------------------------------------------
// Fetch with exponential backoff retry
// ---------------------------------------------------------------------------

class RetryableGeminiStatusError extends Error {
	readonly status: number;

	constructor(status: number) {
		super(`Retryable Gemini response status: ${status}`);
		this.status = status;
	}
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<GeminiGenerateContentResponse> {
	try {
		return await withRetry({
			maxAttempts: RETRY_MAX_ATTEMPTS,
			baseDelayMs: RETRY_BASE_DELAY_MS,
			jitterMs: 500,
			shouldRetry: ({ error }) => {
				if (!error) return false;
				if (error instanceof RetryableGeminiStatusError) {
					return true;
				}
				return isRetryableNetworkError(error);
			},
			run: async (attempt) => {
				const response = await fetchWithAttemptTimeout(url, init);

				if (response.ok) {
					return (await response.json()) as GeminiGenerateContentResponse;
				}

				if (RETRYABLE_STATUS_CODES.has(response.status)) {
					throw new RetryableGeminiStatusError(response.status);
				}

				throw await toGeminiApiError(response, attempt);
			}
		});
	} catch (error) {
		if (error instanceof ApiError) {
			throw error;
		}

		if (error instanceof RetryableGeminiStatusError) {
			throw new ApiError(502, "INTERNAL_ERROR", `Nano Banana 2 could not complete the request after ${RETRY_MAX_ATTEMPTS} attempts. Please try again.`, {
				status: error.status
			});
		}

		const message = error instanceof Error ? error.message : String(error);
		throw new ApiError(502, "INTERNAL_ERROR", `Nano Banana 2 could not complete the request after ${RETRY_MAX_ATTEMPTS} attempts. Please try again.`, {
			lastError: message
		});
	}
}

async function fetchWithAttemptTimeout(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 120_000);

	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timeout);
	}
}

async function toGeminiApiError(response: Response, attempt: number): Promise<ApiError> {
	let errorMessage = `HTTP ${response.status}`;

	try {
		const errorBody = (await response.json()) as GeminiGenerateContentResponse;
		if (errorBody.error?.message) {
			errorMessage = `${errorMessage}: ${errorBody.error.message}`;
		}
	} catch {
		// Ignore JSON parse failures for non-JSON error bodies.
	}

	return new ApiError(502, "INTERNAL_ERROR", `Nano Banana 2 request failed: ${errorMessage}. Please try again.`, {
		status: response.status,
		attempt
	});
}

// ---------------------------------------------------------------------------
// Batch concurrency limiter
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, maxConcurrency: number): Promise<T[]> {
	const results: T[] = [];
	let index = 0;

	async function worker(): Promise<void> {
		while (index < tasks.length) {
			const currentIndex = index;
			index += 1;
			const task = tasks[currentIndex];
			if (task) {
				results[currentIndex] = await task();
			}
		}
	}

	const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () => worker());

	await Promise.all(workers);
	return results;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function normalizeMimeType(value: string | null | undefined): string {
	return (value ?? "image/png").split(";")[0]?.trim().toLowerCase() || "image/png";
}

function toGeminiAspectRatio(width: number, height: number): string {
	const ratio = width / Math.max(height, 1);
	const candidates: Array<{ key: string; value: number }> = [
		{ key: "1:1", value: 1 },
		{ key: "1:4", value: 1 / 4 },
		{ key: "1:8", value: 1 / 8 },
		{ key: "2:3", value: 2 / 3 },
		{ key: "3:2", value: 3 / 2 },
		{ key: "3:4", value: 3 / 4 },
		{ key: "4:1", value: 4 / 1 },
		{ key: "4:3", value: 4 / 3 },
		{ key: "4:5", value: 4 / 5 },
		{ key: "5:4", value: 5 / 4 },
		{ key: "8:1", value: 8 / 1 },
		{ key: "9:16", value: 9 / 16 },
		{ key: "16:9", value: 16 / 9 },
		{ key: "21:9", value: 21 / 9 }
	];

	let best = candidates[0] ?? { key: "1:1", value: 1 };
	let bestDelta = Math.abs(ratio - best.value);

	for (const candidate of candidates.slice(1)) {
		const delta = Math.abs(ratio - candidate.value);
		if (delta < bestDelta) {
			best = candidate;
			bestDelta = delta;
		}
	}

	return best.key;
}

function resolveGeminiImageSize(
	width: number,
	height: number,
	modelCapabilities: GeminiModelCapabilities
): "512px" | "1K" | "2K" | "4K" | undefined {
	if (!modelCapabilities.supportsImageSizeConfig) {
		return undefined;
	}

	const imageSize = toGeminiImageSize(width, height, modelCapabilities.supports512ImageSize);
	if (imageSize === "512px" && !modelCapabilities.supports512ImageSize) {
		return "1K";
	}

	return imageSize;
}

function toGeminiImageSize(width: number, height: number, allow512: boolean): "512px" | "1K" | "2K" | "4K" {
	const maxDim = Math.max(width, height);
	if (maxDim >= 3840) return "4K";
	if (maxDim >= 1920) return "2K";
	if (allow512 && maxDim <= 512) return "512px";
	return "1K";
}

