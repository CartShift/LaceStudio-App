import { Buffer } from "node:buffer";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { isRetryableNetworkError, withRetry } from "@/lib/retry";
import { assertSafePublicHttpUrl } from "@/lib/ssrf";
import type { ImageGenerationAsset, ImageGenerationRequest, ImageGenerationResponse, ImageProvider } from "./types";

type OpenAiImageItem = {
  url?: string;
  b64_json?: string;
  revised_prompt?: string;
};

type OpenAiImageResponse = {
  created?: number;
  data?: OpenAiImageItem[];
};

type ResolvedReferenceImage = {
  fileName: string;
  blob: Blob;
};

const MAX_REFERENCE_IMAGES = 16;
const MAX_REFERENCE_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const OPENAI_REQUEST_TIMEOUT_MS = 90_000;
const REFERENCE_FETCH_TIMEOUT_MS = 15_000;
const OPENAI_RETRY_MAX_ATTEMPTS = 3;
const OPENAI_RETRY_BASE_DELAY_MS = 1_000;
const OPENAI_RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export class OpenAiImageProvider implements ImageProvider {
  readonly provider = "openai" as const;

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const env = getEnv();
    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ApiError(503, "INTERNAL_ERROR", "OpenAI image setup is missing. Add OPENAI_API_KEY and try again.");
    }

    const model = input.model_id ?? env.OPENAI_IMAGE_MODEL;
    const size = toOpenAiSize(input.width, input.height);

    const prioritizedReferences = prioritizeReferences(input.references).slice(0, MAX_REFERENCE_IMAGES);
    const resolvedReferences = await resolveReferenceImages(prioritizedReferences);
    const prompt = buildConsistencyPrompt({
      basePrompt: input.prompt_text,
      references: prioritizedReferences,
      conditionedCount: resolvedReferences.length,
      failedCount: prioritizedReferences.length - resolvedReferences.length,
    });

    let endpoint: "images/generations" | "images/edits" = "images/generations";
    let response: Response;
    let editFallbackStatus: number | undefined;

    let inputFidelity: "high" | "none" = "none";

    if (resolvedReferences.length > 0) {
      endpoint = "images/edits";
      inputFidelity = "high";
      response = await requestOpenAiEdits({
        apiKey,
        model,
        prompt,
        size,
        batchSize: input.batch_size,
        references: resolvedReferences,
        inputFidelity: "high",
      });

      if (!response.ok && response.status === 400) {
        editFallbackStatus = response.status;
        const retryAsGeneration = await requestOpenAiGeneration({
          apiKey,
          model,
          prompt,
          size,
          batchSize: input.batch_size,
        });

        if (retryAsGeneration.ok) {
          response = retryAsGeneration;
          endpoint = "images/generations";
        } else {
          const retryWithoutFidelity = await requestOpenAiEdits({
            apiKey,
            model,
            prompt,
            size,
            batchSize: input.batch_size,
            references: resolvedReferences,
          });

          if (retryWithoutFidelity.ok) {
            response = retryWithoutFidelity;
            inputFidelity = "none";
          } else {
            response = retryAsGeneration;
          }
        }
      }
    } else {
      response = await requestOpenAiGeneration({
        apiKey,
        model,
        prompt,
        size,
        batchSize: input.batch_size,
      });
    }

    if (!response.ok) {
      throw new ApiError(502, "INTERNAL_ERROR", "OpenAI couldn't create images for this request. Please try again.", {
        status: response.status,
      });
    }

    const payload = (await response.json()) as OpenAiImageResponse;
    const assets = toImageAssets(payload, input);

    if (assets.length === 0) {
      throw new ApiError(502, "INTERNAL_ERROR", "OpenAI returned no images. Please try again.");
    }

    return {
      job_id: input.job_id,
      status: "completed",
      estimated_time_ms: assets.reduce((total, asset) => total + asset.generation_time_ms, 0),
      assets,
      provider_payload: {
        provider: this.provider,
        model,
        size,
        endpoint,
        reference_images_attempted: prioritizedReferences.length,
        reference_images_used: resolvedReferences.length,
        reference_images_failed: prioritizedReferences.length - resolvedReferences.length,
        reference_mode:
          endpoint === "images/edits"
            ? "image_edits"
            : prioritizedReferences.length > 0
              ? "text_generation_fallback"
              : "text_generation",
        input_fidelity: inputFidelity,
        edit_fallback_status: editFallbackStatus,
      },
    };
  }
}

async function requestOpenAiGeneration(input: {
  apiKey: string;
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  batchSize: number;
}): Promise<Response> {
  return requestOpenAiWithRetry({
    maxAttempts: OPENAI_RETRY_MAX_ATTEMPTS,
    timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
    request: (signal) =>
      fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify({
          model: input.model,
          prompt: input.prompt,
          size: input.size,
          n: input.batchSize,
          quality: "high",
          response_format: "b64_json",
        }),
        signal,
      }),
  });
}

