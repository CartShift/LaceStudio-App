import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type AnalyticsFilters = {
  modelId?: string;
  profileId?: string;
  pillarKey?: string;
  postType?: "feed" | "story" | "reel";
  startDate?: Date;
  endDate?: Date;
};

export type AnalyticsPostsSortBy = "views" | "engagement_rate" | "reach" | "fetched_at";

export type AnalyticsPostsPage = {
  data: Array<{
    id: string;
    publishing_queue_id: string;
    ig_media_id: string;
    impressions: number;
    reach: number;
    views: number;
    engagement_rate: number;
    share_rate: number;
    save_rate: number;
    likes_count: number;
    comments_count: number;
    saves_count: number;
    shares_count: number;
    replies_count: number;
    avg_watch_time_ms?: number | null;
    fetched_at: string;
    profile_id?: string;
    profile_handle?: string;
    pillar_key?: string;
    post_type: "feed" | "story" | "reel";
    scheduled_at: string;
    published_at?: string;
    queue: {
      asset: {
        campaign: {
          id: string;
          name: string;
          model_id?: string;
        };
      };
    };
  }>;
  total: number;
};

export type AnalyticsDashboardData = {
  kpis: {
    total_views: number;
    total_reach: number;
    avg_engagement_rate: number;
    avg_share_rate: number;
    avg_save_rate: number;
    total_posts: number;
    top_post: {
      publishing_queue_id: string;
      views: number;
      engagement_rate: number;
    } | null;
  };
  model_breakdown: Array<{
    model_id: string;
    views: number;
    reach: number;
    engagement_rate: number;
    share_rate: number;
    save_rate: number;
    post_count: number;
  }>;
  trend_data: Array<{
    date: string;
    views: number;
    engagement_rate: number;
  }>;
};

export type AnalyticsStrategyData = {
  profile_breakdown: Array<{
    profile_id: string;
    profile_handle: string | null;
    total_views: number;
    total_reach: number;
    avg_engagement_rate: number;
    published_posts: number;
  }>;
  pillar_breakdown: Array<{
    pillar_key: string;
    total_views: number;
    total_reach: number;
    avg_engagement_rate: number;
    share_rate: number;
    save_rate: number;
    published_posts: number;
  }>;
  daypart_breakdown: Array<{
    daypart: string;
    avg_views: number;
    avg_engagement_rate: number;
    share_rate: number;
    save_rate: number;
    published_posts: number;
  }>;
  best_time_windows: Array<{
    label: string;
    avg_views: number;
    share_rate: number;
    published_posts: number;
  }>;
  schedule_adherence: {
    on_slot_percent: number;
    avg_publish_delay_minutes: number;
  };
  best_patterns: Array<{
    label: string;
    views: number;
    engagement_rate: number;
    share_rate: number;
    published_posts: number;
  }>;
  experiment_win_rate: number;
  reel_readiness: {
    ready_variants: number;
    pending_jobs: number;
    scheduled_reels: number;
    published_reels: number;
  };
};

type LatestAnalyticsPostRow = {
  id: string;
  publishing_queue_id: string;
  ig_media_id: string;
  reach: unknown;
  views: unknown;
  engagement_rate: unknown;
  impressions: unknown;
  likes_count: unknown;
  comments_count: unknown;
  saves_count: unknown;
  shares_count: unknown;
  replies_count: unknown;
  avg_watch_time_ms: unknown;
  fetched_at: Date | string;
  campaign_id: string;
  campaign_name: string;
  campaign_model_id: string;
  profile_id: string | null;
  profile_handle: string | null;
  pillar_key: string | null;
  post_type: "feed" | "story" | "reel";
  scheduled_at: Date | string;
  published_at: Date | string | null;
  strategy_snapshot: unknown;
};

type AnalyticsCountRow = {
  total_count: unknown;
};

