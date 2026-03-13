import { ApiError } from "@/lib/http";
import { addZonedDays, getZonedWeekday, zonedDateTimeToUtc } from "@/lib/timezone";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { buildPublishingCopyFromContext, formatCaptionFromPackage } from "@/server/services/publishing-copy.service";
import type {
  CaptionSeoPackage,
  PostingPlanItem,
  PostingStrategy,
  StrategyBestTimeWindow,
  StrategySlotTemplate,
} from "@/types/domain";

type LegacyTrack = {
  enabled: boolean;
  style_brief: string;
  prompt_bias?: string;
  target_ratio_percent: number;
  weekly_post_goal: number;
};

type PerformanceSample = {
  postType: "feed" | "story" | "reel";
  pillarKey: string | null;
  daypart: string;
  fetchedAt: Date;
  views: number;
  reach: number;
  shares: number;
  saves: number;
  comments: number;
  replies: number;
  avgWatchTimeMs: number;
};

type PerformanceBucket = {
  posts: number;
  weightedPosts: number;
  weightedViews: number;
  weightedReach: number;
  weightedShares: number;
  weightedSaves: number;
  weightedComments: number;
  weightedReplies: number;
  weightedWatchMs: number;
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
} satisfies Record<string, LegacyTrack>;

const ACTIVE_QUEUE_STATUSES = ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"] as const;
const DEFAULT_BEST_TIME_WINDOWS: StrategyBestTimeWindow[] = [
  { weekday: 2, local_time: "11:30", daypart: "midday", score: 0.92, source: "default" },
  { weekday: 3, local_time: "13:00", daypart: "midday", score: 0.9, source: "default" },
  { weekday: 4, local_time: "15:00", daypart: "afternoon", score: 0.88, source: "default" },
  { weekday: 5, local_time: "12:00", daypart: "midday", score: 0.82, source: "default" },
];
const DEFAULT_SLOT_BLUEPRINTS = [
  { pillar_key: "discoverability_reels", label: "Discovery Reel", weekday: 2, local_time: "11:30", post_type: "reel", variant_type: "reel_9x16", priority: 0 },
  { pillar_key: "relationship_stories", label: "Community Story", weekday: 2, local_time: "18:00", post_type: "story", variant_type: "story_9x16", priority: 1 },
  { pillar_key: "saveable_feed", label: "Saveable Feed", weekday: 3, local_time: "13:00", post_type: "feed", variant_type: "feed_4x5", priority: 2 },
  { pillar_key: "relationship_stories", label: "Midweek Story", weekday: 3, local_time: "19:00", post_type: "story", variant_type: "story_9x16", priority: 3 },
  { pillar_key: "discoverability_reels", label: "Trend Reel", weekday: 4, local_time: "15:00", post_type: "reel", variant_type: "reel_9x16", priority: 4 },
  { pillar_key: "editorial_identity", label: "Editorial Feed", weekday: 5, local_time: "12:30", post_type: "feed", variant_type: "feed_4x5", priority: 5 },
  { pillar_key: "relationship_stories", label: "Weekend Story", weekday: 6, local_time: "10:30", post_type: "story", variant_type: "story_9x16", priority: 6 },
] as const;

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
} {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  return {
    reality_like_daily: toTrack(source.reality_like_daily, DEFAULT_LEGACY_TRACKS.reality_like_daily),
    fashion_editorial: toTrack(source.fashion_editorial, DEFAULT_LEGACY_TRACKS.fashion_editorial),
  };
}

