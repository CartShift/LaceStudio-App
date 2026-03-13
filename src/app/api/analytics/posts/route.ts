import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { toPagination } from "@/server/repositories/pagination";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { listLatestAnalyticsPostsPage } from "@/server/services/analytics-reporting.service";

const querySchema = z.object({
  model_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
  pillar_key: z.string().trim().min(1).max(80).optional(),
  post_type: z.enum(["feed", "story", "reel"]).optional(),
  start_date: z.coerce.date().optional(),
  end_date: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  sort_by: z.enum(["engagement_rate", "reach", "fetched_at"]).optional(),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (isDemoMode()) {
      return ok(demoStore.analyticsPosts());
    }

    const { skip, take, page, limit } = toPagination(query);
    const result = await listLatestAnalyticsPostsPage({
      filters: {
        modelId: query.model_id,
        profileId: query.profile_id,
        pillarKey: query.pillar_key,
        postType: query.post_type,
        startDate: query.start_date,
        endDate: query.end_date,
      },
      sortBy: query.sort_by ?? "fetched_at",
      skip,
      take,
    });

    return ok({
      data: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
      },
    });
  });
}

