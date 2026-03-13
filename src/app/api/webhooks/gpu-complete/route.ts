import { randomUUID } from "node:crypto";
import { buildCampaignVideoPrompt } from "@/lib/campaign-video";
import { ApiError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getEnv } from "@/lib/env";
import { validateOrThrow } from "@/lib/request";
import { gpuWebhookPayloadSchema } from "@/server/schemas/api";
import { estimateGpuCost } from "@/server/services/gpu-budget";
import { queueVideoJobsForAssets } from "@/server/services/video-generation.service";
import { verifyHmacSha256 } from "@/server/services/webhook-signature";

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const env = getEnv();
    const signature = request.headers.get("x-webhook-signature");
    const timestampHeader = request.headers.get("x-webhook-timestamp");

    if (!signature) {
      throw new ApiError(401, "UNAUTHENTICATED", "Webhook signature is missing. Include the signature header and try again.");
    }
    if (!timestampHeader) {
      throw new ApiError(401, "UNAUTHENTICATED", "Webhook timestamp is missing. Include the timestamp header and try again.");
    }

    const webhookTimestamp = parseWebhookTimestamp(timestampHeader);
    if (!webhookTimestamp) {
      throw new ApiError(401, "UNAUTHENTICATED", "Webhook timestamp is invalid. Send a valid timestamp and try again.");
    }

    const maxSkewMs = env.WEBHOOK_MAX_SKEW_MS ?? 5 * 60 * 1000;
    if (Math.abs(Date.now() - webhookTimestamp) > maxSkewMs) {
      throw new ApiError(401, "UNAUTHENTICATED", "Webhook timestamp is too old or too far in the future. Resend the request with a current timestamp.");
    }

    const rawBody = await request.text();
    if (!verifyHmacSha256(rawBody, env.GPU_WEBHOOK_SECRET, signature)) {
      throw new ApiError(401, "UNAUTHENTICATED", "Webhook signature is invalid. Check the secret and sign the request again.");
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      throw new ApiError(400, "VALIDATION_ERROR", "The request body is not valid JSON. Fix the JSON and try again.");
    }

    const payload = validateOrThrow(gpuWebhookPayloadSchema, parsedBody);

    const job = await prisma.generationJob.findUnique({
      where: { id: payload.job_id },
      include: {
        campaign: {
          select: {
            id: true,
            created_by: true,
            prompt_text: true,
            model: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
    if (!job) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this generation job. Refresh and try again.");
    }

    if (job.status === "COMPLETED") {
      return ok({ status: "ok", idempotent: true });
    }

    if (payload.status === "failed") {
      await prisma.$transaction([
        prisma.generationJob.update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error_message: payload.error_message,
            completed_at: new Date(),
          },
        }),
        prisma.campaign.update({
          where: { id: job.campaign.id },
          data: {
            status: "DRAFT",
            error_message: payload.error_message,
          },
        }),
      ]);

      return ok({ status: "failed_processed" });
    }

    const settings = await prisma.systemSetting.findUnique({ where: { key: "gpu_cost_per_ms" } });
    const ratePerMs = Number(settings?.value ?? 0.0000005);
    let createdAssetIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      const latestAsset = await tx.asset.findFirst({
        where: { campaign_id: job.campaign.id },
        orderBy: { sequence_number: "desc" },
        select: { sequence_number: true },
      });
      let sequence = (latestAsset?.sequence_number ?? 0) + 1;
      const persistedAssets = payload.assets.map((item) => {
        const asset = {
          id: randomUUID(),
          campaign_id: job.campaign.id,
          job_id: job.id,
          status: "PENDING" as const,
          raw_gcs_uri: item.file_path,
          seed: item.seed,
          width: item.width,
          height: item.height,
          prompt_text: item.prompt_text,
          generation_time_ms: item.generation_time_ms,
          sequence_number: sequence,
        };

        sequence += 1;
        return asset;
      });
      createdAssetIds = persistedAssets.map((asset) => asset.id);

      if (persistedAssets.length > 0) {
        await tx.asset.createMany({
          data: persistedAssets,
        });
      }

      await tx.generationJob.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          response_payload: payload,
          generation_time_ms: payload.total_generation_time_ms,
          estimated_cost_usd: estimateGpuCost(payload.total_generation_time_ms ?? 0, ratePerMs),
          gpu_type: payload.gpu_type,
          completed_at: new Date(),
        },
      });

      await tx.campaign.update({
        where: { id: job.campaign.id },
        data: { status: "REVIEW" },
      });
    });

    const videoPlan = readVideoGenerationPlan(job.payload);
    if (videoPlan.enabled && videoPlan.planned_for_run) {
      const promptText = buildCampaignVideoPrompt({
        campaignPromptText: job.campaign.prompt_text,
        motionPromptText: videoPlan.prompt_text,
        modelName: job.campaign.model.name,
      });

      await queueVideoJobsForAssets({
        assetIds: createdAssetIds,
        userId: job.campaign.created_by,
        promptText,
        durationSeconds: videoPlan.duration_seconds,
        allowPendingAssets: true,
      });
    }

    return ok({ status: "ok" });
  });
}

function parseWebhookTimestamp(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric)) {
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function readVideoGenerationPlan(payload: unknown): {
  enabled: boolean;
  duration_seconds: number;
  prompt_text?: string;
  planned_for_run: boolean;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      enabled: false,
      duration_seconds: 8,
      planned_for_run: false,
    };
  }

  const candidate = "video_generation" in payload ? payload.video_generation : null;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {
      enabled: false,
      duration_seconds: 8,
      planned_for_run: false,
    };
  }

  const plan = candidate as Record<string, unknown>;
  const duration_seconds = Number(plan.duration_seconds);

  return {
    enabled: plan.enabled === true,
    duration_seconds: Number.isFinite(duration_seconds) && duration_seconds >= 6 && duration_seconds <= 8 ? duration_seconds : 8,
    prompt_text: typeof plan.prompt_text === "string" ? plan.prompt_text : undefined,
    planned_for_run: plan.planned_for_run === true,
  };
}