function inferDaypart(localTime: string): string {
  const hour = Number(localTime.split(":")[0] ?? 0);
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function toNumber(value: unknown, fallback = 0): number {
  const normalized = Number(value ?? fallback);
  return Number.isFinite(normalized) ? normalized : fallback;
}

function normalizeBestTimeWindows(raw: unknown): StrategyBestTimeWindow[] {
  if (!Array.isArray(raw)) {
    return DEFAULT_BEST_TIME_WINDOWS.map((window) => ({ ...window }));
  }

  const windows = raw
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const weekday = toNumber(row.weekday, -1);
      const localTime = typeof row.local_time === "string" ? row.local_time : "";
      const daypart = typeof row.daypart === "string" ? row.daypart : inferDaypart(localTime || "12:00");
      const score = Math.max(0, Math.min(1, toNumber(row.score, 0.75)));
      const source = row.source === "learned" ? "learned" : "default";

      if (weekday < 0 || weekday > 6 || !/^\d{2}:\d{2}$/.test(localTime)) return null;
      return {
        weekday,
        local_time: localTime,
        daypart,
        score,
        source,
      } satisfies StrategyBestTimeWindow;
    })
    .filter((value): value is StrategyBestTimeWindow => Boolean(value));

  return windows.length > 0 ? windows : DEFAULT_BEST_TIME_WINDOWS.map((window) => ({ ...window }));
}

function buildDefaultSlotTemplates(bestTimeWindows: StrategyBestTimeWindow[]): StrategySlotTemplate[] {
  const bestByKey = new Map(bestTimeWindows.map((window) => [`${window.weekday}-${window.local_time}`, window]));

  return DEFAULT_SLOT_BLUEPRINTS.map((slot) => {
    const matchedWindow = bestByKey.get(`${slot.weekday}-${slot.local_time}`);
    return {
      pillar_key: slot.pillar_key,
      label: slot.label,
      weekday: slot.weekday,
      local_time: slot.local_time,
      daypart: matchedWindow?.daypart ?? inferDaypart(slot.local_time),
      post_type: slot.post_type,
      variant_type: slot.variant_type,
      priority: slot.priority,
      active: true,
    };
  });
}

export function buildDefaultStrategyFromLegacy(input: {
  profileId: string;
  timezone: string;
  socialTracksProfile: unknown;
}): PostingStrategy {
  const legacy = normalizeLegacyTracks(input.socialTracksProfile);
  const bestTimeWindows = DEFAULT_BEST_TIME_WINDOWS.map((window) => ({ ...window }));

  return {
    profile_id: input.profileId,
    primary_goal: "balanced_growth",
    timezone: input.timezone,
    weekly_post_target: 7,
    weekly_feed_target: 2,
    weekly_reel_target: 2,
    weekly_story_target: 3,
    cooldown_hours: 16,
    min_ready_assets: 4,
    auto_queue_enabled: true,
    experimentation_rate_percent: 20,
    auto_queue_min_confidence: 0.72,
    best_time_windows: bestTimeWindows,
    notes:
      `Balanced-growth optimization seeded from the legacy social strategy. Relationship stories inherit "${legacy.reality_like_daily.style_brief}" and editorial identity inherits "${legacy.fashion_editorial.style_brief}".`,
    pillars: [
      {
        key: "discoverability_reels",
        name: "Discoverability Reels",
        description: "Original short-form video built for views, sends, and non-follower reach.",
        target_share_percent: 35,
        active: true,
        priority: 0,
        supported_post_types: ["reel"],
      },
      {
        key: "saveable_feed",
        name: "Saveable Feed",
        description: "Feed posts engineered for saves, shares, and repeat visits.",
        target_share_percent: 25,
        active: true,
        priority: 1,
        supported_post_types: ["feed"],
      },
      {
        key: "editorial_identity",
        name: "Editorial Identity",
        description: legacy.fashion_editorial.style_brief,
        target_share_percent: 20,
        active: true,
        priority: 2,
        supported_post_types: ["feed", "reel"],
      },
      {
        key: "relationship_stories",
        name: "Relationship Stories",
        description: legacy.reality_like_daily.style_brief,
        target_share_percent: 20,
        active: true,
        priority: 3,
        supported_post_types: ["story"],
      },
    ],
    slot_templates: buildDefaultSlotTemplates(bestTimeWindows),
  };
}

