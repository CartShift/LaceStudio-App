import { ApiError } from "@/lib/http";
import { addZonedDays, getZonedWeekday, zonedDateTimeToUtc } from "@/lib/timezone";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import type { PostingPlanItem, PostingStrategy, StrategySlotTemplate } from "@/types/domain";

type LegacyTrack = {
  enabled: boolean;
  style_brief: string;
  prompt_bias?: string;
  target_ratio_percent: number;
  weekly_post_goal: number;
};

const DEFAULT_LEGACY_TRACKS = {
  reality_like_daily: {
    enabled: true,
    style_brief: "Natural day-in-the-life visuals with realistic settings.",
    prompt_bias: "candid framing, handheld realism, daylight",
    target_ratio_percent: 60,
    weekly_post_goal: 3,
  },
  fashion_editorial: {
    enabled: true,
    style_brief: "High-polish fashion shots with premium editorial styling.",
    prompt_bias: "studio precision, clean compositions, luxury tone",
    target_ratio_percent: 40,
    weekly_post_goal: 2,
  },
};

const ACTIVE_QUEUE_STATUSES = ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"] as const;

function toTrack(raw: unknown, fallback: LegacyTrack): LegacyTrack {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    enabled: typeof source.enabled === "boolean" ? source.enabled : fallback.enabled,
    style_brief: typeof source.style_brief === "string" && source.style_brief.trim() ? source.style_brief.trim() : fallback.style_brief,
    prompt_bias: typeof source.prompt_bias === "string" && source.prompt_bias.trim() ? source.prompt_bias.trim() : fallback.prompt_bias,
    target_ratio_percent:
      typeof source.target_ratio_percent === "number" && Number.isFinite(source.target_ratio_percent)
        ? Math.max(0, Math.min(100, Math.round(source.target_ratio_percent)))
        : fallback.target_ratio_percent,
    weekly_post_goal:
      typeof source.weekly_post_goal === "number" && Number.isFinite(source.weekly_post_goal)
        ? Math.max(0, Math.min(21, Math.round(source.weekly_post_goal)))
        : fallback.weekly_post_goal,
  };
}

function normalizeLegacyTracks(raw: unknown): {
  reality_like_daily: LegacyTrack;
  fashion_editorial: LegacyTrack;
  instagram_setup?: { handle?: string; connected_at?: string };
} {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const instagramSetup =
    source.instagram_setup && typeof source.instagram_setup === "object"
      ? (source.instagram_setup as Record<string, unknown>)
      : null;

  return {
    reality_like_daily: toTrack(source.reality_like_daily, DEFAULT_LEGACY_TRACKS.reality_like_daily),
    fashion_editorial: toTrack(source.fashion_editorial, DEFAULT_LEGACY_TRACKS.fashion_editorial),
    instagram_setup: instagramSetup
      ? {
          handle: typeof instagramSetup.handle === "string" ? instagramSetup.handle : undefined,
          connected_at: typeof instagramSetup.connected_at === "string" ? instagramSetup.connected_at : undefined,
        }
      : undefined,
  };
}

function distributedWeekdays(count: number): number[] {
  if (count <= 0) return [];

  const values = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    values.add(Math.floor((index * 7) / count) % 7);
  }

  return Array.from(values).sort((a, b) => a - b);
}

function inferDaypart(localTime: string): string {
  const hour = Number(localTime.split(":")[0] ?? 0);
  if (hour < 11) return "morning";
  if (hour < 16) return "midday";
  if (hour < 20) return "evening";
  return "night";
}

