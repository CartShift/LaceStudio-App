import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { generatePublishingCopySchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { buildPublishingCopyFromContext, generatePublishingCopy } from "@/server/services/publishing-copy.service";

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const body = validateOrThrow(generatePublishingCopySchema, await request.json());

    if (isDemoMode()) {
      const result = await buildPublishingCopyFromContext({
        mode: "vision_refined",
        fallbackSource: "metadata_fallback",
        context: {
          profileId: body.profile_id,
          displayName: "Demo Talent",
          handle: "@demo_talent",
          postType: body.post_type ?? "feed",
          variantType: body.variant_type ?? (body.post_type === "story" ? "story_9x16" : body.post_type === "reel" ? "reel_9x16" : "feed_4x5"),
          scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : new Date(Date.now() + 2 * 60 * 60 * 1000),
          daypart: "midday",
          primaryGoal: "balanced_growth",
          strategyNotes: "Demo strategy context.",
          pillar: {
            key: body.post_type === "reel" ? "discoverability_reels" : body.post_type === "story" ? "relationship_stories" : "editorial_identity",
            name: body.post_type === "reel" ? "Discoverability Reels" : body.post_type === "story" ? "Relationship Stories" : "Editorial Identity",
            description: "Demo publishing pillar",
          },
          experimentTag: null,
          personality: {
            social_voice: "bold",
            temperament: "confident",
            interests: ["fashion", "creative direction"],
            boundaries: ["No explicit content", "No political endorsements"],
            communication_style: {
              caption_tone: "aspirational",
              emoji_usage: "minimal",
              language_style: "balanced",
            },
            notes: "",
          },
          socialTracks: {
            reality_like_daily: {
              enabled: true,
              style_brief: "Natural lifestyle content with polished realism.",
              prompt_bias: "candid framing, daylight",
              target_ratio_percent: 60,
              weekly_post_goal: 3,
            },
            fashion_editorial: {
              enabled: true,
              style_brief: "High-polish editorial content with premium styling.",
              prompt_bias: "clean compositions, luxury tone",
              target_ratio_percent: 40,
              weekly_post_goal: 2,
            },
          },
          asset: {
            id: body.asset_id ?? "demo-asset",
            sequenceNumber: 1,
            promptText: "Premium editorial fashion portrait with soft daylight and strong silhouette.",
            issueTags: [],
            previewUrl: null,
            campaign: {
              id: "demo-campaign",
              name: "Demo Campaign",
              promptText: "Editorial fashion portrait in clean daylight.",
            },
          },
        },
      });

      return ok({
        caption: result.caption,
        caption_package: result.captionPackage,
        source: result.source,
      });
    }

    const result = await generatePublishingCopy({
      profileId: body.profile_id,
      planItemId: body.plan_item_id,
      assetId: body.asset_id,
      postType: body.post_type,
      variantType: body.variant_type,
      scheduledAt: body.scheduled_at ? new Date(body.scheduled_at) : undefined,
    });

    return ok({
      caption: result.caption,
      caption_package: result.captionPackage,
      source: result.source,
    });
  });
}
