import { createSignedReadUrlForGcsUri } from "@/server/services/storage/gcs-storage";

export const ACTIVE_PUBLISHING_QUEUE_STATUSES = ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"] as const;

export async function resolvePublishingAssetPreviewUrl(source: string | null | undefined): Promise<string | null> {
  const normalized = source?.trim();
  if (!normalized) return null;

  if (normalized.startsWith("data:image/")) return normalized;
  if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
  if (!normalized.startsWith("gs://")) return null;

  try {
    return await createSignedReadUrlForGcsUri(normalized, 3600);
  } catch {
    return null;
  }
}