function buildTemplatesForTrack(input: {
  pillarKey: string;
  weeklyPostGoal: number;
  preferStories: boolean;
  priorityBase: number;
}): StrategySlotTemplate[] {
  const weekdays = distributedWeekdays(input.weeklyPostGoal);
  const feedTimes = input.pillarKey === "fashion_editorial" ? (["18:30", "20:00", "12:30"] as const) : (["11:30", "17:30", "19:30"] as const);
  const storyTimes = ["09:00", "14:30", "20:30"] as const;

  return weekdays.map((weekday, index) => {
    const useStory = input.preferStories && index % 3 === 1;
    const localTime = (useStory ? storyTimes[index % storyTimes.length] : feedTimes[index % feedTimes.length]) ?? (useStory ? "09:00" : "11:30");
    const postType = useStory ? "story" : "feed";

    return {
      pillar_key: input.pillarKey,
      label: `${input.pillarKey.replaceAll("_", " ")} ${index + 1}`,
      weekday,
      local_time: localTime,
      daypart: inferDaypart(localTime),
      post_type: postType as "feed" | "story" | "reel",
      variant_type: (useStory ? "story_9x16" : "feed_4x5") as "feed_1x1" | "feed_4x5" | "story_9x16" | "master",
      priority: input.priorityBase + index,
      active: true,
    };
  });
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

export function buildDefaultStrategyFromLegacy(input: {
  profileId: string;
  timezone: string;
  socialTracksProfile: unknown;
}): PostingStrategy {
  const legacy = normalizeLegacyTracks(input.socialTracksProfile);
  const activeTracks = [
    {
      key: "reality_like_daily",
      name: "Reality-like Daily",
      description: legacy.reality_like_daily.style_brief,
      target_share_percent: legacy.reality_like_daily.target_ratio_percent,
      active: legacy.reality_like_daily.enabled,
      priority: 0,
      supported_post_types: ["feed", "story"] as Array<"feed" | "story" | "reel">,
      weekly_post_goal: legacy.reality_like_daily.weekly_post_goal,
    },
    {
      key: "fashion_editorial",
      name: "Fashion Editorial",
      description: legacy.fashion_editorial.style_brief,
      target_share_percent: legacy.fashion_editorial.target_ratio_percent,
      active: legacy.fashion_editorial.enabled,
      priority: 1,
      supported_post_types: ["feed"] as Array<"feed" | "story" | "reel">,
      weekly_post_goal: legacy.fashion_editorial.weekly_post_goal,
    },
  ].filter((track) => track.active && track.weekly_post_goal > 0);

  const totalWeeklyTarget = activeTracks.reduce((sum, track) => sum + track.weekly_post_goal, 0);
  const pillars = activeTracks.map(({ weekly_post_goal: _weeklyPostGoal, ...pillar }) => pillar);
  const slotTemplates = [
    ...buildTemplatesForTrack({
      pillarKey: "reality_like_daily",
      weeklyPostGoal: legacy.reality_like_daily.enabled ? legacy.reality_like_daily.weekly_post_goal : 0,
      preferStories: true,
      priorityBase: 0,
    }),
    ...buildTemplatesForTrack({
      pillarKey: "fashion_editorial",
      weeklyPostGoal: legacy.fashion_editorial.enabled ? legacy.fashion_editorial.weekly_post_goal : 0,
      preferStories: false,
      priorityBase: 20,
    }),
  ] satisfies StrategySlotTemplate[];

  return {
    profile_id: input.profileId,
    timezone: input.timezone,
    weekly_post_target: Math.max(1, totalWeeklyTarget),
    cooldown_hours: 18,
    min_ready_assets: Math.max(2, Math.ceil(totalWeeklyTarget / 2)),
    auto_queue_enabled: false,
    notes: "Autogenerated from the legacy social strategy fields. Update pillars and slots to refine cadence.",
    pillars,
    slot_templates: slotTemplates,
  };
}

function serializeStrategy(strategy: {
  id: string;
  profile_id: string;
  timezone: string;
  weekly_post_target: number;
  cooldown_hours: number;
  min_ready_assets: number;
  auto_queue_enabled: boolean;
  notes: string | null;
  pillars: Array<{
    id: string;
    key: string;
    name: string;
    description: string | null;
    target_share_percent: number;
    active: boolean;
    priority: number;
    supported_post_types: Array<"feed" | "story" | "reel">;
  }>;
  slot_templates: Array<{
    id: string;
    pillar?: { key: string } | null;
    label: string;
    weekday: number;
    local_time: string;
    daypart: string;
    post_type: "feed" | "story" | "reel";
    variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "master";
    priority: number;
    active: boolean;
  }>;
}): PostingStrategy {
  return {
    id: strategy.id,
    profile_id: strategy.profile_id,
    timezone: strategy.timezone,
    weekly_post_target: strategy.weekly_post_target,
    cooldown_hours: strategy.cooldown_hours,
    min_ready_assets: strategy.min_ready_assets,
    auto_queue_enabled: strategy.auto_queue_enabled,
    notes: strategy.notes,
    pillars: strategy.pillars
      .slice()
      .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
      .map((pillar) => ({
        id: pillar.id,
        key: pillar.key,
        name: pillar.name,
        description: pillar.description,
        target_share_percent: pillar.target_share_percent,
        active: pillar.active,
        priority: pillar.priority,
        supported_post_types: pillar.supported_post_types,
      })),
    slot_templates: strategy.slot_templates
      .slice()
      .sort((left, right) => left.weekday - right.weekday || left.local_time.localeCompare(right.local_time))
      .map((slot) => ({
        id: slot.id,
        pillar_key: slot.pillar?.key ?? null,
        label: slot.label,
        weekday: slot.weekday,
        local_time: slot.local_time,
        daypart: slot.daypart,
        post_type: slot.post_type,
        variant_type: slot.variant_type,
        priority: slot.priority,
        active: slot.active,
      })),
  };
}

export async function ensurePostingStrategyForProfile(profileId: string): Promise<PostingStrategy> {
  const existing = await prisma.postingStrategy.findUnique({
    where: { profile_id: profileId },
    include: {
      pillars: true,
      slot_templates: {
        include: {
          pillar: {
            select: { key: true },
          },
        },
      },
    },
  });

  if (existing) {
    return serializeStrategy(existing);
  }

  const profile = await prisma.instagramProfile.findUnique({
    where: { id: profileId },
    include: {
      model: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  const draft = buildDefaultStrategyFromLegacy({
    profileId,
    timezone: profile.timezone,
    socialTracksProfile: profile.model.social_tracks_profile,
  });

  return savePostingStrategy(profileId, profile.created_by, draft);
}

export async function getPostingStrategyForProfile(profileId: string): Promise<PostingStrategy> {
  return ensurePostingStrategyForProfile(profileId);
}

export async function savePostingStrategy(profileId: string, userId: string, input: PostingStrategy): Promise<PostingStrategy> {
  const strategy = await prisma.$transaction(async (tx) => {
    const saved = await tx.postingStrategy.upsert({
      where: { profile_id: profileId },
      update: {
        timezone: input.timezone,
        weekly_post_target: input.weekly_post_target,
        cooldown_hours: input.cooldown_hours,
        min_ready_assets: input.min_ready_assets,
        auto_queue_enabled: input.auto_queue_enabled,
        notes: input.notes?.trim() || null,
      },
      create: {
        profile_id: profileId,
        timezone: input.timezone,
        weekly_post_target: input.weekly_post_target,
        cooldown_hours: input.cooldown_hours,
        min_ready_assets: input.min_ready_assets,
        auto_queue_enabled: input.auto_queue_enabled,
        notes: input.notes?.trim() || null,
        created_by: userId,
      },
    });

    await tx.strategySlotTemplate.deleteMany({
      where: { strategy_id: saved.id },
    });
    await tx.strategyPillar.deleteMany({
      where: { strategy_id: saved.id },
    });

    await tx.strategyPillar.createMany({
      data: input.pillars.map((pillar) => ({
        strategy_id: saved.id,
        key: pillar.key,
        name: pillar.name,
        description: pillar.description?.trim() || null,
        target_share_percent: pillar.target_share_percent,
        active: pillar.active,
        priority: pillar.priority,
        supported_post_types: pillar.supported_post_types,
      })),
    });

    const storedPillars = await tx.strategyPillar.findMany({
      where: { strategy_id: saved.id },
    });
    const pillarIdByKey = new Map(storedPillars.map((pillar) => [pillar.key, pillar.id]));

    await tx.strategySlotTemplate.createMany({
      data: input.slot_templates.map((slot) => ({
        strategy_id: saved.id,
        pillar_id: slot.pillar_key ? pillarIdByKey.get(slot.pillar_key) ?? null : null,
        label: slot.label,
        weekday: slot.weekday,
        local_time: slot.local_time,
        daypart: slot.daypart,
        post_type: slot.post_type,
        variant_type: slot.variant_type,
        priority: slot.priority,
        active: slot.active,
      })),
    });

    return tx.postingStrategy.findUniqueOrThrow({
      where: { id: saved.id },
      include: {
        pillars: true,
        slot_templates: {
          include: {
            pillar: {
              select: { key: true },
            },
          },
        },
      },
    });
  });

  return serializeStrategy(strategy);
}

function serializePlanItem(item: {
  id: string;
  profile_id: string;
  strategy_id: string | null;
  pillar_id: string | null;
  pillar_key: string | null;
  asset_id: string | null;
  status: "RECOMMENDED" | "SCHEDULED" | "SKIPPED" | "PUBLISHED" | "CANCELLED";
  slot_start: Date;
  slot_end: Date | null;
  post_type: "feed" | "story" | "reel";
  variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "master";
  rationale: string | null;
  confidence: unknown;
  caption_suggestion: string | null;
  decided_at: Date | null;
  asset?: {
    id: string;
    sequence_number: number;
    campaign?: { id: string; name: string } | null;
  } | null;
}): PostingPlanItem {
  return {
    id: item.id,
    profile_id: item.profile_id,
    strategy_id: item.strategy_id,
    pillar_id: item.pillar_id,
    pillar_key: item.pillar_key,
    asset_id: item.asset_id,
    status: item.status,
    slot_start: item.slot_start.toISOString(),
    slot_end: item.slot_end?.toISOString() ?? null,
    post_type: item.post_type,
    variant_type: item.variant_type,
    rationale: item.rationale,
    confidence: toNumber(item.confidence),
    caption_suggestion: item.caption_suggestion,
    decided_at: item.decided_at?.toISOString() ?? null,
    asset: item.asset
      ? {
          id: item.asset.id,
          sequence_number: item.asset.sequence_number,
          campaign: item.asset.campaign ?? null,
        }
      : null,
  };
}

function pickPillarForSlot(input: {
  slotPillarKey: string | null | undefined;
  pillars: PostingStrategy["pillars"];
  usageByPillar: Map<string, number>;
}): PostingStrategy["pillars"][number] | null {
  if (input.slotPillarKey) {
    return input.pillars.find((pillar) => pillar.key === input.slotPillarKey) ?? null;
  }

  const active = input.pillars.filter((pillar) => pillar.active);
  if (active.length === 0) return null;

  return active
    .slice()
    .sort((left, right) => {
      const leftActual = input.usageByPillar.get(left.key) ?? 0;
      const rightActual = input.usageByPillar.get(right.key) ?? 0;
      const leftGap = left.target_share_percent - leftActual;
      const rightGap = right.target_share_percent - rightActual;
      return rightGap - leftGap || left.priority - right.priority;
    })[0]!;
}

function computeUpcomingSlots(strategy: PostingStrategy, now: Date, horizonDays: number) {
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const slots: Array<(PostingStrategy["slot_templates"][number] & { slot_start: Date })> = [];
  const timeZone = strategy.timezone;

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const localDate = addZonedDays(now, timeZone, offset);
    const weekday = getZonedWeekday(
      zonedDateTimeToUtc({
        timeZone,
        year: localDate.year,
        month: localDate.month,
        day: localDate.day,
        hour: 12,
        minute: 0,
      }),
      timeZone,
    );

    for (const slot of strategy.slot_templates) {
      if (!slot.active || slot.weekday !== weekday) continue;
      const [hourRaw, minuteRaw] = slot.local_time.split(":");
      const slotStart = zonedDateTimeToUtc({
        timeZone,
        year: localDate.year,
        month: localDate.month,
        day: localDate.day,
        hour: Number(hourRaw),
        minute: Number(minuteRaw),
      });

      if (slotStart <= now || slotStart > horizonEnd) continue;
      slots.push({
        ...slot,
        slot_start: slotStart,
      });
    }
  }

  return slots.sort((left, right) => left.slot_start.getTime() - right.slot_start.getTime() || left.priority - right.priority);
}

export async function generatePostingPlanForProfile(input: {
  profileId: string;
  horizonDays?: number;
  now?: Date;
  limit?: number;
}): Promise<PostingPlanItem[]> {
  const now = input.now ?? new Date();
  const horizonDays = Math.max(7, Math.min(14, input.horizonDays ?? 10));
  const strategy = await ensurePostingStrategyForProfile(input.profileId);
  const profile = await prisma.instagramProfile.findUnique({
    where: { id: input.profileId },
    include: {
      model: true,
    },
  });

  if (!profile) {
    throw new ApiError(404, "NOT_FOUND", "Instagram profile not found.");
  }

  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const recentWindowStart = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

  const [existingPlanItems, upcomingQueue, recentQueue, approvedAssets] = await Promise.all([
    prisma.postingPlanItem.findMany({
      where: {
        profile_id: input.profileId,
        slot_start: {
          gte: now,
          lte: horizonEnd,
        },
      },
      include: {
        asset: {
          include: {
            campaign: {
              select: { id: true, name: true },
            },
          },
        },
      },
      orderBy: { slot_start: "asc" },
    }),
    prisma.publishingQueue.findMany({
      where: {
        profile_id: input.profileId,
        scheduled_at: {
          gte: now,
          lte: horizonEnd,
        },
        status: {
          in: [...ACTIVE_QUEUE_STATUSES],
        },
      },
    }),
    prisma.publishingQueue.findMany({
      where: {
        profile_id: input.profileId,
        OR: [
          {
            published_at: {
              gte: recentWindowStart,
            },
          },
          {
            scheduled_at: {
              gte: recentWindowStart,
            },
          },
        ],
      },
      select: {
        pillar_key: true,
      },
    }),
    prisma.asset.findMany({
      where: {
        status: "APPROVED",
        campaign: {
          model_id: profile.model_id,
        },
        publishing_queue: {
          none: {
            status: {
              in: [...ACTIVE_QUEUE_STATUSES],
            },
          },
        },
      },
      include: {
        campaign: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: [{ reviewed_at: "desc" }, { created_at: "desc" }],
      take: 50,
    }),
  ]);

  const existingByKey = new Map(existingPlanItems.map((item) => [`${item.slot_start.toISOString()}|${item.post_type}`, item]));
  const queueKeys = new Set(upcomingQueue.map((item) => `${(item.slot_start ?? item.scheduled_at).toISOString()}|${item.post_type}`));
  const usageByPillar = new Map<string, number>();

  for (const row of recentQueue) {
    if (!row.pillar_key) continue;
    usageByPillar.set(row.pillar_key, (usageByPillar.get(row.pillar_key) ?? 0) + 1);
  }

  const activeAssetIds = new Set<string>([
    ...existingPlanItems.map((item) => item.asset_id).filter((value): value is string => Boolean(value)),
    ...upcomingQueue.map((item) => item.asset_id),
  ]);

  const upcomingSlots = computeUpcomingSlots(strategy, now, horizonDays);

  for (const slot of upcomingSlots) {
    const slotKey = `${slot.slot_start.toISOString()}|${slot.post_type}`;
    const existingQueueItem = queueKeys.has(slotKey);
    const existingPlan = existingByKey.get(slotKey);

    if (existingQueueItem) {
      continue;
    }

    if (existingPlan && existingPlan.status !== "RECOMMENDED") {
      continue;
    }

    const pillar = pickPillarForSlot({
      slotPillarKey: slot.pillar_key,
      pillars: strategy.pillars,
      usageByPillar,
    });
    const asset = approvedAssets.find((candidate) => !activeAssetIds.has(candidate.id)) ?? null;

    if (asset) {
      activeAssetIds.add(asset.id);
    }

    const readyAssetScore = approvedAssets.length >= strategy.min_ready_assets ? 0.18 : 0.04;
    const assetAssignmentScore = asset ? 0.18 : 0.04;
    const gapScore = pillar ? Math.max(0.12, pillar.target_share_percent / 100) : 0.1;
    const confidence = Math.min(0.96, Number((0.44 + readyAssetScore + assetAssignmentScore + gapScore).toFixed(4)));
    const strategySnapshot = {
      strategy_id: strategy.id ?? null,
      profile_id: input.profileId,
      timezone: strategy.timezone,
      weekly_post_target: strategy.weekly_post_target,
      pillar_key: pillar?.key ?? slot.pillar_key ?? null,
      generated_at: now.toISOString(),
    };

    const payload = {
      profile_id: input.profileId,
      strategy_id: strategy.id ?? null,
      pillar_id: pillar?.id ?? null,
      asset_id: asset?.id ?? null,
      status: "RECOMMENDED" as const,
      slot_start: slot.slot_start,
      slot_end: new Date(slot.slot_start.getTime() + 60 * 60 * 1000),
      pillar_key: pillar?.key ?? slot.pillar_key ?? null,
      post_type: slot.post_type,
      variant_type: slot.variant_type,
      rationale: pillar
        ? `${pillar.name} is below its target share and this ${slot.daypart} slot matches the current cadence.`
        : `Recommended from the active slot template for ${slot.daypart}.`,
      confidence,
      caption_suggestion: asset
        ? `${profile.display_name ?? profile.model.name}: ${pillar?.name ?? "Next post"} with a ${slot.daypart} publishing window.`
        : `${pillar?.name ?? "Next post"} slot reserved while waiting for the next approved asset.`,
      strategy_snapshot: toInputJson(strategySnapshot),
      autopilot_metadata: toInputJson({
        mode: "operator_confirmed",
        source: "strategy_engine_v1",
      }),
    };

    if (existingPlan) {
      await prisma.postingPlanItem.update({
        where: { id: existingPlan.id },
        data: payload,
      });
      continue;
    }

    await prisma.postingPlanItem.create({
      data: payload,
    });
  }

  const items = await prisma.postingPlanItem.findMany({
    where: {
      profile_id: input.profileId,
      slot_start: {
        gte: now,
        lte: horizonEnd,
      },
      status: {
        in: ["RECOMMENDED", "SCHEDULED"],
      },
    },
    include: {
      asset: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: { slot_start: "asc" },
    take: Math.max(3, Math.min(20, input.limit ?? 10)),
  });

  return items.map(serializePlanItem);
}

export async function listPostingPlanItems(input: {
  profileId?: string;
  status?: "RECOMMENDED" | "SCHEDULED" | "SKIPPED" | "PUBLISHED" | "CANCELLED";
  horizonDays?: number;
}): Promise<PostingPlanItem[]> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + Math.max(7, Math.min(21, input.horizonDays ?? 14)) * 24 * 60 * 60 * 1000);

  const items = await prisma.postingPlanItem.findMany({
    where: {
      ...(input.profileId ? { profile_id: input.profileId } : {}),
      ...(input.status ? { status: input.status } : {}),
      slot_start: {
        gte: now,
        lte: horizonEnd,
      },
    },
    include: {
      asset: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
    orderBy: [{ slot_start: "asc" }, { created_at: "desc" }],
  });

  return items.map(serializePlanItem);
}

export async function markPostingPlanItemSkipped(planItemId: string, reason?: string): Promise<PostingPlanItem> {
  const updated = await prisma.postingPlanItem.update({
    where: { id: planItemId },
    data: {
      status: "SKIPPED",
      decided_at: new Date(),
      autopilot_metadata: toInputJson({
        decision: "skipped",
        reason: reason?.trim() || null,
      }),
    },
    include: {
      asset: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      },
    },
  });

  return serializePlanItem(updated);
}
