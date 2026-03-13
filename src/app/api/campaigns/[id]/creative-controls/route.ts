import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { campaignCreativeUpdateSchema } from "@/server/schemas/api";
import { creativeControlsSchema } from "@/server/schemas/creative";
import {
  createDefaultCreativeControls,
  mergeCreativeControls,
} from "@/server/services/creative-controls";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

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

      return ok({
        campaign_id: id,
        creative_controls: campaign.creative_controls,
      });
    }

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, creative_controls: true },
    });

    if (!campaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    return ok({
      campaign_id: id,
      creative_controls: campaign.creative_controls
        ? creativeControlsSchema.parse(campaign.creative_controls)
        : createDefaultCreativeControls(),
    });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(campaignCreativeUpdateSchema, await request.json());

    if (isDemoMode()) {
      const campaign = demoStore.updateCampaignCreativeControls(id, body.creative_controls);
      if (!campaign) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }
      return ok(campaign);
    }

    const existing = await prisma.campaign.findUnique({
      where: { id },
      select: { creative_controls: true },
    });
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    const merged = mergeCreativeControls(
      existing.creative_controls
        ? creativeControlsSchema.parse(existing.creative_controls)
        : createDefaultCreativeControls(),
      body.creative_controls,
    );

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        creative_controls: merged,
      },
    });

    return ok(updated);
  });
}