type AnalyticsDashboardKpiRow = {
  total_views: unknown;
  total_reach: unknown;
  total_engagement: unknown;
  total_shares: unknown;
  total_saves: unknown;
  total_posts: unknown;
  top_post_queue_id: string | null;
  top_post_views: unknown;
  top_post_engagement_rate: unknown;
};

type AnalyticsDashboardBreakdownRow = {
  model_id: string;
  views: unknown;
  reach: unknown;
  engagement_rate: unknown;
  share_rate: unknown;
  save_rate: unknown;
  post_count: unknown;
};

type AnalyticsDashboardTrendRow = {
  date: string;
  views: unknown;
  engagement_rate: unknown;
};

function toNumericMetric(value: unknown): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function toIntegerMetric(value: unknown): number {
  return Math.trunc(toNumericMetric(value));
}

function toIsoTimestamp(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function rate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

function buildAnalyticsSourceSql(filters: AnalyticsFilters): Prisma.Sql {
  const conditions: Prisma.Sql[] = [];

  if (filters.startDate) {
    conditions.push(Prisma.sql`snapshots.fetched_at >= ${filters.startDate}`);
  }

  if (filters.endDate) {
    conditions.push(Prisma.sql`snapshots.fetched_at <= ${filters.endDate}`);
  }

  if (filters.modelId) {
    conditions.push(Prisma.sql`campaign.model_id = ${filters.modelId}`);
  }

  if (filters.profileId) {
    conditions.push(Prisma.sql`queue.profile_id = ${filters.profileId}`);
  }

  if (filters.pillarKey) {
    conditions.push(Prisma.sql`queue.pillar_key = ${filters.pillarKey}`);
  }

  if (filters.postType) {
    conditions.push(Prisma.sql`queue.post_type = ${filters.postType}`);
  }

  const whereClause =
    conditions.length > 0
      ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}`
      : Prisma.empty;

  return Prisma.sql`
    FROM analytics_snapshots AS snapshots
    JOIN publishing_queue AS queue ON queue.id = snapshots.publishing_queue_id
    JOIN assets AS asset ON asset.id = queue.asset_id
    JOIN campaigns AS campaign ON campaign.id = asset.campaign_id
    LEFT JOIN instagram_profiles AS profile ON profile.id = queue.profile_id
    ${whereClause}
  `;
}

function buildLatestSnapshotsCte(filters: AnalyticsFilters): Prisma.Sql {
  const sourceSql = buildAnalyticsSourceSql(filters);

  return Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (snapshots.publishing_queue_id)
        snapshots.id,
        snapshots.publishing_queue_id,
        snapshots.ig_media_id,
        snapshots.impressions,
        snapshots.reach,
        snapshots.views,
        snapshots.likes_count,
        snapshots.comments_count,
        snapshots.saves_count,
        snapshots.shares_count,
        snapshots.replies_count,
        snapshots.avg_watch_time_ms,
        snapshots.engagement_total,
        snapshots.engagement_rate,
        snapshots.fetched_at,
        campaign.id AS campaign_id,
        campaign.name AS campaign_name,
        campaign.model_id AS campaign_model_id,
        queue.profile_id,
        profile.handle AS profile_handle,
        queue.pillar_key,
        queue.post_type,
        queue.scheduled_at,
        queue.published_at,
        queue.strategy_snapshot
      ${sourceSql}
      ORDER BY snapshots.publishing_queue_id, snapshots.fetched_at DESC, snapshots.id DESC
    )
  `;
}

function buildLatestPostsOrderBySql(sortBy: AnalyticsPostsSortBy): Prisma.Sql {
  if (sortBy === "views") {
    return Prisma.sql`COALESCE(latest.views, latest.impressions, latest.reach) DESC, latest.fetched_at DESC, latest.id DESC`;
  }

  if (sortBy === "engagement_rate") {
    return Prisma.sql`latest.engagement_rate DESC NULLS LAST, latest.fetched_at DESC, latest.id DESC`;
  }

  if (sortBy === "reach") {
    return Prisma.sql`latest.reach DESC, latest.fetched_at DESC, latest.id DESC`;
  }

  return Prisma.sql`latest.fetched_at DESC, latest.id DESC`;
}

