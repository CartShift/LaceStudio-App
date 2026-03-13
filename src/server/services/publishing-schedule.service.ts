import { ApiError } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { ACTIVE_PUBLISHING_QUEUE_STATUSES } from "@/server/services/publishing-assets";

const MIN_SCHEDULE_LEAD_MINUTES = 15;
const MAX_CAPTION_LENGTH = 2200;

export function validatePostTypeVariant(
  postType: "feed" | "story" | "reel",
  variantType: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master",
) {
  if (postType === "feed" && !["feed_1x1", "feed_4x5"].includes(variantType)) {
    throw new ApiError(400, "VALIDATION_ERROR", "Feed posts support only feed_1x1 or feed_4x5. Choose one of those formats and try again.");
  }

  if (postType === "story" && variantType !== "story_9x16") {
    throw new ApiError(400, "VALIDATION_ERROR", "Story posts require the story_9x16 format. Switch to that format and try again.");
  }

  if (postType === "reel" && variantType !== "reel_9x16") {
    throw new ApiError(400, "VALIDATION_ERROR", "Reel posts require the reel_9x16 format.");
  }
}

export function validateScheduledAt(date: Date) {
  const minDate = new Date(Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000);
  if (date.getTime() < minDate.getTime()) {
    throw new ApiError(400, "VALIDATION_ERROR", `Scheduled time must be at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes in the future.`);
  }
}

