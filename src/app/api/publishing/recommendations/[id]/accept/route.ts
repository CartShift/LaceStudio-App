import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recommendationAcceptSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { schedulePublishingItem } from "@/server/services/publishing-schedule.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(recommendationAcceptSchema, await request.json());

    if (isDemoMode()) {
      const asset = body.asset_id
        ? demoStore.listApprovedAssets().find((item) => item.id === body.asset_id)
        : demoStore.listApprovedAssets().find((item) => item.model?.id === body.profile_id);

      if (!asset) {
        throw new ApiError(400, "VALIDATION_ERROR", "No approved asset is available for this recommendation.");
      }

      const record = demoStore.schedulePost({
        asset_id: asset.id,
        variant_type: body.variant_type ?? "feed_4x5",
        post_type: body.post_type ?? "feed",
        caption: body.caption ?? "Scheduled from the demo strategy recommendation.",
        scheduled_at: body.scheduled_at ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        created_by: session.userId,
      });

      return ok(
        {
          ...record,
          profile_id: body.profile_id,
          plan_item_id: id,
        },
        201,
      );
    }

    const planItem = await prisma.postingPlanItem.findUnique({
      where: { id },
      include: {
        profile: true,
      },
    });

    if (!planItem) {
      throw new ApiError(404, "NOT_FOUND", "Recommendation not found.");
    }

    const assetId = body.asset_id ?? planItem.asset_id;
    if (!assetId) {
      throw new ApiError(400, "VALIDATION_ERROR", "This recommendation needs an approved asset before it can be scheduled.");
    }

    const scheduledAt = new Date(body.scheduled_at ?? planItem.slot_start.toISOString());
    const queueItem = await schedulePublishingItem({
      userId: session.userId,
      assetId,
      profileId: body.profile_id,
      planItemId: planItem.id,
      postType: body.post_type ?? planItem.post_type,
      variantType: body.variant_type ?? planItem.variant_type,
      caption: body.caption ?? planItem.caption_suggestion ?? "Scheduled from the posting strategy recommendation.",
      scheduledAt,
    });

    return ok(queueItem, 201);
  });
}
