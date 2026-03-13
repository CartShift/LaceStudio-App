import { prisma } from "@/lib/prisma";
import { generatePostingPlanForProfile, getPostingStrategyForProfile, listPostingPlanItems } from "@/server/services/posting-strategy.service";
import { schedulePublishingItem } from "@/server/services/publishing-schedule.service";

export async function materializeAutoQueueRecommendations(now = new Date()): Promise<number> {
  const profiles = await prisma.instagramProfile.findMany({
    where: {
      publish_enabled: true,
      connection_status: "CONNECTED",
    },
    select: {
      id: true,
      created_by: true,
      model_id: true,
    },
  });

  let queued = 0;

  for (const profile of profiles) {
    const strategy = await getPostingStrategyForProfile(profile.id);
    if (!strategy.auto_queue_enabled) continue;

    await generatePostingPlanForProfile({
      profileId: profile.id,
      now,
      horizonDays: 10,
      limit: 12,
    });

    const readyAssets = await prisma.asset.count({
      where: {
        status: "APPROVED",
        campaign: {
          model_id: profile.model_id,
        },
        publishing_queue: {
          none: {
            status: {
              in: ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"],
            },
          },
        },
      },
    });

    if (readyAssets < strategy.min_ready_assets) continue;

    const recommendations = await listPostingPlanItems({
      profileId: profile.id,
      status: "RECOMMENDED",
      horizonDays: 10,
    });

    for (const item of recommendations) {
      if ((item.confidence ?? 0) < strategy.auto_queue_min_confidence) continue;
      if (!item.asset_id) continue;
      if (item.post_type === "reel" && item.autopilot_metadata?.reel_variant_ready !== true) continue;

      try {
        await schedulePublishingItem({
          userId: profile.created_by,
          assetId: item.asset_id,
          profileId: profile.id,
          planItemId: item.id,
          postType: item.post_type,
          variantType: item.variant_type,
          caption: item.caption_suggestion ?? "Scheduled from auto-queue optimization.",
          scheduledAt: new Date(item.slot_start),
        });
        queued += 1;
      } catch {
        // Keep auto-queue opportunistic; conflicts and validation failures should not abort the batch.
      }
    }
  }

  return queued;
}
