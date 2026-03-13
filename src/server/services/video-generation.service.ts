import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { getEnv } from "@/lib/env";
import { getVideoGenerationProvider } from "@/server/providers";
import { resolvePublishingAssetPreviewUrl } from "@/server/services/publishing-assets";
import { createSignedReadUrlForGcsUri } from "@/server/services/storage/gcs-storage";
import type { ReelVariantSummary, VideoGenerationJob as VideoGenerationJobDto } from "@/types/domain";

type PersistedVideoJob = Awaited<ReturnType<typeof prisma.videoGenerationJob.findUniqueOrThrow>>;

const DEFAULT_REEL_PROMPT =
  "Create a polished 9:16 Instagram Reel from this approved asset with subtle motion, original-audio pacing, premium fashion energy, and a clean loop-friendly finish.";

export async function createReelVariantJob(input: {
  assetId: string;
  userId: string;
  promptText?: string;
  durationSeconds?: number;
  sourceVariantId?: string;
}): Promise<VideoGenerationJobDto> {
  const asset = await prisma.asset.findUnique({
    where: { id: input.assetId },
    include: {
      campaign: {
        include: {
          model: {
            select: {
              name: true,
            },
          },
        },
      },
      variants: true,
    },
  });

  if (!asset || asset.status !== "APPROVED") {
    throw new ApiError(404, "NOT_FOUND", "Approved asset not found.");
  }

  const sourceVariant =
    asset.variants.find((variant) => variant.id === input.sourceVariantId) ??
    asset.variants.find((variant) => variant.format_type === "story_9x16") ??
    asset.variants.find((variant) => variant.format_type === "feed_4x5") ??
    asset.variants[0] ??
    null;

  const sourceUrl = await resolveMediaSourceUrl(
    sourceVariant?.preview_image_gcs_uri ?? sourceVariant?.gcs_uri ?? asset.approved_gcs_uri ?? asset.raw_gcs_uri,
  );
  const promptText =
    input.promptText?.trim() ||
    `Model ${asset.campaign.model.name}: ${DEFAULT_REEL_PROMPT}`;
  const provider = getVideoGenerationProvider();
  const providerResult = await provider.createVideo({
    imageUrl: sourceUrl,
    prompt: promptText,
    aspectRatio: "9:16",
    durationSeconds: input.durationSeconds ?? 8,
  });

  const created = await prisma.videoGenerationJob.create({
    data: {
      asset_id: asset.id,
      source_variant_id: sourceVariant?.id ?? null,
      status: providerResult.status,
      prompt_text: promptText,
      provider: getEnv().VIDEO_PROVIDER_MODE === "live" ? "veo" : "mock_video",
      provider_job_id: providerResult.providerJobId,
      duration_ms_target: (input.durationSeconds ?? 8) * 1000,
      output_url: providerResult.outputUrl ?? null,
      preview_image_url: providerResult.previewImageUrl ?? null,
      error_message: providerResult.errorMessage ?? null,
      metadata: toInputJson(providerResult.metadata ?? {}),
      created_by: input.userId,
    },
    include: {
      output_variant: true,
    },
  });

  if (providerResult.status === "COMPLETED") {
    await finalizeVideoJob(created.id, providerResult);
  }

  return getVideoGenerationJob(created.id);
}

export async function processPendingVideoGenerationJobs(): Promise<number> {
  const jobs = await prisma.videoGenerationJob.findMany({
    where: {
      status: {
        in: ["PENDING", "PROCESSING"],
      },
      provider_job_id: {
        not: null,
      },
    },
    orderBy: {
      created_at: "asc",
    },
    take: 20,
  });

  const provider = getVideoGenerationProvider();
  let completed = 0;

  for (const job of jobs) {
    if (!job.provider_job_id) continue;

    try {
      const result = await provider.getJob(job.provider_job_id);
      await prisma.videoGenerationJob.update({
        where: { id: job.id },
        data: {
          status: result.status,
          output_url: result.outputUrl ?? null,
          preview_image_url: result.previewImageUrl ?? null,
          error_message: result.errorMessage ?? null,
          metadata: toInputJson(result.metadata ?? {}),
          completed_at: result.status === "COMPLETED" ? new Date() : null,
        },
      });

      if (result.status === "COMPLETED") {
        await finalizeVideoJob(job.id, result);
        completed += 1;
      }
    } catch (error) {
      await prisma.videoGenerationJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          error_message: error instanceof Error ? error.message : "Unknown video generation error",
        },
      });
    }
  }

  return completed;
}