function serializeStrategy(strategy: {
  id: string;
  profile_id: string;
  primary_goal: "balanced_growth" | "top_of_funnel" | "business_conversion";
  timezone: string;
  weekly_post_target: number;
  weekly_feed_target: number;
  weekly_reel_target: number;
  weekly_story_target: number;
  cooldown_hours: number;
  min_ready_assets: number;
  auto_queue_enabled: boolean;
  experimentation_rate_percent: number;
  auto_queue_min_confidence: unknown;
  best_time_windows: unknown;
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
    variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
    priority: number;
    active: boolean;
  }>;
}): PostingStrategy {
  return {
    id: strategy.id,
    profile_id: strategy.profile_id,
    primary_goal: strategy.primary_goal,
    timezone: strategy.timezone,
    weekly_post_target: strategy.weekly_post_target,
    weekly_feed_target: strategy.weekly_feed_target,
    weekly_reel_target: strategy.weekly_reel_target,
    weekly_story_target: strategy.weekly_story_target,
    cooldown_hours: strategy.cooldown_hours,
    min_ready_assets: strategy.min_ready_assets,
    auto_queue_enabled: strategy.auto_queue_enabled,
    experimentation_rate_percent: strategy.experimentation_rate_percent,
    auto_queue_min_confidence: toNumber(strategy.auto_queue_min_confidence, 0.72),
    best_time_windows: normalizeBestTimeWindows(strategy.best_time_windows),
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
        primary_goal: input.primary_goal,
        timezone: input.timezone,
        weekly_post_target: input.weekly_post_target,
        weekly_feed_target: input.weekly_feed_target,
        weekly_reel_target: input.weekly_reel_target,
        weekly_story_target: input.weekly_story_target,
        cooldown_hours: input.cooldown_hours,
        min_ready_assets: input.min_ready_assets,
        auto_queue_enabled: input.auto_queue_enabled,
        experimentation_rate_percent: input.experimentation_rate_percent,
        auto_queue_min_confidence: input.auto_queue_min_confidence,
        best_time_windows: toInputJson(input.best_time_windows),
        notes: input.notes?.trim() || null,
      },
      create: {
        profile_id: profileId,
        primary_goal: input.primary_goal,
        timezone: input.timezone,
        weekly_post_target: input.weekly_post_target,
        weekly_feed_target: input.weekly_feed_target,
        weekly_reel_target: input.weekly_reel_target,
        weekly_story_target: input.weekly_story_target,
        cooldown_hours: input.cooldown_hours,
        min_ready_assets: input.min_ready_assets,
        auto_queue_enabled: input.auto_queue_enabled,
        experimentation_rate_percent: input.experimentation_rate_percent,
        auto_queue_min_confidence: input.auto_queue_min_confidence,
        best_time_windows: toInputJson(input.best_time_windows),
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
  variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
  rationale: string | null;
  confidence: unknown;
  caption_suggestion: string | null;
  autopilot_metadata: unknown;
  decided_at: Date | null;
  asset?: {
    id: string;
    sequence_number: number;
    campaign?: { id: string; name: string } | null;
  } | null;
}): PostingPlanItem {
  const autopilotMetadata = item.autopilot_metadata && typeof item.autopilot_metadata === "object" && !Array.isArray(item.autopilot_metadata)
    ? (item.autopilot_metadata as Record<string, unknown>)
    : null;
  const rawCaptionPackage =
    autopilotMetadata?.caption_package && typeof autopilotMetadata.caption_package === "object" && !Array.isArray(autopilotMetadata.caption_package)
      ? (autopilotMetadata.caption_package as Record<string, unknown>)
      : null;
  const captionPackage = rawCaptionPackage
    ? ({
        caption:
          typeof rawCaptionPackage.caption === "string" && rawCaptionPackage.caption.trim()
            ? rawCaptionPackage.caption
            : formatCaptionFromPackage({
                caption: "",
                hook:
                  typeof rawCaptionPackage.hook === "string"
                    ? rawCaptionPackage.hook
                    : typeof rawCaptionPackage.opening_hook === "string"
                      ? rawCaptionPackage.opening_hook
                      : "",
                body: typeof rawCaptionPackage.body === "string" ? rawCaptionPackage.body : "",
                call_to_action: typeof rawCaptionPackage.call_to_action === "string" ? rawCaptionPackage.call_to_action : "",
                hashtags: Array.isArray(rawCaptionPackage.hashtags)
                  ? rawCaptionPackage.hashtags.filter((entry): entry is string => typeof entry === "string")
                  : [],
              }),
        primary_keyword: typeof rawCaptionPackage.primary_keyword === "string" ? rawCaptionPackage.primary_keyword : "instagram strategy",
        hook:
          typeof rawCaptionPackage.hook === "string"
            ? rawCaptionPackage.hook
            : typeof rawCaptionPackage.opening_hook === "string"
              ? rawCaptionPackage.opening_hook
              : "",
        opening_hook:
          typeof rawCaptionPackage.opening_hook === "string"
            ? rawCaptionPackage.opening_hook
            : typeof rawCaptionPackage.hook === "string"
              ? rawCaptionPackage.hook
              : "",
        body: typeof rawCaptionPackage.body === "string" ? rawCaptionPackage.body : "",
        call_to_action: typeof rawCaptionPackage.call_to_action === "string" ? rawCaptionPackage.call_to_action : "",
        hashtags: Array.isArray(rawCaptionPackage.hashtags)
          ? rawCaptionPackage.hashtags.filter((entry): entry is string => typeof entry === "string")
          : [],
        rationale: typeof rawCaptionPackage.rationale === "string" ? rawCaptionPackage.rationale : "Strategy-aligned caption guidance.",
        strategy_alignment:
          typeof rawCaptionPackage.strategy_alignment === "string"
            ? rawCaptionPackage.strategy_alignment
            : "Aligned to the active strategy slot.",
        compliance_summary:
          typeof rawCaptionPackage.compliance_summary === "string"
            ? rawCaptionPackage.compliance_summary
            : "Keep claims grounded to the approved asset and respect profile boundaries.",
        source:
          rawCaptionPackage.source === "vision_refined" || rawCaptionPackage.source === "metadata_fallback"
            ? rawCaptionPackage.source
            : "metadata_draft",
      } satisfies CaptionSeoPackage)
    : null;

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
    confidence: toNumber(item.confidence, 0),
    caption_suggestion: item.caption_suggestion,
    caption_package: captionPackage,
    autopilot_metadata: autopilotMetadata,
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
  slotPostType: "feed" | "story" | "reel";
  pillars: PostingStrategy["pillars"];
  usageByPillar: Map<string, number>;
}): PostingStrategy["pillars"][number] | null {
  const activePillars = input.pillars.filter((pillar) => pillar.active && pillar.supported_post_types.includes(input.slotPostType));

  if (input.slotPillarKey) {
    return activePillars.find((pillar) => pillar.key === input.slotPillarKey) ?? null;
  }

  if (activePillars.length === 0) return null;

  return activePillars
    .slice()
    .sort((left, right) => {
      const leftUsage = input.usageByPillar.get(left.key) ?? 0;
      const rightUsage = input.usageByPillar.get(right.key) ?? 0;
      const leftGap = left.target_share_percent - leftUsage;
      const rightGap = right.target_share_percent - rightUsage;
      return rightGap - leftGap || left.priority - right.priority;
    })[0]!;
}

