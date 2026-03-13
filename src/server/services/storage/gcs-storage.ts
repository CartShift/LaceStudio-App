import { Buffer } from "node:buffer";
import { Storage } from "@google-cloud/storage";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { withRetry } from "@/lib/retry";
import { assertSafePublicHttpUrl } from "@/lib/ssrf";

type ResolvedBinary = {
  bytes: Buffer;
  contentType: string;
};

type ParsedGcsUri = {
  bucket: string;
  objectPath: string;
};

const GCS_UPLOAD_MAX_ATTEMPTS = 3;
const GCS_RETRY_BASE_DELAY_MS = 600;
const GCS_FETCH_TIMEOUT_MS = 20_000;
const RESUMABLE_UPLOAD_THRESHOLD_BYTES = 5 * 1024 * 1024;

let cachedStorage: Storage | null = null;

export async function uploadImageFromUriToModelBucket(input: {
  sourceUri: string;
  destinationPath: string;
}): Promise<string> {
  const env = getEnv();
  const bucketName = env.GCS_MODEL_WEIGHTS_BUCKET;

  if (input.sourceUri.startsWith("gs://")) {
    return input.sourceUri;
  }

  const resolved = await withRetry({
    maxAttempts: GCS_UPLOAD_MAX_ATTEMPTS,
    baseDelayMs: GCS_RETRY_BASE_DELAY_MS,
    jitterMs: 300,
    shouldRetry: ({ error }) => (error ? isRetryableStorageError(error) : false),
    run: () => resolveBinaryFromUri(input.sourceUri),
  });
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(input.destinationPath);

  await saveBufferToGcsFile(file, resolved.bytes, resolved.contentType);

  return `gs://${bucketName}/${input.destinationPath}`;
}

export async function uploadImageBytesToModelBucket(input: {
  bytes: Buffer;
  contentType: string;
  destinationPath: string;
}): Promise<string> {
  const env = getEnv();
  const bucketName = env.GCS_MODEL_WEIGHTS_BUCKET;
  const storage = getStorageClient();
  const file = storage.bucket(bucketName).file(input.destinationPath);

  await saveBufferToGcsFile(file, input.bytes, input.contentType);

  return `gs://${bucketName}/${input.destinationPath}`;
}

async function saveBufferToGcsFile(
  file: ReturnType<ReturnType<Storage["bucket"]>["file"]>,
  bytes: Buffer,
  contentType: string,
): Promise<void> {
  const useResumableUpload = bytes.byteLength >= RESUMABLE_UPLOAD_THRESHOLD_BYTES;

  await withRetry({
    maxAttempts: GCS_UPLOAD_MAX_ATTEMPTS,
    baseDelayMs: GCS_RETRY_BASE_DELAY_MS,
    jitterMs: 300,
    shouldRetry: ({ error }) => (error ? isRetryableStorageError(error) : false),
    run: () =>
      file.save(bytes, {
        resumable: useResumableUpload,
        contentType,
        // Avoid hash-validator stream bugs in Node 24 / google-storage readable-stream path.
        validation: false,
        metadata: {
          cacheControl: "private, max-age=31536000",
        },
      }),
  });
}

export async function createSignedReadUrlForGcsUri(
  uri: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const parsed = parseGcsUri(uri);
  if (!parsed) return uri;

  const storage = getStorageClient();
  const file = storage.bucket(parsed.bucket).file(parsed.objectPath);

  try {
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + expiresInSeconds * 1000,
    });

    return signedUrl;
  } catch (error) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Failed to generate signed URL for publishing.",
      error instanceof Error ? { message: error.message } : undefined,
    );
  }
}

