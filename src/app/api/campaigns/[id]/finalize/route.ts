import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      const result = demoStore.finalizeCampaign(id);
      if (!result) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
      }

      return ok(result);
    }

    const campaign = await prisma.campaign.findUnique({ where: { id } });
    if (!campaign) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
    }

    const assets = await prisma.asset.findMany({ where: { campaign_id: id } });
    const approved = assets.filter((asset) => asset.status === "APPROVED").length;
    const rejected = assets.filter((asset) => asset.status === "REJECTED").length;

    const status = approved > 0 ? "APPROVED" : "REJECTED";

    await prisma.campaign.update({
      where: { id },
      data: { status },
    });

    return ok({
      campaign_status: status,
      approved_count: approved,
      rejected_count: rejected,
    });
  });
}