function computeUpcomingSlots(strategy: PostingStrategy, now: Date, horizonDays: number) {
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const slots: Array<(PostingStrategy["slot_templates"][number] & { slot_start: Date; window_score: number })> = [];
  const timeZone = strategy.timezone;
  const windowScores = new Map(strategy.best_time_windows.map((window) => [`${window.weekday}-${window.local_time}`, window.score]));

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
        window_score: windowScores.get(`${slot.weekday}-${slot.local_time}`) ?? 0.7,
      });
    }
  }

  return slots.sort((left, right) => left.slot_start.getTime() - right.slot_start.getTime() || right.window_score - left.window_score || left.priority - right.priority);
}

function emptyBucket(): PerformanceBucket {
  return {
    posts: 0,
    weightedPosts: 0,
    weightedViews: 0,
    weightedReach: 0,
    weightedShares: 0,
    weightedSaves: 0,
    weightedComments: 0,
    weightedReplies: 0,
    weightedWatchMs: 0,
  };
}

function addSampleToBucket(bucket: PerformanceBucket, sample: PerformanceSample, now: Date) {
  const daysOld = Math.max(0, (now.getTime() - sample.fetchedAt.getTime()) / (24 * 60 * 60 * 1000));
  const weight = 1 / (1 + daysOld / 7);

  bucket.posts += 1;
  bucket.weightedPosts += weight;
  bucket.weightedViews += sample.views * weight;
  bucket.weightedReach += sample.reach * weight;
  bucket.weightedShares += sample.shares * weight;
  bucket.weightedSaves += sample.saves * weight;
  bucket.weightedComments += sample.comments * weight;
  bucket.weightedReplies += sample.replies * weight;
  bucket.weightedWatchMs += sample.avgWatchTimeMs * weight;
}

