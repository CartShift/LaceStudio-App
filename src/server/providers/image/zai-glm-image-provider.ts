import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { isRetryableNetworkError, withRetry } from "@/lib/retry";
import type { ImageGenerationAsset, ImageGenerationRequest, ImageGenerationResponse, ImageProvider } from "./types";

type ZaiImageItem = {
	url?: string;
	b64_json?: string;
};

type ZaiImageResponse = {
	created?: number;
	data?: ZaiImageItem[];
	error?: {
		message?: string;
	};
};

const ZAI_REQUEST_TIMEOUT_MS = 90_000;
const ZAI_RETRY_MAX_ATTEMPTS = 3;
const ZAI_RETRY_BASE_DELAY_MS = 1_000;
const ZAI_RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_BATCH_CONCURRENCY = 3;

export class ZaiGlmImageProvider implements ImageProvider {
	readonly provider = "zai_glm" as const;

	async generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
		const env = getEnv();
		const apiKey = env.ZAI_API_KEY;
		if (!apiKey) {
			throw new ApiError(503, "INTERNAL_ERROR", "Z.AI image setup is missing. Add ZAI_API_KEY and try again.");
		}

		const baseUrl = env.ZAI_API_BASE_URL.trim().replace(/\/$/, "");
		const endpoint = `${baseUrl}/images/generations`;
		const model = input.model_id ?? env.ZAI_IMAGE_MODEL;
		const size = toZaiSize(model, input.width, input.height);
		const quality = resolveZaiQuality(model);
		const prompt = buildPrompt({
			basePrompt: input.prompt_text,
			references: input.references,
		});

		const tasks = Array.from({ length: input.batch_size }, (_, index) => {
			const seed = input.seeds[index] ?? input.seeds[0] ?? 42;
			return () =>
				generateSingleZaiImage({
					endpoint,
					apiKey,
					model,
					size,
					quality,
					prompt,
					seed,
					width: input.width,
					height: input.height,
				});
		});

		const assets = await runWithConcurrency(tasks, MAX_BATCH_CONCURRENCY);
		if (assets.length === 0) {
			throw new ApiError(502, "INTERNAL_ERROR", "Z.AI returned no images. Please try again.");
		}

		return {
			job_id: input.job_id,
			status: "completed",
			estimated_time_ms: assets.reduce((total, asset) => total + asset.generation_time_ms, 0),
			assets,
			provider_payload: {
				provider: this.provider,
				model,
				endpoint,
				size,
				quality,
				reference_images_input_total: input.references.length,
			},
		};
	}
}

async function generateSingleZaiImage(input: {
	endpoint: string;
	apiKey: string;
	model: string;
	size: string;
	quality: "hd" | "standard";
	prompt: string;
	seed: number;
	width: number;
	height: number;
}): Promise<ImageGenerationAsset> {
	const startedAt = Date.now();
	const response = await requestZaiWithRetry({
		request: signal =>
			fetch(input.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${input.apiKey}`,
				},
				body: JSON.stringify({
					model: input.model,
					prompt: `${input.prompt}\nSeed hint: ${input.seed}.`,
					size: input.size,
					quality: input.quality,
				}),
				signal,
			}),
	});

	if (!response.ok) {
		throw await toZaiApiError(response);
	}

	const payload = (await response.json()) as ZaiImageResponse;
	const firstImage = payload.data?.[0];
	const uri = firstImage?.url ?? (firstImage?.b64_json ? `data:image/png;base64,${firstImage.b64_json}` : undefined);
	if (!uri) {
		throw new ApiError(502, "INTERNAL_ERROR", "Z.AI returned an invalid image response. Please try again.");
	}

	return {
		uri,
		seed: input.seed,
		width: input.width,
		height: input.height,
		generation_time_ms: Date.now() - startedAt,
	};
}

function buildPrompt(input: {
	basePrompt: string;
	references: ImageGenerationRequest["references"];
}): string {
	const lines = [
		input.basePrompt,
		"Character consistency lock: preserve the same identity across every output (face geometry, hairline, skin texture, and distinguishing facial details).",
	];

	if (input.references.length > 0) {
		const labels = input.references.slice(0, 8).map((reference, index) => {
			const label = reference.title?.trim() || `reference_${index + 1}`;
			return `${reference.weight}:${label}`;
		});
		lines.push(`Reference context (${input.references.length}): ${labels.join(" | ")}`);
	}

	return lines.join("\n");
}

function resolveZaiQuality(model: string): "hd" | "standard" {
	return model.trim().toLowerCase() === "glm-image" ? "hd" : "standard";
}

function toZaiSize(model: string, width: number, height: number): string {
	const normalizedModel = model.trim().toLowerCase();
	if (normalizedModel === "glm-image") {
		if (isValidGlmImageSize(width, height)) {
			return `${width}x${height}`;
		}
		if (width === height) return "1280x1280";
		return width > height ? "1568x1056" : "1056x1568";
	}

	if (isValidGenericImageSize(width, height)) {
		return `${width}x${height}`;
	}
	if (width === height) return "1024x1024";
	return width > height ? "1344x768" : "768x1344";
}

function isValidGlmImageSize(width: number, height: number): boolean {
	if (width < 1024 || width > 2048 || height < 1024 || height > 2048) return false;
	if (width % 32 !== 0 || height % 32 !== 0) return false;
	return width * height <= 2 ** 22;
}

function isValidGenericImageSize(width: number, height: number): boolean {
	if (width < 512 || width > 2048 || height < 512 || height > 2048) return false;
	if (width % 16 !== 0 || height % 16 !== 0) return false;
	return width * height <= 2 ** 21;
}

async function requestZaiWithRetry(input: {
	request: (signal: AbortSignal) => Promise<Response>;
}): Promise<Response> {
	return withRetry<Response>({
		maxAttempts: ZAI_RETRY_MAX_ATTEMPTS,
		baseDelayMs: ZAI_RETRY_BASE_DELAY_MS,
		jitterMs: 350,
		shouldRetry: ({ result, error }) => {
			if (result) return ZAI_RETRYABLE_STATUS_CODES.has(result.status);
			if (error) return isRetryableNetworkError(error);
			return false;
		},
		run: () => fetchWithTimeout(input.request, ZAI_REQUEST_TIMEOUT_MS),
	});
}

async function fetchWithTimeout(request: (signal: AbortSignal) => Promise<Response>, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await request(controller.signal);
	} finally {
		clearTimeout(timeout);
	}
}

async function toZaiApiError(response: Response): Promise<ApiError> {
	let message = "Z.AI couldn't create images for this request.";
	try {
		const payload = (await response.json()) as ZaiImageResponse;
		if (payload.error?.message) {
			message = `${message}: ${payload.error.message}`;
		}
	} catch {
		// Ignore JSON parse errors and preserve default message.
	}

	return new ApiError(502, "INTERNAL_ERROR", message, {
		status: response.status,
	});
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, maxConcurrency: number): Promise<T[]> {
	if (tasks.length === 0) return [];

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
