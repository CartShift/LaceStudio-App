import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { instagramProfileCreateSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { createInstagramProfile, listInstagramProfileSummaries } from "@/server/services/instagram-profiles.service";

const querySchema = z.object({
  profile_id: z.uuid().optional(),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));

    if (isDemoMode()) {
      const models = demoStore.listModels();
      const queue = demoStore.listPublishingQueue({
        start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const data = models
        .filter((model) => !query.profile_id || model.id === query.profile_id)
        .map((model) => {
          const modelQueue = queue.filter((item) => item.asset?.campaign?.model_id === model.id);
          return {
            id: model.id,
            model_id: model.id,
            model_name: model.name,
            handle: `@${model.name.toLowerCase().replace(/\s+/g, "_")}`,
            display_name: model.name,
            timezone: "UTC",
            connection_status: "CONNECTED",
            graph_user_id_preview: "****demo",
            publish_enabled: true,
            token_expires_at: null,
            last_analytics_sync_at: new Date().toISOString(),
            strategy: {
              primary_goal: "balanced_growth",
              weekly_post_target: 5,
              weekly_feed_target: 2,
              weekly_reel_target: 1,
              weekly_story_target: 2,
              cooldown_hours: 18,
              min_ready_assets: 3,
              active_pillars: 2,
              slot_count: 5,
              experimentation_rate_percent: 20,
              auto_queue_enabled: true,
              auto_queue_min_confidence: 0.72,
            },
            health: {
              cadence_score: 84,
              approved_assets_ready: demoStore.listApprovedAssets().filter((asset) => asset.model?.id === model.id).length,
              scheduled_count: modelQueue.filter((item) => item.status === "SCHEDULED").length,
              pending_approval_count: modelQueue.filter((item) => item.status === "PENDING_APPROVAL").length,
              failed_count: modelQueue.filter((item) => item.status === "FAILED").length,
              recommendation_count: 3,
              stale_analytics: false,
              warnings: [],
            },
            last_post: {
              publishing_queue_id: `demo-last-post-${model.id}`,
              published_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
              views: 22800,
              reach: 14600,
              engagement_rate: 5.3,
              pillar_key: "discoverability_reels",
            },
            next_posts: [],
          };
        });

      return ok({ data });
    }

    const data = await listInstagramProfileSummaries({
      profileId: query.profile_id,
    });
    return ok({ data });
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);
    const body = validateOrThrow(instagramProfileCreateSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        {
          id: body.model_id,
          model_id: body.model_id,
          handle: body.handle ?? null,
          display_name: body.display_name ?? null,
          timezone: body.timezone,
          publish_enabled: body.publish_enabled,
          connection_status: "DISCONNECTED",
        },
        201,
      );
    }

    const profile = await createInstagramProfile({
      modelId: body.model_id,
      userId: session.userId,
      handle: body.handle,
      displayName: body.display_name,
      timezone: body.timezone,
      publishEnabled: body.publish_enabled,
    });

    return ok(profile, 201);
  });
}
