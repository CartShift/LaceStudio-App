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
        [0, 1, 2].map((offset) => {
          const postType = offset === 1 ? "reel" as const : offset === 2 ? "story" as const : "feed" as const;
          const variantType = postType === "reel" ? "reel_9x16" as const : postType === "story" ? "story_9x16" as const : "feed_4x5" as const;
          const captionPackage = {
            caption: "",
            primary_keyword: postType === "reel" ? "behind the scenes reel" : "editorial model shoot",
            hook: postType === "reel" ? "Three seconds that stop the scroll." : "One clean frame worth saving.",
            opening_hook: postType === "reel" ? "Three seconds that stop the scroll." : "One clean frame worth saving.",
            body: "A demo strategic draft aligned to the profile voice, slot timing, and selected content lane.",
            call_to_action: postType === "story" ? "Reply with the version you want next." : "Save this for your next creative direction board.",
            hashtags: ["#modelagency", "#contentstrategy", postType === "reel" ? "#instagramreels" : "#editorialshoot"],
            rationale: "Demo caption package showing keyword, hook, CTA, and hashtag guidance for the selected slot.",
            strategy_alignment: "Balanced growth aligned to the demo publishing lane.",
            compliance_summary: "Demo copy keeps claims grounded and respects profile boundaries.",
            source: "metadata_draft" as const,
          };
          captionPackage.caption = `${captionPackage.hook}\n\n${captionPackage.body}\n\n${captionPackage.call_to_action}\n\n${captionPackage.hashtags.join(" ")}`;

          return {
          id: `${profile.id}-rec-${offset + 1}`,
          profile_id: profile.id,
          strategy_id: null,
          pillar_id: null,
          pillar_key: postType === "reel" ? "discoverability_reels" : postType === "story" ? "relationship_stories" : "editorial_identity",
          asset_id: demoStore.listApprovedAssets().find((asset) => asset.model?.id === profile.id)?.id ?? null,
          status: "RECOMMENDED" as const,
          slot_start: new Date(Date.now() + (offset + 1) * 24 * 60 * 60 * 1000).toISOString(),
          slot_end: null,
          post_type: postType,
          variant_type: variantType,
          rationale: "Demo recommendation generated from the 2026 strategy engine with format-aware scoring.",
          confidence: postType === "reel" ? 0.87 : 0.82,
          caption_suggestion: captionPackage.caption,
          caption_package: captionPackage,
          autopilot_metadata: {
            experiment: offset === 2,
            experiment_tag: offset === 2 ? "story-replies-test" : null,
            queue_eligible: postType !== "reel" || offset !== 1 ? true : true,
            reel_variant_ready: postType !== "reel" ? null : true,
            score_breakdown: {
              performance_index: postType === "reel" ? 1.18 : 1.04,
              time_window_score: postType === "reel" ? 0.91 : 0.84,
            },
          },
          decided_at: null,
          asset: null,
        };
        }),
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
