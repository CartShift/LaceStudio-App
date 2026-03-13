import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { getAnalyticsStrategyData } from "@/server/services/analytics-reporting.service";

const querySchema = z.object({
  model_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
  pillar_key: z.string().trim().min(1).max(80).optional(),
  post_type: z.enum(["feed", "story", "reel"]).optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));

    if (isDemoMode()) {
      return ok({
        profile_breakdown: [],
        pillar_breakdown: [
          { pillar_key: "discoverability_reels", total_views: 68000, total_reach: 42000, avg_engagement_rate: 4.8, share_rate: 1.9, save_rate: 1.4, published_posts: 6 },
          { pillar_key: "editorial_identity", total_views: 46000, total_reach: 31000, avg_engagement_rate: 5.4, share_rate: 1.2, save_rate: 1.8, published_posts: 4 },
        ],
        daypart_breakdown: [
          { daypart: "midday", avg_views: 18200, avg_engagement_rate: 4.2, share_rate: 1.4, save_rate: 1.1, published_posts: 3 },
          { daypart: "evening", avg_views: 21400, avg_engagement_rate: 5.3, share_rate: 1.9, save_rate: 1.6, published_posts: 7 },
        ],
        best_time_windows: [
          { label: "Tue 11:30", avg_views: 22600, share_rate: 2.1, published_posts: 3 },
          { label: "Thu 15:00", avg_views: 21100, share_rate: 1.8, published_posts: 2 },
        ],
        schedule_adherence: {
          on_slot_percent: 92,
          avg_publish_delay_minutes: 8,
        },
        best_patterns: [
          { label: "reel · discoverability_reels", views: 24800, engagement_rate: 5.6, share_rate: 2.2, published_posts: 4 },
          { label: "story · relationship_stories", views: 13200, engagement_rate: 4.9, share_rate: 1.2, published_posts: 3 },
        ],
        experiment_win_rate: 50,
        reel_readiness: {
          ready_variants: 3,
          pending_jobs: 1,
          scheduled_reels: 2,
          published_reels: 4,
        },
      });
    }

    return ok(
      await getAnalyticsStrategyData({
        modelId: query.model_id,
        profileId: query.profile_id,
        pillarKey: query.pillar_key,
        postType: query.post_type,
        startDate: query.start_date,
        endDate: query.end_date,
      }),
    );
  });
}
