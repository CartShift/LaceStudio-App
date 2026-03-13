import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const setCampaignAnchorSchema = z.object({
  asset_id: z.uuid(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(setCampaignAnchorSchema, await request.json());

    if (isDemoMode()) {
      const campaign = demoStore.getCampaign(id);
      if (!campaign) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      const updated = demoStore.setCampaignAnchor(id, body.asset_id);
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected anchor asset. Please choose another one.");
      }

      return ok(updated);
    }

    const [campaign, asset] = await Promise.all([
      prisma.campaign.findUnique({
        where: { id },
        select: { id: true },
      }),
      prisma.asset.findUnique({
        where: { id: body.asset_id },
        select: { id: true, campaign_id: true },
      }),
    ]);

    if (!campaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    if (!asset || asset.campaign_id !== id) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected anchor asset. Please choose another one.");
    }

    const updated = await prisma.campaign.update({
      where: { id },
      data: {
        anchor_asset_id: asset.id,
      },
      select: {
        id: true,
        anchor_asset_id: true,
      },
    });

    return ok({
      campaign_id: updated.id,
      anchor_asset_id: updated.anchor_asset_id,
    });
  });
}