function buildPerformanceBuckets(samples: PerformanceSample[], now: Date) {
  const overall = emptyBucket();
  const byPostType = new Map<string, PerformanceBucket>();
  const byPillar = new Map<string, PerformanceBucket>();
  const byDaypart = new Map<string, PerformanceBucket>();

  for (const sample of samples) {
    addSampleToBucket(overall, sample, now);

    const typeBucket = byPostType.get(sample.postType) ?? emptyBucket();
    addSampleToBucket(typeBucket, sample, now);
    byPostType.set(sample.postType, typeBucket);

    if (sample.pillarKey) {
      const pillarBucket = byPillar.get(sample.pillarKey) ?? emptyBucket();
      addSampleToBucket(pillarBucket, sample, now);
      byPillar.set(sample.pillarKey, pillarBucket);
    }

    const daypartBucket = byDaypart.get(sample.daypart) ?? emptyBucket();
    addSampleToBucket(daypartBucket, sample, now);
    byDaypart.set(sample.daypart, daypartBucket);
  }

  return {
    overall,
    byPostType,
    byPillar,
    byDaypart,
  };
}

function metricPerPost(bucket: PerformanceBucket, metric: keyof PerformanceBucket): number {
  return bucket.weightedPosts > 0 ? toNumber(bucket[metric], 0) / bucket.weightedPosts : 0;
}

function rate(bucket: PerformanceBucket, numerator: keyof PerformanceBucket): number {
  return bucket.weightedViews > 0 ? toNumber(bucket[numerator], 0) / bucket.weightedViews : 0;
}

function relativeMetric(value: number, baseline: number): number {
  if (baseline <= 0 && value <= 0) return 1;
  if (baseline <= 0) return 1.15;
  return Math.max(0.7, Math.min(1.3, value / baseline));
}

