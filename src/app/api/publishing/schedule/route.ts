import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { schedulePostSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { schedulePublishingItem } from "@/server/services/publishing-schedule.service";

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);
    withRateLimit(session.userId, { maxRequests: 30 });
    const body = validateOrThrow(schedulePostSchema, await request.json());
    const scheduledAt = new Date(body.scheduled_at);

    if (isDemoMode()) {
      const asset = demoStore.listApprovedAssets().find((entry) => entry.id === body.asset_id);
      if (!asset) {
        throw new ApiError(404, "NOT_FOUND", "Only approved assets can be scheduled. Please approve the asset first.");
      }

      if ((asset.model?.id ?? null) !== body.profile_id) {
        throw new ApiError(400, "VALIDATION_ERROR", "The selected asset does not belong to this Instagram profile.");
      }

      if (body.hashtag_preset_id) {
        throw new ApiError(400, "VALIDATION_ERROR", "Hashtag presets are unavailable in demo mode. Enter hashtags manually or switch to live mode.");
      }

      const record = demoStore.schedulePost({
        asset_id: body.asset_id,
        variant_type: body.variant_type,
        post_type: body.post_type,
        caption: body.caption.trim(),
        hashtag_preset_id: body.hashtag_preset_id,
        scheduled_at: body.scheduled_at,
        created_by: session.userId,
      });

      return ok(
        {
          ...record,
          profile_id: body.profile_id,
          plan_item_id: body.plan_item_id ?? null,
          pillar_key: null,
          slot_start: body.scheduled_at,
          strategy_snapshot: null,
        },
        201,
      );
    }

    const record = await schedulePublishingItem({
      userId: session.userId,
      assetId: body.asset_id,
      profileId: body.profile_id,
      planItemId: body.plan_item_id,
      postType: body.post_type,
      variantType: body.variant_type,
      caption: body.caption,
      hashtagPresetId: body.hashtag_preset_id,
      scheduledAt,
    });

    return ok(record, 201);
  });
}