export async function listLatestAnalyticsPostsPage(input: {
  filters: AnalyticsFilters;
  sortBy: AnalyticsPostsSortBy;
  skip: number;
  take: number;
}): Promise<AnalyticsPostsPage> {
  const latestSnapshotsCte = buildLatestSnapshotsCte(input.filters);
  const orderBySql = buildLatestPostsOrderBySql(input.sortBy);

  const [countRows, pageRows] = await Promise.all([
    prisma.$queryRaw<AnalyticsCountRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT COUNT(*) AS total_count
      FROM latest
    `),
    prisma.$queryRaw<LatestAnalyticsPostRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT
        latest.id,
        latest.publishing_queue_id,
        latest.ig_media_id,
        latest.impressions,
        latest.reach,
        latest.views,
        latest.engagement_rate,
        latest.likes_count,
        latest.comments_count,
        latest.saves_count,
        latest.shares_count,
        latest.replies_count,
        latest.avg_watch_time_ms,
        latest.fetched_at,
        latest.campaign_id,
        latest.campaign_name,
        latest.campaign_model_id,
        latest.profile_id,
        latest.profile_handle,
        latest.pillar_key,
        latest.post_type,
        latest.scheduled_at,
        latest.published_at,
        latest.strategy_snapshot
      FROM latest
      ORDER BY ${orderBySql}
      OFFSET ${input.skip}
      LIMIT ${input.take}
    `),
  ]);

  return {
    data: pageRows.map((row) => {
      const views = toIntegerMetric(row.views || row.impressions || row.reach);
      return {
        id: row.id,
        publishing_queue_id: row.publishing_queue_id,
        ig_media_id: row.ig_media_id,
        impressions: toIntegerMetric(row.impressions),
        reach: toIntegerMetric(row.reach),
        views,
        engagement_rate: toNumericMetric(row.engagement_rate),
        share_rate: rate(toIntegerMetric(row.shares_count), views),
        save_rate: rate(toIntegerMetric(row.saves_count), views),
        likes_count: toIntegerMetric(row.likes_count),
        comments_count: toIntegerMetric(row.comments_count),
        saves_count: toIntegerMetric(row.saves_count),
        shares_count: toIntegerMetric(row.shares_count),
        replies_count: toIntegerMetric(row.replies_count),
        avg_watch_time_ms: toIntegerMetric(row.avg_watch_time_ms) || null,
        fetched_at: toIsoTimestamp(row.fetched_at),
        profile_id: row.profile_id ?? undefined,
        profile_handle: row.profile_handle ?? undefined,
        pillar_key: row.pillar_key ?? undefined,
        post_type: row.post_type,
        scheduled_at: toIsoTimestamp(row.scheduled_at),
        published_at: row.published_at ? toIsoTimestamp(row.published_at) : undefined,
        queue: {
          asset: {
            campaign: {
              id: row.campaign_id,
              name: row.campaign_name,
              model_id: row.campaign_model_id,
            },
          },
        },
      };
    }),
    total: toIntegerMetric(countRows[0]?.total_count),
  };
}

