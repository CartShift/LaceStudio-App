import { ApiError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getEnv } from "@/lib/env";
import { validateOrThrow } from "@/lib/request";
import { gpuWebhookPayloadSchema } from "@/server/schemas/api";
import { estimateGpuCost } from "@/server/services/gpu-budget";
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

    const job = await prisma.generationJob.findUnique({ where: { id: payload.job_id } });
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
          where: { id: job.campaign_id },
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

    await prisma.$transaction(async (tx) => {
      let sequence = 1;
      for (const item of payload.assets) {
        await tx.asset.create({
          data: {
            campaign_id: job.campaign_id,
            job_id: job.id,
            status: "PENDING",
            raw_gcs_uri: item.file_path,
            seed: item.seed,
            width: item.width,
            height: item.height,
            prompt_text: item.prompt_text,
            generation_time_ms: item.generation_time_ms,
            sequence_number: sequence,
          },
        });

        sequence += 1;
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
        where: { id: job.campaign_id },
        data: { status: "REVIEW" },
      });
    });

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

