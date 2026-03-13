import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { assetRefineSchema } from "@/server/schemas/api";
import { creativeControlsSchema } from "@/server/schemas/creative";
import {
  createDefaultCreativeControls,
  mergeCreativeControls,
} from "@/server/services/creative-controls";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; assetId: string }> },
) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id, assetId } = validateOrThrow(
      z.object({ id: z.uuid(), assetId: z.uuid() }),
      await context.params,
    );
    const body = validateOrThrow(assetRefineSchema, await request.json());

    if (isDemoMode()) {
      const result = demoStore.refineAsset(id, assetId, body);
      if (!result) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this Campaign or image. Refresh and try again.");
      }
      return ok(result, 201);
    }

    const [campaign, asset] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id },
        select: { id: true, creative_controls: true },
      }),
      prisma.asset.findUnique({
        where: { id: assetId },
        select: { id: true, campaign_id: true, refinement_history: true },
      }),
    ]);

    if (!campaign || !asset || asset.campaign_id !== id) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this Campaign or image. Refresh and try again.");
    }

    const patch = {
      ...(body.outfit_micro_adjustment
        ? {
            outfit: {
              micro_adjustment: body.outfit_micro_adjustment,
            },
          }
        : {}),
      ...(body.pose_micro_rotation
        ? {
            pose: {
              micro_rotation: body.pose_micro_rotation,
            },
          }
        : {}),
      ...(body.expression_micro_adjustment
        ? {
            expression: body.expression_micro_adjustment,
          }
        : {}),
      ...(body.realism_tuning
        ? {
            realism: body.realism_tuning,
          }
        : {}),
    };

    const mergedControls = mergeCreativeControls(
      campaign.creative_controls
        ? creativeControlsSchema.parse(campaign.creative_controls)
        : createDefaultCreativeControls(),
      patch,
    );

    const stateCount = await prisma.assetRefinementState.count({
      where: { asset_id: assetId },
    });
    const stateIndex = stateCount + 1;

    const updated = await prisma.$transaction(async (tx) => {
      await tx.assetRefinementState.create({
        data: {
          campaign_id: id,
          asset_id: assetId,
          state_index: stateIndex,
          label: body.reason ?? `Micro-refine ${stateIndex}`,
          controls_patch: patch,
          prompt_override: body.prompt_text,
          created_by: session.userId,
        },
      });

      await tx.campaign.update({
        where: { id },
        data: {
          creative_controls: mergedControls,
        },
      });

      return tx.asset.update({
        where: { id: assetId },
        data: {
          refinement_index: stateIndex,
          refinement_history: [
            ...(Array.isArray(asset.refinement_history) ? asset.refinement_history : []),
            {
              at: new Date().toISOString(),
              reason: body.reason ?? "Micro-refine",
              state_index: stateIndex,
            },
          ],
        },
      });
    });

    return ok(
      {
        state_index: stateIndex,
        asset: updated,
        generate_next: {
          endpoint: `/api/campaigns/${id}/generate`,
          payload: {
            prompt_text: body.prompt_text,
            regenerate_asset_id: assetId,
            creative_controls_override: patch,
          },
        },
      },
      201,
    );
  });
}

