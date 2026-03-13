import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { toInputJson } from "@/lib/prisma-json";
import { campaignDuplicateSchema } from "@/server/schemas/api";
import { creativeControlsSchema } from "@/server/schemas/creative";
import { createDefaultCreativeControls, mergeCreativeControls } from "@/server/services/creative-controls";
import { buildPrompt } from "@/server/services/prompt-builder";
import { adaptPromptTextForTargetModel, buildDuplicateCampaignName } from "@/server/services/campaign-linked-sets";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);
    withRateLimit(session.userId, { maxRequests: 20 });

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(campaignDuplicateSchema, await request.json());

    if (isDemoMode()) {
      const sourceCampaign = demoStore.getCampaign(id);
      if (!sourceCampaign) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      const models = demoStore.listModels();
      const modelById = new Map(models.map(model => [model.id, model]));
      const targetModels = body.model_ids.map(modelId => modelById.get(modelId) ?? null);

      if (targetModels.some(model => !model)) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find one or more selected models. Please refresh and try again.");
      }

      if (targetModels.some(model => model?.status !== "ACTIVE")) {
        throw new ApiError(400, "VALIDATION_ERROR", "Campaigns can only be duplicated to active models.");
      }

      if (sourceCampaign.image_model_provider === "gpu") {
        for (const model of targetModels) {
          const detail = model ? demoStore.getModel(model.id) : null;
          if (!(detail?.model_versions.some(version => version.is_active) ?? false)) {
            throw new ApiError(400, "VALIDATION_ERROR", "One or more selected models have no active version for GPU image creation. Use another Image Engine or activate a version.");
          }
        }
      }

      const duplicated = demoStore.duplicateCampaigns({
        sourceCampaignId: id,
        modelIds: body.model_ids,
        name: body.name,
        userId: session.userId,
      });

      if (!duplicated) {
        throw new ApiError(400, "VALIDATION_ERROR", "We couldn't duplicate this campaign with the selected models.");
      }

      return ok(
        {
          id: duplicated.primary_campaign_id,
          primary_campaign_id: duplicated.primary_campaign_id,
          duplicated_from_campaign_id: id,
          campaign_group_id: duplicated.campaign_group_id,
          campaigns: duplicated.campaigns.map(campaign => ({
            id: campaign.id,
            name: campaign.name,
            model_id: campaign.model_id,
          })),
        },
        201
      );
    }

    const sourceCampaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        model: {
          select: {
            id: true,
            name: true,
          },
        },
        preset_version: {
          include: {
            preset: {
              select: {
                mood_tag: true,
              },
            },
          },
        },
      },
    });

    if (!sourceCampaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    const targetModels = await prisma.aiModel.findMany({
      where: {
        id: {
          in: body.model_ids,
        },
      },
      include: {
        model_versions: {
          where: { is_active: true },
          take: 1,
        },
      },
    });
    const targetModelById = new Map(targetModels.map(model => [model.id, model]));
    const orderedTargetModels = body.model_ids.map(modelId => targetModelById.get(modelId) ?? null);

    if (orderedTargetModels.some(model => !model)) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find one or more selected models. Please refresh and try again.");
    }

    if (orderedTargetModels.some(model => model?.status !== "ACTIVE")) {
      throw new ApiError(400, "VALIDATION_ERROR", "Campaigns can only be duplicated to active models.");
    }

    if (sourceCampaign.image_model_provider === "gpu" && orderedTargetModels.some(model => (model?.model_versions.length ?? 0) === 0)) {
      throw new ApiError(400, "VALIDATION_ERROR", "One or more selected models have no active version for GPU image creation. Use another Image Engine or activate a version.");
    }

    const moodTag = sourceCampaign.preset_version.preset.mood_tag ?? "editorial luxe";
    const creativeControls = mergeCreativeControls(
      createDefaultCreativeControls(),
      sourceCampaign.creative_controls ? creativeControlsSchema.parse(sourceCampaign.creative_controls) : undefined
    );
    const campaignGroupId = sourceCampaign.campaign_group_id ?? sourceCampaign.id;

    const createdCampaigns = await prisma.$transaction(async tx => {
      if (!sourceCampaign.campaign_group_id) {
        await tx.campaign.update({
          where: { id: sourceCampaign.id },
          data: {
            campaign_group_id: campaignGroupId,
          },
        });
      }

      const result = [];

      for (const targetModel of orderedTargetModels) {
        if (!targetModel) {
          continue;
        }

        const fallbackPrompt = buildPrompt({
          modelName: targetModel.name,
          moodTag,
          customPromptAdditions: sourceCampaign.custom_prompt_additions ?? undefined,
          negativePrompt: sourceCampaign.negative_prompt ?? undefined,
          creativeControls,
        });

        result.push(
          await tx.campaign.create({
            data: {
              name: buildDuplicateCampaignName({
                sourceName: sourceCampaign.name,
                sourceModelName: sourceCampaign.model.name,
                targetModelName: targetModel.name,
                targetCount: orderedTargetModels.length,
                overrideName: body.name,
              }),
              model_id: targetModel.id,
              campaign_group_id: campaignGroupId,
              source_campaign_id: sourceCampaign.id,
              preset_version_id: sourceCampaign.preset_version_id,
              pose_pack_id: sourceCampaign.pose_pack_id,
              image_model_provider: sourceCampaign.image_model_provider,
              image_model_id: sourceCampaign.image_model_id,
              creative_controls: toInputJson(creativeControls),
              reference_board_version: sourceCampaign.reference_board_version,
              product_asset_url: sourceCampaign.product_asset_url,
              batch_size: sourceCampaign.batch_size,
              resolution_width: sourceCampaign.resolution_width,
              resolution_height: sourceCampaign.resolution_height,
              upscale: sourceCampaign.upscale,
              custom_prompt_additions: sourceCampaign.custom_prompt_additions,
              negative_prompt: sourceCampaign.negative_prompt ?? fallbackPrompt.negativePrompt,
              prompt_text: adaptPromptTextForTargetModel({
                sourcePromptText: sourceCampaign.prompt_text,
                sourceModelName: sourceCampaign.model.name,
                targetModelName: targetModel.name,
                fallbackPromptText: fallbackPrompt.promptText,
              }),
              status: "DRAFT",
              anchor_asset_id: null,
              base_seed: null,
              error_message: null,
              created_by: session.userId,
            },
          })
        );
      }

      return result;
    });

    return ok(
      {
        id: createdCampaigns[0]?.id,
        primary_campaign_id: createdCampaigns[0]?.id,
        duplicated_from_campaign_id: id,
        campaign_group_id: campaignGroupId,
        campaigns: createdCampaigns.map(campaign => ({
          id: campaign.id,
          name: campaign.name,
          model_id: campaign.model_id,
        })),
      },
      201
    );
  });
}
