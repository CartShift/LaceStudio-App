import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { reviewAssetSchema } from "@/server/schemas/api";
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
    const body = validateOrThrow(reviewAssetSchema, await request.json());

    if (isDemoMode()) {
      const updated = demoStore.reviewAsset(id, assetId, body.action, {
        quality_score: body.quality_score,
        notes: body.notes,
        issue_tags: body.issue_tags,
        flag_artifacts: body.flag_artifacts,
      });
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this asset. Please refresh and try again.");
      }
      return ok(updated);
    }

    const asset = await prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.campaign_id !== id) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this asset. Please refresh and try again.");
    }

    const updated = await prisma.asset.update({
      where: { id: assetId },
      data: {
        status: body.action === "approve" ? "APPROVED" : body.action === "reject" ? "REJECTED" : "PENDING",
        reviewed_at: new Date(),
        quality_score: body.quality_score,
        moderation_notes: body.notes,
        issue_tags: body.issue_tags,
        artifacts_flagged: body.flag_artifacts,
      },
    });

    return ok(updated);
  });
}