function computePerformanceIndex(input: {
  postType: "feed" | "story" | "reel";
  pillarKey: string | null;
  daypart: string;
  buckets: ReturnType<typeof buildPerformanceBuckets>;
}): number {
  const typeBucket = input.buckets.byPostType.get(input.postType) ?? emptyBucket();
  const pillarBucket = input.pillarKey ? input.buckets.byPillar.get(input.pillarKey) ?? emptyBucket() : emptyBucket();
  const daypartBucket = input.buckets.byDaypart.get(input.daypart) ?? emptyBucket();
  const overall = input.buckets.overall.weightedPosts > 0 ? input.buckets.overall : typeBucket;

  const baselineViews = metricPerPost(overall, "weightedViews");
  const baselineShareRate = rate(overall, "weightedShares");
  const baselineSaveRate = rate(overall, "weightedSaves");
  const baselineCommentRate = rate(overall, "weightedComments");
  const baselineReplyRate = rate(overall, "weightedReplies");
  const baselineWatchMs = metricPerPost(overall, "weightedWatchMs");

  const pool = [typeBucket, pillarBucket, daypartBucket].filter((bucket) => bucket.weightedPosts > 0);
  if (pool.length === 0) return 1;

  const averaged = pool.reduce(
    (result, bucket) => ({
      views: result.views + metricPerPost(bucket, "weightedViews"),
      shareRate: result.shareRate + rate(bucket, "weightedShares"),
      saveRate: result.saveRate + rate(bucket, "weightedSaves"),
      commentRate: result.commentRate + rate(bucket, "weightedComments"),
      replyRate: result.replyRate + rate(bucket, "weightedReplies"),
      watchMs: result.watchMs + metricPerPost(bucket, "weightedWatchMs"),
    }),
    { views: 0, shareRate: 0, saveRate: 0, commentRate: 0, replyRate: 0, watchMs: 0 },
  );

  const viewMetric = relativeMetric(averaged.views / pool.length, baselineViews);
  const shareMetric = relativeMetric(averaged.shareRate / pool.length, baselineShareRate);
  const saveMetric = relativeMetric(averaged.saveRate / pool.length, baselineSaveRate);
  const commentMetric = relativeMetric(averaged.commentRate / pool.length, baselineCommentRate);
  const replyMetric = relativeMetric(averaged.replyRate / pool.length, baselineReplyRate);
  const watchMetric = relativeMetric(averaged.watchMs / pool.length, baselineWatchMs);

  if (input.postType === "reel") {
    return viewMetric * 0.4 + shareMetric * 0.25 + saveMetric * 0.2 + watchMetric * 0.15;
  }

  if (input.postType === "story") {
    return replyMetric * 0.45 + viewMetric * 0.35 + shareMetric * 0.2;
  }

  return shareMetric * 0.4 + saveMetric * 0.3 + commentMetric * 0.2 + viewMetric * 0.1;
}

function formatCaptionSuggestion(captionPackage: CaptionSeoPackage): string {
  return formatCaptionFromPackage(captionPackage);
}

function assetHasVariant(
  asset: {
    variants: Array<{
      format_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
      media_kind: "image" | "video";
    }>;
  } | null,
  variantType: "story_9x16" | "reel_9x16",
): boolean {
  return Boolean(asset?.variants.some((variant) => variant.format_type === variantType));
}

function pickAssetForSlot<
  T extends {
    id: string;
    variants: Array<{
      format_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
      media_kind: "image" | "video";
    }>;
  },
>(
  slot: { post_type: "feed" | "story" | "reel" },
  assets: T[],
  activeAssetIds: Set<string>,
) {
  const available = assets.filter((asset) => !activeAssetIds.has(asset.id));
  if (available.length === 0) return null;

  if (slot.post_type === "reel") {
    return available.find((asset) => assetHasVariant(asset, "reel_9x16")) ?? available[0] ?? null;
  }

  if (slot.post_type === "story") {
    return available.find((asset) => assetHasVariant(asset, "story_9x16")) ?? available[0] ?? null;
  }

  return available[0] ?? null;
}

function shouldReserveExperiment(slotIndex: number, strategy: PostingStrategy): boolean {
  if (strategy.experimentation_rate_percent <= 0) return false;
  const stride = Math.max(1, Math.round(100 / strategy.experimentation_rate_percent));
  return (slotIndex + 1) % stride === 0;
}

function buildExperimentTag(
  slot: { post_type: "feed" | "story" | "reel"; daypart: string },
  slotIndex: number,
  reserveExperiment: boolean,
) {
  if (!reserveExperiment) return null;
  return `${slot.post_type}_${slot.daypart}_test_${slotIndex + 1}`;
}

