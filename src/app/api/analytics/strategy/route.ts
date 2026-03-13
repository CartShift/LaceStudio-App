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
          { pillar_key: "reality_like_daily", total_reach: 42000, avg_engagement_rate: 4.8, published_posts: 6 },
          { pillar_key: "fashion_editorial", total_reach: 31000, avg_engagement_rate: 5.4, published_posts: 4 },
        ],
        daypart_breakdown: [
          { daypart: "morning", avg_engagement_rate: 4.2, published_posts: 3 },
          { daypart: "evening", avg_engagement_rate: 5.3, published_posts: 7 },
        ],
        schedule_adherence: {
          on_slot_percent: 92,
          avg_publish_delay_minutes: 8,
        },
        best_patterns: [
          { label: "feed · fashion_editorial", engagement_rate: 5.6, published_posts: 4 },
          { label: "story · reality_like_daily", engagement_rate: 4.9, published_posts: 3 },
        ],
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