export function appendHashtags(caption: string, hashtags: string[]): string {
  const normalized = hashtags
    .map((tag) => tag.trim())
    .filter(Boolean)
    .map((tag) => (tag.startsWith("#") ? tag : `#${tag}`))
    .map((tag) => tag.replace(/\s+/g, ""));

  if (normalized.length === 0) return caption;

  const existing = new Set(
    (caption.match(/#[A-Za-z0-9_]+/g) ?? []).map((tag) => tag.toLowerCase()),
  );
  const deduped = Array.from(new Set(normalized.map((tag) => tag.toLowerCase())))
    .map((lower) => normalized.find((tag) => tag.toLowerCase() === lower) as string)
    .filter((tag) => !existing.has(tag.toLowerCase()));

  return deduped.length > 0 ? `${caption} ${deduped.join(" ")}`.trim() : caption.trim();
}

export async function schedulePublishingItem(input: {
  userId: string;
  assetId: string;
  profileId: string;
  planItemId?: string;
  postType: "feed" | "story" | "reel";
  variantType: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
  caption: string;
  hashtagPresetId?: string;
  scheduledAt: Date;
}) {
  validatePostTypeVariant(input.postType, input.variantType);
  validateScheduledAt(input.scheduledAt);

  let caption = input.caption.trim();

  const [profile, asset, activeQueueItem, hashtagPreset, approvalSetting, planItem, strategy] = await Promise.all([
    prisma.instagramProfile.findUnique({
      where: { id: input.profileId },
      include: {
        model: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    }),
    prisma.asset.findUnique({
      where: { id: input.assetId },
      select: {
        id: true,
        status: true,
        sequence_number: true,
        variants: {
          select: {
            id: true,
            format_type: true,
            media_kind: true,
          },
        },
        campaign: {
          select: {
            model_id: true,
            name: true,
          },
        },
      },
    }),
    prisma.publishingQueue.findFirst({
      where: {
        asset_id: input.assetId,
        status: {
          in: [...ACTIVE_PUBLISHING_QUEUE_STATUSES],
        },
      },
      select: {
        id: true,
        status: true,
        scheduled_at: true,
      },
      orderBy: {
        scheduled_at: "asc",
      },
    }),
    input.hashtagPresetId
      ? prisma.hashtagPreset.findUnique({
          where: { id: input.hashtagPresetId },
          select: {
            id: true,
            hashtags: true,
          },
        })
      : Promise.resolve(null),
    prisma.systemSetting.findUnique({
      where: { key: "require_publishing_approval" },
    }),
    input.planItemId
      ? prisma.postingPlanItem.findUnique({
          where: { id: input.planItemId },
          select: {
            id: true,
            profile_id: true,
            pillar_key: true,
            strategy_snapshot: true,
            autopilot_metadata: true,
            slot_start: true,
          },
        })
      : Promise.resolve(null),
    prisma.postingStrategy.findUnique({
      where: { profile_id: input.profileId },
      include: {
        pillars: true,
      },
    }),
  ]);

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  if (!asset || asset.status !== "APPROVED") {
    throw new ApiError(400, "VALIDATION_ERROR", "Only approved assets can be scheduled. Please approve the asset first.");
  }

  if (!asset.campaign || asset.campaign.model_id !== profile.model_id) {
    throw new ApiError(400, "VALIDATION_ERROR", "The selected asset does not belong to this Instagram profile's model.");
  }

  if (activeQueueItem) {
    throw new ApiError(
      400,
      "VALIDATION_ERROR",
      `This asset is already attached to a ${activeQueueItem.status.toLowerCase().replaceAll("_", " ")} queue item scheduled for ${activeQueueItem.scheduled_at.toISOString()}. Choose another asset or manage the existing queue item first.`,
    );
  }

  if (input.hashtagPresetId && !hashtagPreset) {
    throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected hashtag set. Choose another one and try again.");
  }

  if (planItem && planItem.profile_id !== input.profileId) {
    throw new ApiError(400, "VALIDATION_ERROR", "The selected recommendation belongs to a different Instagram profile.");
  }

  if (input.postType === "reel" && !asset.variants.some((variant) => variant.format_type === "reel_9x16" && variant.media_kind === "video")) {
    throw new ApiError(400, "VALIDATION_ERROR", "This asset does not have a generated reel_9x16 video variant yet.");
  }

  if (hashtagPreset) {
    caption = appendHashtags(caption, hashtagPreset.hashtags);
  }

  if (caption.length > MAX_CAPTION_LENGTH) {
    throw new ApiError(400, "VALIDATION_ERROR", "Caption is too long. Keep it under 2,200 characters.");
  }

  const requiresApproval = approvalSetting ? Boolean(approvalSetting.value) : true;
  const pillarKey = planItem?.pillar_key ?? null;
  const strategySnapshot = planItem?.strategy_snapshot ?? {
    strategy_id: strategy?.id ?? null,
    profile_id: profile.id,
    profile_handle: profile.handle,
    weekly_post_target: strategy?.weekly_post_target ?? null,
    pillar_key: pillarKey,
  };

  return prisma.$transaction(async (tx) => {
    const created = await tx.publishingQueue.create({
      data: {
        asset_id: input.assetId,
        profile_id: profile.id,
        plan_item_id: input.planItemId,
        variant_type: input.variantType,
        post_type: input.postType,
        pillar_key: pillarKey,
        caption,
        hashtag_preset_id: input.hashtagPresetId,
        scheduled_at: input.scheduledAt,
        slot_start: planItem?.slot_start ?? input.scheduledAt,
        strategy_snapshot: toInputJson(strategySnapshot),
        status: requiresApproval ? "PENDING_APPROVAL" : "SCHEDULED",
        created_by: input.userId,
      },
    });

    if (input.planItemId) {
      await tx.postingPlanItem.update({
        where: { id: input.planItemId },
        data: {
          asset_id: input.assetId,
          status: "SCHEDULED",
          decided_at: new Date(),
          autopilot_metadata: toInputJson({
            decision: "scheduled",
            queue_id: created.id,
          }),
        },
      });
    }

    await tx.auditLog.create({
      data: {
        user_id: input.userId,
        action: "publishing.schedule",
        entity_type: "publishing_queue",
        entity_id: created.id,
        new_value: created,
      },
    });

    return created;
  });
}
