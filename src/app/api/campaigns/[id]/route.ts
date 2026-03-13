import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { imageModelProviderSchema } from "@/server/schemas/creative";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const campaignUpdateSchema = z
  .object({
    prompt_text: z.string().trim().min(1).max(8000).nullable().optional(),
    image_model_provider: imageModelProviderSchema.optional(),
    image_model_id: z.string().trim().min(1).max(120).nullable().optional(),
    batch_size: z.int().min(1).max(12).optional(),
    resolution_width: z.int().min(256).max(4096).optional(),
    resolution_height: z.int().min(256).max(4096).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field is required.",
  });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      const campaign = demoStore.getCampaign(id);
      if (!campaign) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      return ok(campaign);
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        assets: { orderBy: { sequence_number: "asc" } },
        generation_jobs: { orderBy: { dispatched_at: "desc" } },
        reference_versions: { orderBy: { version: "desc" }, take: 10 },
        refinement_states: { orderBy: { created_at: "desc" }, take: 30 },
        model: true,
      },
    });

    if (!campaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    return ok(campaign);
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(campaignUpdateSchema, await request.json());

    if (isDemoMode()) {
      const existing = demoStore.getCampaign(id);
      if (!existing) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      const nextProvider = body.image_model_provider ?? existing.image_model_provider;
      if (nextProvider === "gpu") {
        const model = demoStore.getModel(existing.model_id);
        const hasActiveVersion = model?.model_versions.some((version) => version.is_active) ?? false;
        if (!hasActiveVersion) {
          throw new ApiError(400, "VALIDATION_ERROR", "This Model has no active version for GPU image creation. Use another Image Engine or activate a version.");
        }
      }

      const updated = demoStore.updateCampaignSettings(id, body);
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      return ok(updated);
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        model: {
          include: {
            model_versions: {
              where: { is_active: true },
              take: 1,
            },
          },
        },
      },
    });

    if (!campaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    const nextProvider = body.image_model_provider ?? campaign.image_model_provider;
    if (nextProvider === "gpu" && campaign.model.model_versions.length === 0) {
      throw new ApiError(400, "VALIDATION_ERROR", "This Model has no active version for GPU image creation. Use another Image Engine or activate a version.");
    }

    const updated = await prisma.campaign.update({
      where: { id: campaign.id },
      data: {
        prompt_text: body.prompt_text,
        image_model_provider: body.image_model_provider,
        image_model_id: body.image_model_id,
        batch_size: body.batch_size,
        resolution_width: body.resolution_width,
        resolution_height: body.resolution_height,
      },
      include: {
        assets: { orderBy: { sequence_number: "asc" } },
        generation_jobs: { orderBy: { dispatched_at: "desc" } },
        reference_versions: { orderBy: { version: "desc" }, take: 10 },
        refinement_states: { orderBy: { created_at: "desc" }, take: 30 },
        model: true,
      },
    });

    return ok(updated);
  });
}