export async function listReelVariantJobs(assetId: string): Promise<VideoGenerationJobDto[]> {
  const jobs = await prisma.videoGenerationJob.findMany({
    where: { asset_id: assetId },
    include: {
      output_variant: true,
    },
    orderBy: [{ created_at: "desc" }],
  });

  return Promise.all(jobs.map((job) => serializeVideoGenerationJob(job)));
}

export async function listReelVariants(assetId: string): Promise<ReelVariantSummary[]> {
  const variants = await prisma.assetVariant.findMany({
    where: {
      asset_id: assetId,
      format_type: "reel_9x16",
    },
    orderBy: { created_at: "desc" },
  });

  return Promise.all(variants.map((variant) => serializeReelVariant(variant)));
}

export async function getVideoGenerationJob(jobId: string): Promise<VideoGenerationJobDto> {
  const job = await prisma.videoGenerationJob.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      output_variant: true,
    },
  });

  return serializeVideoGenerationJob(job);
}

async function finalizeVideoJob(jobId: string, result: { outputUrl?: string | null; previewImageUrl?: string | null }) {
  if (!result.outputUrl) {
    throw new ApiError(502, "INTERNAL_ERROR", "Video generation completed without an output URL.");
  }

  const job = await prisma.videoGenerationJob.findUniqueOrThrow({
    where: { id: jobId },
  });

  const outputVariant = await prisma.assetVariant.upsert({
    where: {
      asset_id_format_type: {
        asset_id: job.asset_id,
        format_type: "reel_9x16",
      },
    },
    update: {
      gcs_uri: result.outputUrl,
      media_kind: "video",
      width: 1080,
      height: 1920,
      duration_ms: job.duration_ms_target,
      mime_type: "video/mp4",
      preview_image_gcs_uri: result.previewImageUrl ?? null,
    },
    create: {
      asset_id: job.asset_id,
      format_type: "reel_9x16",
      gcs_uri: result.outputUrl,
      media_kind: "video",
      width: 1080,
      height: 1920,
      duration_ms: job.duration_ms_target,
      mime_type: "video/mp4",
      preview_image_gcs_uri: result.previewImageUrl ?? null,
    },
  });

  await prisma.videoGenerationJob.update({
    where: { id: jobId },
    data: {
      status: "COMPLETED",
      output_variant_id: outputVariant.id,
      output_url: result.outputUrl,
      preview_image_url: result.previewImageUrl ?? null,
      completed_at: new Date(),
    },
  });
}

async function serializeVideoGenerationJob(
  job: PersistedVideoJob & {
    output_variant?: {
      id: string;
      asset_id: string;
      format_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
      media_kind: "image" | "video";
      gcs_uri: string;
      width: number;
      height: number;
      duration_ms: number | null;
      mime_type: string | null;
      preview_image_gcs_uri: string | null;
      created_at: Date;
    } | null;
  },
): Promise<VideoGenerationJobDto> {
  return {
    id: job.id,
    asset_id: job.asset_id,
    status: job.status,
    provider: job.provider,
    provider_job_id: job.provider_job_id,
    prompt_text: job.prompt_text,
    duration_ms_target: job.duration_ms_target,
    aspect_ratio: job.aspect_ratio,
    output_url: job.output_url,
    preview_image_url: job.preview_image_url,
    error_message: job.error_message,
    metadata: asRecord(job.metadata),
    output_variant: job.output_variant ? await serializeReelVariant(job.output_variant) : null,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
    completed_at: job.completed_at?.toISOString() ?? null,
  };
}

async function serializeReelVariant(variant: {
  id: string;
  asset_id: string;
  format_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
  media_kind: "image" | "video";
  gcs_uri: string;
  width: number;
  height: number;
  duration_ms: number | null;
  mime_type: string | null;
  preview_image_gcs_uri: string | null;
  created_at: Date;
}): Promise<ReelVariantSummary> {
  return {
    id: variant.id,
    asset_id: variant.asset_id,
    format_type: variant.format_type,
    media_kind: variant.media_kind,
    gcs_uri: variant.gcs_uri,
    preview_url: await resolvePublishingAssetPreviewUrl(variant.preview_image_gcs_uri ?? variant.gcs_uri),
    width: variant.width,
    height: variant.height,
    duration_ms: variant.duration_ms,
    mime_type: variant.mime_type,
    created_at: variant.created_at.toISOString(),
  };
}

async function resolveMediaSourceUrl(source: string | null | undefined): Promise<string> {
  const normalized = source?.trim();
  if (!normalized) {
    throw new ApiError(400, "VALIDATION_ERROR", "No media source is available for Reel generation.");
  }

  if (normalized.startsWith("http://") || normalized.startsWith("https://")) {
    return normalized;
  }

  if (normalized.startsWith("gs://")) {
    return createSignedReadUrlForGcsUri(normalized, 3600);
  }

  return normalized;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