function getStorageClient(): Storage {
  if (cachedStorage) return cachedStorage;

  const env = getEnv();
  let credentials: Record<string, unknown> | undefined;

  try {
    credentials = JSON.parse(env.GCS_SERVICE_ACCOUNT_KEY) as Record<string, unknown>;
  } catch {
    throw new ApiError(500, "INTERNAL_ERROR", "Storage setup is invalid. The service account key must be valid JSON.");
  }

  const clientEmail = typeof credentials.client_email === "string" ? credentials.client_email.trim() : "";
  const privateKey = typeof credentials.private_key === "string" ? credentials.private_key : "";
  if (!clientEmail || !privateKey) {
    throw new ApiError(
      500,
      "INTERNAL_ERROR",
      "Storage setup is incomplete. Add client_email and private_key to GCS_SERVICE_ACCOUNT_KEY.",
    );
  }

  const normalizedCredentials = {
    ...credentials,
    private_key: privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey,
  };

  cachedStorage = new Storage({
    projectId: env.GCS_PROJECT_ID,
    credentials: normalizedCredentials,
  });

  return cachedStorage;
}

async function resolveBinaryFromUri(uri: string): Promise<ResolvedBinary> {
  if (uri.startsWith("data:image/")) {
    return fromDataUrl(uri);
  }

  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    await assertSafePublicHttpUrl(uri);
    const response = await fetchWithTimeout(uri, GCS_FETCH_TIMEOUT_MS);
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) {
        throw new ApiError(502, "INTERNAL_ERROR", "We couldn't download this image right now. Please try again.", {
          status: response.status,
        });
      }

      throw new ApiError(400, "VALIDATION_ERROR", "We couldn't download this image. Check the link and try again.");
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "This image file is empty. Choose another image and try again.");
    }

    const contentType = normalizeMimeType(response.headers.get("content-type"));
    return { bytes, contentType };
  }

  throw new ApiError(400, "VALIDATION_ERROR", "This image link format is not supported. Use a public HTTP(S) image link or a data URL.");
}

function isRetryableStorageError(error: unknown): boolean {
  if (error instanceof ApiError) {
    const message = error.message.toLowerCase();
    if (
      message.includes("storage setup is invalid") ||
      message.includes("storage setup is incomplete")
    ) {
      return false;
    }

    if (error.status === 429 || (error.status >= 500 && error.status <= 504)) {
      return true;
    }

    const details =
      error.details && typeof error.details === "object" && !Array.isArray(error.details)
        ? (error.details as Record<string, unknown>)
        : null;
    const status = details?.status;
    if (typeof status === "number" && (status === 429 || (status >= 500 && status <= 504))) {
      return true;
    }
  }

  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  const nonRetryableAuthOrConfigError =
    message.includes("client_email field") ||
    message.includes("private_key") ||
    message.includes("could not load the default credentials") ||
    message.includes("invalid_grant") ||
    message.includes("invalid credentials") ||
    message.includes("unauthorized") ||
    message.includes("forbidden");

  if (nonRetryableAuthOrConfigError) {
    return false;
  }

  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("temporar") ||
    message.includes("network") ||
    message.includes("econn") ||
    message.includes("socket") ||
    message.includes("stream was destroyed") ||
    message.includes("write after a stream was destroyed") ||
    message.includes("503") ||
    message.includes("502") ||
    message.includes("504") ||
    message.includes("429")
  );
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(502, "INTERNAL_ERROR", "Image download timed out. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function fromDataUrl(dataUrl: string): ResolvedBinary {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image data URL is invalid. Use a valid image data URL and try again.");
  }

  const contentType = normalizeMimeType(match[1]);
  const encoded = match[2];
  if (!encoded) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image data URL is empty. Use a valid image and try again.");
  }
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.byteLength === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "This image data URL is empty. Use a valid image and try again.");
  }

  return { bytes, contentType };
}

function normalizeMimeType(input: string | null | undefined): string {
  return (input ?? "image/png").split(";")[0]?.trim().toLowerCase() || "image/png";
}

function parseGcsUri(uri: string): ParsedGcsUri | null {
  if (!uri.startsWith("gs://")) return null;

  const withoutScheme = uri.slice("gs://".length);
  const slashIndex = withoutScheme.indexOf("/");

  if (slashIndex <= 0 || slashIndex === withoutScheme.length - 1) {
    throw new ApiError(400, "VALIDATION_ERROR", "This gs:// link is invalid. Use a full gs://bucket/path URL and try again.");
  }

  return {
    bucket: withoutScheme.slice(0, slashIndex),
    objectPath: withoutScheme.slice(slashIndex + 1),
  };
}
