import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { generatePostingPlanForProfile, listPostingPlanItems } from "@/server/services/posting-strategy.service";
import { listInstagramProfileSummaries } from "@/server/services/instagram-profiles.service";

const querySchema = z.object({
  profile_id: z.uuid().optional(),
  horizon_days: z.coerce.number().int().min(7).max(21).optional(),
  status: z.enum(["RECOMMENDED", "SCHEDULED", "SKIPPED", "PUBLISHED", "CANCELLED"]).optional(),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));

    if (isDemoMode()) {
      const profiles = await listInstagramProfileSummaries({
        profileId: query.profile_id,
      });
      const data = profiles.flatMap((profile) =>
        [0, 1, 2].map((offset) => ({
          id: `${profile.id}-rec-${offset + 1}`,
          profile_id: profile.id,
          strategy_id: null,
          pillar_id: null,
          pillar_key: offset % 2 === 0 ? "reality_like_daily" : "fashion_editorial",
          asset_id: demoStore.listApprovedAssets().find((asset) => asset.model?.id === profile.id)?.id ?? null,
          status: "RECOMMENDED" as const,
          slot_start: new Date(Date.now() + (offset + 1) * 24 * 60 * 60 * 1000).toISOString(),
          slot_end: null,
          post_type: offset % 2 === 0 ? "feed" as const : "story" as const,
          variant_type: offset % 2 === 0 ? "feed_4x5" as const : "story_9x16" as const,
          rationale: "Demo recommendation from the strategy engine.",
          confidence: 0.82,
          caption_suggestion: `Demo next post for ${profile.model_name}.`,
          decided_at: null,
          asset: null,
        })),
      );
      return ok({ data });
    }

    if (query.profile_id) {
      await generatePostingPlanForProfile({
        profileId: query.profile_id,
        horizonDays: query.horizon_days,
      });
    } else {
      const profiles = await listInstagramProfileSummaries();
      await Promise.all(
        profiles.map((profile) =>
          generatePostingPlanForProfile({
            profileId: profile.id,
            horizonDays: query.horizon_days,
          }),
        ),
      );
    }

    return ok({
      data: await listPostingPlanItems({
        profileId: query.profile_id,
        status: query.status,
        horizonDays: query.horizon_days,
      }),
    });
  });
}