export async function getAnalyticsDashboardData(filters: AnalyticsFilters): Promise<AnalyticsDashboardData> {
  const latestSnapshotsCte = buildLatestSnapshotsCte(filters);
  const analyticsSourceSql = buildAnalyticsSourceSql(filters);

  const [kpiRows, modelBreakdownRows, trendRows] = await Promise.all([
    prisma.$queryRaw<AnalyticsDashboardKpiRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT
        COALESCE(SUM(COALESCE(latest.views, latest.impressions, latest.reach)), 0) AS total_views,
        COALESCE(SUM(latest.reach), 0) AS total_reach,
        COALESCE(SUM(latest.engagement_total), 0) AS total_engagement,
        COALESCE(SUM(latest.shares_count), 0) AS total_shares,
        COALESCE(SUM(latest.saves_count), 0) AS total_saves,
        COUNT(*) AS total_posts,
        (
          SELECT latest_top.publishing_queue_id
          FROM latest AS latest_top
          ORDER BY COALESCE(latest_top.views, latest_top.impressions, latest_top.reach) DESC, latest_top.fetched_at DESC, latest_top.id DESC
          LIMIT 1
        ) AS top_post_queue_id,
        (
          SELECT COALESCE(latest_top.views, latest_top.impressions, latest_top.reach)
          FROM latest AS latest_top
          ORDER BY COALESCE(latest_top.views, latest_top.impressions, latest_top.reach) DESC, latest_top.fetched_at DESC, latest_top.id DESC
          LIMIT 1
        ) AS top_post_views,
        (
          SELECT latest_top.engagement_rate
          FROM latest AS latest_top
          ORDER BY COALESCE(latest_top.views, latest_top.impressions, latest_top.reach) DESC, latest_top.fetched_at DESC, latest_top.id DESC
          LIMIT 1
        ) AS top_post_engagement_rate
      FROM latest
    `),
    prisma.$queryRaw<AnalyticsDashboardBreakdownRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT
        latest.campaign_model_id AS model_id,
        SUM(COALESCE(latest.views, latest.impressions, latest.reach)) AS views,
        SUM(latest.reach) AS reach,
        CASE
          WHEN SUM(latest.reach) = 0 THEN 0
          ELSE ROUND((SUM(latest.engagement_total)::numeric / SUM(latest.reach)::numeric) * 100, 2)
        END AS engagement_rate,
        CASE
          WHEN SUM(COALESCE(latest.views, latest.impressions, latest.reach)) = 0 THEN 0
          ELSE ROUND((SUM(latest.shares_count)::numeric / SUM(COALESCE(latest.views, latest.impressions, latest.reach))::numeric) * 100, 2)
        END AS share_rate,
        CASE
          WHEN SUM(COALESCE(latest.views, latest.impressions, latest.reach)) = 0 THEN 0
          ELSE ROUND((SUM(latest.saves_count)::numeric / SUM(COALESCE(latest.views, latest.impressions, latest.reach))::numeric) * 100, 2)
        END AS save_rate,
        COUNT(*) AS post_count
      FROM latest
      GROUP BY latest.campaign_model_id
      ORDER BY views DESC, latest.campaign_model_id ASC
    `),
    prisma.$queryRaw<AnalyticsDashboardTrendRow[]>(Prisma.sql`
      WITH daily_latest AS (
        SELECT DISTINCT ON (
          snapshots.publishing_queue_id,
          DATE_TRUNC('day', snapshots.fetched_at AT TIME ZONE 'UTC')
        )
          DATE_TRUNC('day', snapshots.fetched_at AT TIME ZONE 'UTC') AS day_bucket,
          snapshots.publishing_queue_id,
          COALESCE(snapshots.views, snapshots.impressions, snapshots.reach) AS views,
          snapshots.reach,
          snapshots.engagement_total,
          snapshots.fetched_at,
          snapshots.id
        ${analyticsSourceSql}
        ORDER BY
          snapshots.publishing_queue_id,
          DATE_TRUNC('day', snapshots.fetched_at AT TIME ZONE 'UTC'),
          snapshots.fetched_at DESC,
          snapshots.id DESC
      )
      SELECT
        TO_CHAR(day_bucket, 'YYYY-MM-DD') AS date,
        COALESCE(SUM(views), 0) AS views,
        CASE
          WHEN SUM(reach) = 0 THEN 0
          ELSE ROUND((SUM(engagement_total)::numeric / SUM(reach)::numeric) * 100, 2)
        END AS engagement_rate
      FROM daily_latest
      GROUP BY day_bucket
      ORDER BY day_bucket ASC
    `),
  ]);

  const kpis = kpiRows[0];
  const totalViews = toIntegerMetric(kpis?.total_views);
  const totalReach = toIntegerMetric(kpis?.total_reach);

  return {
    kpis: {
      total_views: totalViews,
      total_reach: totalReach,
      avg_engagement_rate: totalReach > 0 ? Number(((toIntegerMetric(kpis?.total_engagement) / totalReach) * 100).toFixed(2)) : 0,
      avg_share_rate: totalViews > 0 ? Number(((toIntegerMetric(kpis?.total_shares) / totalViews) * 100).toFixed(2)) : 0,
      avg_save_rate: totalViews > 0 ? Number(((toIntegerMetric(kpis?.total_saves) / totalViews) * 100).toFixed(2)) : 0,
      total_posts: toIntegerMetric(kpis?.total_posts),
      top_post: kpis?.top_post_queue_id
        ? {
            publishing_queue_id: kpis.top_post_queue_id,
            views: toIntegerMetric(kpis.top_post_views),
            engagement_rate: toNumericMetric(kpis.top_post_engagement_rate),
          }
        : null,
    },
    model_breakdown: modelBreakdownRows.map((row) => ({
      model_id: row.model_id,
      views: toIntegerMetric(row.views),
      reach: toIntegerMetric(row.reach),
      engagement_rate: toNumericMetric(row.engagement_rate),
      share_rate: toNumericMetric(row.share_rate),
      save_rate: toNumericMetric(row.save_rate),
      post_count: toIntegerMetric(row.post_count),
    })),
    trend_data: trendRows.map((row) => ({
      date: row.date,
      views: toIntegerMetric(row.views),
      engagement_rate: toNumericMetric(row.engagement_rate),
    })),
  };
}