async function requestOpenAiEdits(input: {
  apiKey: string;
  model: string;
  prompt: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  batchSize: number;
  references: ResolvedReferenceImage[];
  inputFidelity?: "high";
}): Promise<Response> {
  const form = new FormData();
  form.set("model", input.model);
  form.set("prompt", input.prompt);
  form.set("size", input.size);
  form.set("n", String(input.batchSize));
  form.set("quality", "high");
  if (input.inputFidelity) {
    form.set("input_fidelity", input.inputFidelity);
  }
  form.set("response_format", "b64_json");

  for (const reference of input.references) {
    form.append("image[]", reference.blob, reference.fileName);
  }

  return requestOpenAiWithRetry({
    maxAttempts: OPENAI_RETRY_MAX_ATTEMPTS,
    timeoutMs: OPENAI_REQUEST_TIMEOUT_MS,
    request: (signal) =>
      fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.apiKey}`,
        },
        body: form,
        signal,
      }),
  });
}

function toImageAssets(
  payload: OpenAiImageResponse,
  input: ImageGenerationRequest,
): ImageGenerationAsset[] {
  const images = payload.data ?? [];

  return images
    .map((image, index) => {
      const uri = image.url ?? (image.b64_json ? `data:image/png;base64,${image.b64_json}` : undefined);
      if (!uri) return null;

      return {
        uri,
        seed: input.seeds[index] ?? input.seeds[0] ?? 42,
        width: input.width,
        height: input.height,
        generation_time_ms: 11_000 + index * 350,
        provider_metadata: image.revised_prompt ? { revised_prompt: image.revised_prompt } : undefined,
      } satisfies ImageGenerationAsset;
    })
    .flatMap((asset) => (asset ? [asset] : []));
}

function buildConsistencyPrompt(input: {
  basePrompt: string;
  references: ImageGenerationRequest["references"];
  conditionedCount: number;
  failedCount: number;
}): string {
  const lines = [
    input.basePrompt,
    "Character consistency lock: preserve the same identity across every output (face geometry, hairline, skin texture, and distinguishing facial details).",
  ];

  if (input.references.length > 0) {
    lines.push(`Reference conditioning: ${input.conditionedCount} image reference(s) attached.`);

    const labels = input.references
      .slice(0, 6)
      .map((reference, index) => {
        const handle =
          reference.title?.trim() ||
          (isHttpUrl(reference.url) ? reference.url : `uploaded_reference_${index + 1}`);
        return `${reference.weight}:${handle}`;
      });

    if (labels.length > 0) {
      lines.push(`Reference set: ${labels.join(" | ")}`);
    }

    if (input.failedCount > 0) {
      lines.push(
        `${input.failedCount} reference item(s) could not be attached as image inputs and are applied through textual guidance only.`,
      );
    }
  }

  return lines.join("\n");
}

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

async function resolveReferenceImages(
  references: ImageGenerationRequest["references"],
): Promise<ResolvedReferenceImage[]> {
  const resolved: ResolvedReferenceImage[] = [];

  for (let index = 0; index < references.length; index += 1) {
    const result = await resolveReferenceImage(references[index], index);
    if (result) {
      resolved.push(result);
    }
  }

  return resolved;
}

async function resolveReferenceImage(
  reference: ImageGenerationRequest["references"][number] | undefined,
  index: number,
): Promise<ResolvedReferenceImage | null> {
  const url = reference?.url?.trim();
  if (!url) return null;

  if (url.startsWith("data:image/")) {
    return fromDataUrl(url, index);
  }

  if (!isHttpUrl(url)) {
    return null;
  }

  try {
    await assertSafePublicHttpUrl(url);
    const response = await requestOpenAiWithRetry({
      maxAttempts: 2,
      timeoutMs: REFERENCE_FETCH_TIMEOUT_MS,
      request: (signal) => fetch(url, { signal }),
    });
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
      fileName: `reference-${index + 1}.${mimeTypeToExtension(mimeType)}`,
      blob: new Blob([bytes], { type: mimeType }),
    };
  } catch {
    return null;
  }
}

function fromDataUrl(dataUrl: string, index: number): ResolvedReferenceImage | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) return null;

  const mimeType = normalizeMimeType(match[1]);
  const encoded = match[2];
  if (!encoded) return null;

  if (!ALLOWED_REFERENCE_MIME_TYPES.has(mimeType)) {
    return null;
  }

  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    return null;
  }

  return {
    fileName: `reference-${index + 1}.${mimeTypeToExtension(mimeType)}`,
    blob: new Blob([bytes], { type: mimeType }),
  };
}

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

function mimeTypeToExtension(mimeType: string): string {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function requestOpenAiWithRetry(input: {
  maxAttempts: number;
  timeoutMs: number;
  request: (signal: AbortSignal) => Promise<Response>;
}): Promise<Response> {
  return withRetry<Response>({
    maxAttempts: input.maxAttempts,
    baseDelayMs: OPENAI_RETRY_BASE_DELAY_MS,
    jitterMs: 350,
    shouldRetry: ({ result, error }) => {
      if (result) return OPENAI_RETRYABLE_STATUS_CODES.has(result.status);
      if (error) return isRetryableNetworkError(error);
      return false;
    },
    run: () => fetchWithTimeout(input.request, input.timeoutMs),
  });
}

async function fetchWithTimeout(
  request: (signal: AbortSignal) => Promise<Response>,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await request(controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function toOpenAiSize(width: number, height: number): "1024x1024" | "1536x1024" | "1024x1536" {
  if (width === height) {
    return "1024x1024";
  }

  return width > height ? "1536x1024" : "1024x1536";
}