function latestSamplesFromPublishedQueue(rows: Array<{
  pillar_key: string | null;
  post_type: "feed" | "story" | "reel";
  scheduled_at: Date;
  analytics: Array<{
    fetched_at: Date;
    views: number | null;
    impressions: number;
    reach: number;
    shares_count: number;
    saves_count: number;
    comments_count: number;
    replies_count: number;
    avg_watch_time_ms: number | null;
  }>;
}>): PerformanceSample[] {
  return rows.flatMap((row) => {
    const latest = row.analytics[0];
    if (!latest) return [];

    const hour = row.scheduled_at.getUTCHours();
    const daypart =
      hour < 11 ? "morning" :
      hour < 15 ? "midday" :
      hour < 18 ? "afternoon" :
      "evening";

    return [{
      postType: row.post_type,
      pillarKey: row.pillar_key,
      daypart,
      fetchedAt: latest.fetched_at,
      views: latest.views ?? latest.impressions ?? latest.reach,
      reach: latest.reach,
      shares: latest.shares_count,
      saves: latest.saves_count,
      comments: latest.comments_count,
      replies: latest.replies_count,
      avgWatchTimeMs: latest.avg_watch_time_ms ?? 0,
    }];
  });
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
  const recentWindowStart = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);

  const [existingPlanItems, upcomingQueue, recentPublishedQueue, approvedAssets] = await Promise.all([
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
      select: {
        asset_id: true,
        scheduled_at: true,
        slot_start: true,
        post_type: true,
      },
    }),
    prisma.publishingQueue.findMany({
      where: {
        profile_id: input.profileId,
        status: "PUBLISHED",
        published_at: {
          gte: recentWindowStart,
        },
      },
      include: {
        analytics: {
          orderBy: { fetched_at: "desc" },
          take: 1,
        },
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
            prompt_text: true,
          },
        },
        variants: true,
      },
      orderBy: [{ reviewed_at: "desc" }, { created_at: "desc" }],
      take: 50,
    }),
  ]);

  const existingByKey = new Map(existingPlanItems.map((item) => [`${item.slot_start.toISOString()}|${item.post_type}`, item]));
  const queueKeys = new Set(upcomingQueue.map((item) => `${(item.slot_start ?? item.scheduled_at).toISOString()}|${item.post_type}`));
  const usageByPillar = new Map<string, number>();
  const performanceSamples = latestSamplesFromPublishedQueue(recentPublishedQueue);
  const performanceBuckets = buildPerformanceBuckets(performanceSamples, now);

  for (const row of recentPublishedQueue) {
    if (!row.pillar_key) continue;
    usageByPillar.set(row.pillar_key, (usageByPillar.get(row.pillar_key) ?? 0) + 1);
  }

  const activeAssetIds = new Set<string>([
    ...existingPlanItems.map((item) => item.asset_id).filter((value): value is string => Boolean(value)),
    ...upcomingQueue.map((item) => item.asset_id),
  ]);
  const upcomingSlots = computeUpcomingSlots(strategy, now, horizonDays);

  for (const [slotIndex, slot] of upcomingSlots.entries()) {
    const slotKey = `${slot.slot_start.toISOString()}|${slot.post_type}`;
    if (queueKeys.has(slotKey)) continue;

    const existingPlan = existingByKey.get(slotKey);
    if (existingPlan && existingPlan.status !== "RECOMMENDED") continue;

    const pillar = pickPillarForSlot({
      slotPillarKey: slot.pillar_key,
      slotPostType: slot.post_type,
      pillars: strategy.pillars,
      usageByPillar,
    });
    const asset = pickAssetForSlot(slot, approvedAssets, activeAssetIds);
    if (asset) {
      activeAssetIds.add(asset.id);
    }

    const reelVariantReady = slot.post_type !== "reel" || assetHasVariant(asset, "reel_9x16");
    const storyVariantReady = slot.post_type !== "story" || assetHasVariant(asset, "story_9x16");
    const performanceIndex = computePerformanceIndex({
      postType: slot.post_type,
      pillarKey: pillar?.key ?? slot.pillar_key ?? null,
      daypart: slot.daypart,
      buckets: performanceBuckets,
    });
    const reserveExperiment = shouldReserveExperiment(slotIndex, strategy);
    const experimentTag = buildExperimentTag(slot, slotIndex, reserveExperiment);
    const copyResult = await buildPublishingCopyFromContext({
      mode: "metadata_draft",
      context: {
        profileId: input.profileId,
        displayName: profile.display_name ?? profile.model.name,
        handle: profile.handle,
        postType: slot.post_type,
        variantType: slot.variant_type,
        scheduledAt: slot.slot_start,
        daypart: slot.daypart,
        primaryGoal: strategy.primary_goal,
        strategyNotes: strategy.notes ?? null,
        pillar: {
          key: pillar?.key ?? slot.pillar_key ?? null,
          name: pillar?.name ?? "Open Slot",
          description: pillar?.description ?? null,
        },
        experimentTag,
        personality: profile.model.personality_profile,
        socialTracks: profile.model.social_tracks_profile,
        asset: asset
          ? {
              id: asset.id,
              sequenceNumber: asset.sequence_number,
              promptText: asset.prompt_text,
              issueTags: asset.issue_tags,
              previewUrl: null,
              campaign: asset.campaign
                ? {
                    id: asset.campaign.id,
                    name: asset.campaign.name,
                    promptText: asset.campaign.prompt_text,
                  }
                : null,
            }
          : null,
      },
    });
    const captionPackage = copyResult.captionPackage;

    const readinessScore = approvedAssets.length >= strategy.min_ready_assets ? 0.08 : -0.04;
    const assetScore = asset ? 0.12 : -0.08;
    const reelReadinessScore = slot.post_type !== "reel" ? 0.04 : reelVariantReady ? 0.09 : -0.12;
    const storyReadinessScore = slot.post_type !== "story" ? 0 : storyVariantReady ? 0.04 : -0.04;
    const windowScore = (slot.window_score - 0.7) * 0.18;
    const performanceBoost = (performanceIndex - 1) * 0.18;
    const experimentAdjustment = reserveExperiment ? -0.03 : 0.02;
    const confidence = Math.max(
      0.18,
      Math.min(
        0.97,
        Number((0.58 + readinessScore + assetScore + reelReadinessScore + storyReadinessScore + windowScore + performanceBoost + experimentAdjustment).toFixed(4)),
      ),
    );

    const strategySnapshot = {
      strategy_id: strategy.id ?? null,
      profile_id: input.profileId,
      profile_handle: profile.handle,
      primary_goal: strategy.primary_goal,
      weekly_post_target: strategy.weekly_post_target,
      weekly_feed_target: strategy.weekly_feed_target,
      weekly_reel_target: strategy.weekly_reel_target,
      weekly_story_target: strategy.weekly_story_target,
      pillar_key: pillar?.key ?? slot.pillar_key ?? null,
      experiment_tag: experimentTag,
      best_time_window_score: slot.window_score,
      generated_at: now.toISOString(),
    };

    const autopilotMetadata = {
      mode: "auto_queue_ready",
      source: "strategy_engine_2026",
      experiment: reserveExperiment,
      experiment_tag: experimentTag,
      caption_package: captionPackage,
      score_breakdown: {
        performance_index: Number(performanceIndex.toFixed(4)),
        time_window_score: Number(slot.window_score.toFixed(4)),
        asset_ready: Boolean(asset),
        reel_variant_ready: reelVariantReady,
        story_variant_ready: storyVariantReady,
        min_ready_assets_met: approvedAssets.length >= strategy.min_ready_assets,
      },
      reel_variant_ready: reelVariantReady,
      queue_eligible: confidence >= strategy.auto_queue_min_confidence && (slot.post_type !== "reel" || reelVariantReady),
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
        ? `${pillar.name} is due for coverage and this ${slot.daypart} slot aligns with a ${(slot.window_score * 100).toFixed(0)}% timing confidence window.`
        : `Adaptive ${slot.post_type} recommendation for the ${slot.daypart} window.`,
      confidence,
      caption_suggestion: copyResult.caption,
      strategy_snapshot: toInputJson(strategySnapshot),
      autopilot_metadata: toInputJson(autopilotMetadata),
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