function inferDaypartFromIso(value: string): string {
  const hour = new Date(value).getUTCHours();
  if (hour < 11) return "morning";
  if (hour < 15) return "midday";
  if (hour < 18) return "afternoon";
  return "evening";
}

function summarizeWindowLabel(value: string): string {
  const date = new Date(value);
  return date.toLocaleDateString("en-US", { weekday: "short" }) + " " + date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function strategySnapshotRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function getAnalyticsStrategyData(filters: AnalyticsFilters): Promise<AnalyticsStrategyData> {
  const latestSnapshotsCte = buildLatestSnapshotsCte(filters);
  const rows = await prisma.$queryRaw<LatestAnalyticsPostRow[]>(Prisma.sql`
    ${latestSnapshotsCte}
    SELECT
      latest.id,
      latest.publishing_queue_id,
      latest.ig_media_id,
      latest.impressions,
      latest.reach,
      latest.views,
      latest.engagement_rate,
      latest.likes_count,
      latest.comments_count,
      latest.saves_count,
      latest.shares_count,
      latest.replies_count,
      latest.avg_watch_time_ms,
      latest.fetched_at,
      latest.campaign_id,
      latest.campaign_name,
      latest.campaign_model_id,
      latest.profile_id,
      latest.profile_handle,
      latest.pillar_key,
      latest.post_type,
      latest.scheduled_at,
      latest.published_at,
      latest.strategy_snapshot
    FROM latest
    ORDER BY latest.fetched_at DESC, latest.id DESC
  `);

  const profileMap = new Map<string, { views: number; reach: number; engagementTotal: number; posts: number; handle: string | null }>();
  const pillarMap = new Map<string, { views: number; reach: number; shares: number; saves: number; engagementTotal: number; posts: number }>();
  const daypartMap = new Map<string, { views: number; reach: number; shares: number; saves: number; engagementTotal: number; posts: number }>();
  const patternMap = new Map<string, { views: number; shares: number; engagementTotal: number; posts: number }>();
  const timeWindowMap = new Map<string, { views: number; shares: number; posts: number }>();
  const adherenceRows: Array<{ scheduledAt: string; publishedAt: string | null }> = [];
  let experimentCount = 0;
  let experimentWins = 0;

  for (const row of rows) {
    const views = toIntegerMetric(row.views || row.impressions || row.reach);
    const reach = toIntegerMetric(row.reach);
    const engagementRate = toNumericMetric(row.engagement_rate);
    const shares = toIntegerMetric(row.shares_count);
    const saves = toIntegerMetric(row.saves_count);
    const engagementTotal = Math.round((reach * engagementRate) / 100);
    const daypart = inferDaypartFromIso(toIsoTimestamp(row.scheduled_at));
    const timeWindowLabel = summarizeWindowLabel(toIsoTimestamp(row.scheduled_at));
    const snapshot = strategySnapshotRecord(row.strategy_snapshot);
    const experimentTag = typeof snapshot?.experiment_tag === "string" ? snapshot.experiment_tag : null;

    if (row.profile_id) {
      const current = profileMap.get(row.profile_id) ?? {
        views: 0,
        reach: 0,
        engagementTotal: 0,
        posts: 0,
        handle: row.profile_handle ?? null,
      };
      current.views += views;
      current.reach += reach;
      current.engagementTotal += engagementTotal;
      current.posts += 1;
      profileMap.set(row.profile_id, current);
    }

    if (row.pillar_key) {
      const current = pillarMap.get(row.pillar_key) ?? { views: 0, reach: 0, shares: 0, saves: 0, engagementTotal: 0, posts: 0 };
      current.views += views;
      current.reach += reach;
      current.shares += shares;
      current.saves += saves;
      current.engagementTotal += engagementTotal;
      current.posts += 1;
      pillarMap.set(row.pillar_key, current);
    }

    const daypartCurrent = daypartMap.get(daypart) ?? { views: 0, reach: 0, shares: 0, saves: 0, engagementTotal: 0, posts: 0 };
    daypartCurrent.views += views;
    daypartCurrent.reach += reach;
    daypartCurrent.shares += shares;
    daypartCurrent.saves += saves;
    daypartCurrent.engagementTotal += engagementTotal;
    daypartCurrent.posts += 1;
    daypartMap.set(daypart, daypartCurrent);

    const patternLabel = `${row.post_type} · ${row.pillar_key ?? "uncategorized"}`;
    const patternCurrent = patternMap.get(patternLabel) ?? { views: 0, shares: 0, engagementTotal: 0, posts: 0 };
    patternCurrent.views += views;
    patternCurrent.shares += shares;
    patternCurrent.engagementTotal += engagementTotal;
    patternCurrent.posts += 1;
    patternMap.set(patternLabel, patternCurrent);

    const timeWindowCurrent = timeWindowMap.get(timeWindowLabel) ?? { views: 0, shares: 0, posts: 0 };
    timeWindowCurrent.views += views;
    timeWindowCurrent.shares += shares;
    timeWindowCurrent.posts += 1;
    timeWindowMap.set(timeWindowLabel, timeWindowCurrent);

    if (experimentTag) {
      experimentCount += 1;
      if (views >= 1000 || shares >= 20) {
        experimentWins += 1;
      }
    }

    adherenceRows.push({
      scheduledAt: toIsoTimestamp(row.scheduled_at),
      publishedAt: row.published_at ? toIsoTimestamp(row.published_at) : null,
    });
  }

  const publishedWithActualPublish = adherenceRows.filter((row) => row.publishedAt);
  const onSlotCount = publishedWithActualPublish.filter((row) => {
    const diffMinutes = Math.abs(new Date(row.publishedAt!).getTime() - new Date(row.scheduledAt).getTime()) / (60 * 1000);
    return diffMinutes <= 30;
  }).length;
  const totalDelay = publishedWithActualPublish.reduce((sum, row) => {
    const diffMinutes = Math.abs(new Date(row.publishedAt!).getTime() - new Date(row.scheduledAt).getTime()) / (60 * 1000);
    return sum + diffMinutes;
  }, 0);

  const reelReadiness = await getReelReadiness(filters);

  return {
    profile_breakdown: Array.from(profileMap.entries())
      .map(([profileId, value]) => ({
        profile_id: profileId,
        profile_handle: value.handle,
        total_views: value.views,
        total_reach: value.reach,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        published_posts: value.posts,
      }))
      .sort((left, right) => right.total_views - left.total_views),
    pillar_breakdown: Array.from(pillarMap.entries())
      .map(([pillarKey, value]) => ({
        pillar_key: pillarKey,
        total_views: value.views,
        total_reach: value.reach,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        share_rate: rate(value.shares, value.views),
        save_rate: rate(value.saves, value.views),
        published_posts: value.posts,
      }))
      .sort((left, right) => right.total_views - left.total_views),
    daypart_breakdown: Array.from(daypartMap.entries())
      .map(([daypart, value]) => ({
        daypart,
        avg_views: value.posts > 0 ? Math.round(value.views / value.posts) : 0,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        share_rate: rate(value.shares, value.views),
        save_rate: rate(value.saves, value.views),
        published_posts: value.posts,
      }))
      .sort((left, right) => right.avg_views - left.avg_views),
    best_time_windows: Array.from(timeWindowMap.entries())
      .map(([label, value]) => ({
        label,
        avg_views: value.posts > 0 ? Math.round(value.views / value.posts) : 0,
        share_rate: rate(value.shares, value.views),
        published_posts: value.posts,
      }))
      .sort((left, right) => right.avg_views - left.avg_views)
      .slice(0, 5),
    schedule_adherence: {
      on_slot_percent:
        publishedWithActualPublish.length > 0
          ? Number(((onSlotCount / publishedWithActualPublish.length) * 100).toFixed(2))
          : 0,
      avg_publish_delay_minutes:
        publishedWithActualPublish.length > 0
          ? Number((totalDelay / publishedWithActualPublish.length).toFixed(2))
          : 0,
    },
    best_patterns: Array.from(patternMap.entries())
      .map(([label, value]) => ({
        label,
        views: value.views,
        engagement_rate: value.views > 0 ? Number(((value.engagementTotal / value.views) * 100).toFixed(2)) : 0,
        share_rate: rate(value.shares, value.views),
        published_posts: value.posts,
      }))
      .sort((left, right) => right.views - left.views)
      .slice(0, 5),
    experiment_win_rate: experimentCount > 0 ? Number(((experimentWins / experimentCount) * 100).toFixed(2)) : 0,
    reel_readiness: reelReadiness,
  };
}

async function getReelReadiness(filters: AnalyticsFilters): Promise<AnalyticsStrategyData["reel_readiness"]> {
  const readyVariantsWhere = filters.modelId
    ? {
        asset: {
          campaign: {
            model_id: filters.modelId,
          },
        },
      }
    : undefined;

  const pendingJobsWhere = filters.modelId
    ? {
        asset: {
          campaign: {
            model_id: filters.modelId,
          },
        },
      }
    : undefined;

  const queueWhere = {
    ...(filters.profileId ? { profile_id: filters.profileId } : {}),
    ...(filters.postType ? { post_type: filters.postType } : {}),
    post_type: "reel" as const,
  };

  const [readyVariants, pendingJobs, scheduledReels, publishedReels] = await Promise.all([
    prisma.assetVariant.count({
      where: {
        format_type: "reel_9x16",
        ...(readyVariantsWhere ?? {}),
      },
    }),
    prisma.videoGenerationJob.count({
      where: {
        status: {
          in: ["PENDING", "PROCESSING"],
        },
        ...(pendingJobsWhere ?? {}),
      },
    }),
    prisma.publishingQueue.count({
      where: {
        ...queueWhere,
        status: {
          in: ["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"],
        },
      },
    }),
    prisma.publishingQueue.count({
      where: {
        ...queueWhere,
        status: "PUBLISHED",
      },
    }),
  ]);

  return {
    ready_variants: readyVariants,
    pending_jobs: pendingJobs,
    scheduled_reels: scheduledReels,
    published_reels: publishedReels,
  };
}
