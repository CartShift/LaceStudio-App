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

export type AnalyticsPostsSortBy = "engagement_rate" | "reach" | "fetched_at";

export type AnalyticsPostsPage = {
  data: Array<{
    id: string;
    publishing_queue_id: string;
    ig_media_id: string;
    impressions: number;
    reach: number;
    engagement_rate: number;
    likes_count: number;
    comments_count: number;
    saves_count: number;
    shares_count: number;
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
    total_reach: number;
    avg_engagement_rate: number;
    total_posts: number;
    top_post: {
      publishing_queue_id: string;
      engagement_rate: number;
    } | null;
  };
  model_breakdown: Array<{
    model_id: string;
    reach: number;
    engagement_rate: number;
    post_count: number;
  }>;
  trend_data: Array<{
    date: string;
    engagement_rate: number;
  }>;
};

export type AnalyticsStrategyData = {
  profile_breakdown: Array<{
    profile_id: string;
    profile_handle: string | null;
    total_reach: number;
    avg_engagement_rate: number;
    published_posts: number;
  }>;
  pillar_breakdown: Array<{
    pillar_key: string;
    total_reach: number;
    avg_engagement_rate: number;
    published_posts: number;
  }>;
  daypart_breakdown: Array<{
    daypart: string;
    avg_engagement_rate: number;
    published_posts: number;
  }>;
  schedule_adherence: {
    on_slot_percent: number;
    avg_publish_delay_minutes: number;
  };
  best_patterns: Array<{
    label: string;
    engagement_rate: number;
    published_posts: number;
  }>;
};

type LatestAnalyticsPostRow = {
  id: string;
  publishing_queue_id: string;
  ig_media_id: string;
  reach: unknown;
  engagement_rate: unknown;
  impressions: unknown;
  likes_count: unknown;
  comments_count: unknown;
  saves_count: unknown;
  shares_count: unknown;
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
};

type AnalyticsDashboardKpiRow = {
  total_reach: unknown;
  total_engagement: unknown;
  total_posts: unknown;
  top_post_queue_id: string | null;
  top_post_engagement_rate: unknown;
};

type AnalyticsDashboardBreakdownRow = {
  model_id: string;
  reach: unknown;
  engagement_rate: unknown;
  post_count: unknown;
};

type AnalyticsDashboardTrendRow = {
  date: string;
  engagement_rate: unknown;
};

type AnalyticsCountRow = {
  total_count: unknown;
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
        snapshots.likes_count,
        snapshots.comments_count,
        snapshots.saves_count,
        snapshots.shares_count,
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
        queue.published_at
      ${sourceSql}
      ORDER BY snapshots.publishing_queue_id, snapshots.fetched_at DESC, snapshots.id DESC
    )
  `;
}

function buildLatestPostsOrderBySql(sortBy: AnalyticsPostsSortBy): Prisma.Sql {
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
        latest.engagement_rate,
        latest.likes_count,
        latest.comments_count,
        latest.saves_count,
        latest.shares_count,
        latest.fetched_at,
        latest.campaign_id,
        latest.campaign_name,
        latest.campaign_model_id,
        latest.profile_id,
        latest.profile_handle,
        latest.pillar_key,
        latest.post_type,
        latest.scheduled_at,
        latest.published_at
      FROM latest
      ORDER BY ${orderBySql}
      OFFSET ${input.skip}
      LIMIT ${input.take}
    `),
  ]);

  return {
    data: pageRows.map((row) => ({
      id: row.id,
      publishing_queue_id: row.publishing_queue_id,
      ig_media_id: row.ig_media_id,
      impressions: toIntegerMetric(row.impressions),
      reach: toIntegerMetric(row.reach),
      engagement_rate: toNumericMetric(row.engagement_rate),
      likes_count: toIntegerMetric(row.likes_count),
      comments_count: toIntegerMetric(row.comments_count),
      saves_count: toIntegerMetric(row.saves_count),
      shares_count: toIntegerMetric(row.shares_count),
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
    })),
    total: toIntegerMetric(countRows[0]?.total_count),
  };
}

export async function getAnalyticsDashboardData(
  filters: AnalyticsFilters,
): Promise<AnalyticsDashboardData> {
  const latestSnapshotsCte = buildLatestSnapshotsCte(filters);
  const analyticsSourceSql = buildAnalyticsSourceSql(filters);

  const [kpiRows, modelBreakdownRows, trendRows] = await Promise.all([
    prisma.$queryRaw<AnalyticsDashboardKpiRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT
        COALESCE(SUM(latest.reach), 0) AS total_reach,
        COALESCE(SUM(latest.engagement_total), 0) AS total_engagement,
        COUNT(*) AS total_posts,
        (
          SELECT latest_top.publishing_queue_id
          FROM latest AS latest_top
          ORDER BY latest_top.engagement_rate DESC NULLS LAST, latest_top.fetched_at DESC, latest_top.id DESC
          LIMIT 1
        ) AS top_post_queue_id,
        (
          SELECT latest_top.engagement_rate
          FROM latest AS latest_top
          ORDER BY latest_top.engagement_rate DESC NULLS LAST, latest_top.fetched_at DESC, latest_top.id DESC
          LIMIT 1
        ) AS top_post_engagement_rate
      FROM latest
    `),
    prisma.$queryRaw<AnalyticsDashboardBreakdownRow[]>(Prisma.sql`
      ${latestSnapshotsCte}
      SELECT
        latest.model_id,
        SUM(latest.reach) AS reach,
        CASE
          WHEN SUM(latest.reach) = 0 THEN 0
          ELSE ROUND((SUM(latest.engagement_total)::numeric / SUM(latest.reach)::numeric) * 100, 2)
        END AS engagement_rate,
        COUNT(*) AS post_count
      FROM latest
      GROUP BY latest.model_id
      ORDER BY reach DESC, latest.model_id ASC
    `),
    prisma.$queryRaw<AnalyticsDashboardTrendRow[]>(Prisma.sql`
      WITH daily_latest AS (
        SELECT DISTINCT ON (
          snapshots.publishing_queue_id,
          DATE_TRUNC('day', snapshots.fetched_at AT TIME ZONE 'UTC')
        )
          DATE_TRUNC('day', snapshots.fetched_at AT TIME ZONE 'UTC') AS day_bucket,
          snapshots.publishing_queue_id,
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
  const totalReach = toIntegerMetric(kpis?.total_reach);
  const totalEngagement = toIntegerMetric(kpis?.total_engagement);

  return {
    kpis: {
      total_reach: totalReach,
      avg_engagement_rate:
        totalReach > 0 ? Number(((totalEngagement / totalReach) * 100).toFixed(2)) : 0,
      total_posts: toIntegerMetric(kpis?.total_posts),
      top_post: kpis?.top_post_queue_id
        ? {
            publishing_queue_id: kpis.top_post_queue_id,
            engagement_rate: toNumericMetric(kpis.top_post_engagement_rate),
          }
        : null,
    },
    model_breakdown: modelBreakdownRows.map((row) => ({
      model_id: row.model_id,
      reach: toIntegerMetric(row.reach),
      engagement_rate: toNumericMetric(row.engagement_rate),
      post_count: toIntegerMetric(row.post_count),
    })),
    trend_data: trendRows.map((row) => ({
      date: row.date,
      engagement_rate: toNumericMetric(row.engagement_rate),
    })),
  };
}

function inferDaypartFromIso(value: string): string {
  const hour = new Date(value).getUTCHours();
  if (hour < 11) return "morning";
  if (hour < 16) return "midday";
  if (hour < 20) return "evening";
  return "night";
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
      latest.engagement_rate,
      latest.likes_count,
      latest.comments_count,
      latest.saves_count,
      latest.shares_count,
      latest.fetched_at,
      latest.campaign_id,
      latest.campaign_name,
      latest.campaign_model_id,
      latest.profile_id,
      latest.profile_handle,
      latest.pillar_key,
      latest.post_type,
      latest.scheduled_at,
      latest.published_at
    FROM latest
    ORDER BY latest.fetched_at DESC, latest.id DESC
  `);

  const profileMap = new Map<string, { reach: number; engagementTotal: number; posts: number; handle: string | null }>();
  const pillarMap = new Map<string, { reach: number; engagementTotal: number; posts: number }>();
  const daypartMap = new Map<string, { engagementTotal: number; reach: number; posts: number }>();
  const patternMap = new Map<string, { engagementTotal: number; reach: number; posts: number }>();
  const adherenceRows: Array<{ scheduledAt: string; publishedAt: string | null }> = [];

  for (const row of rows) {
    const reach = toIntegerMetric(row.reach);
    const engagementRate = toNumericMetric(row.engagement_rate);
    const engagementTotal = Math.round((reach * engagementRate) / 100);

    if (row.profile_id) {
      const current = profileMap.get(row.profile_id) ?? {
        reach: 0,
        engagementTotal: 0,
        posts: 0,
        handle: row.profile_handle ?? null,
      };
      current.reach += reach;
      current.engagementTotal += engagementTotal;
      current.posts += 1;
      profileMap.set(row.profile_id, current);
    }

    if (row.pillar_key) {
      const current = pillarMap.get(row.pillar_key) ?? { reach: 0, engagementTotal: 0, posts: 0 };
      current.reach += reach;
      current.engagementTotal += engagementTotal;
      current.posts += 1;
      pillarMap.set(row.pillar_key, current);
    }

    const daypart = inferDaypartFromIso(toIsoTimestamp(row.scheduled_at));
    const daypartCurrent = daypartMap.get(daypart) ?? { reach: 0, engagementTotal: 0, posts: 0 };
    daypartCurrent.reach += reach;
    daypartCurrent.engagementTotal += engagementTotal;
    daypartCurrent.posts += 1;
    daypartMap.set(daypart, daypartCurrent);

    const patternLabel = `${row.post_type} · ${row.pillar_key ?? "uncategorized"}`;
    const patternCurrent = patternMap.get(patternLabel) ?? { reach: 0, engagementTotal: 0, posts: 0 };
    patternCurrent.reach += reach;
    patternCurrent.engagementTotal += engagementTotal;
    patternCurrent.posts += 1;
    patternMap.set(patternLabel, patternCurrent);

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

  return {
    profile_breakdown: Array.from(profileMap.entries())
      .map(([profileId, value]) => ({
        profile_id: profileId,
        profile_handle: value.handle,
        total_reach: value.reach,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        published_posts: value.posts,
      }))
      .sort((left, right) => right.total_reach - left.total_reach),
    pillar_breakdown: Array.from(pillarMap.entries())
      .map(([pillarKey, value]) => ({
        pillar_key: pillarKey,
        total_reach: value.reach,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        published_posts: value.posts,
      }))
      .sort((left, right) => right.avg_engagement_rate - left.avg_engagement_rate),
    daypart_breakdown: Array.from(daypartMap.entries())
      .map(([daypart, value]) => ({
        daypart,
        avg_engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        published_posts: value.posts,
      }))
      .sort((left, right) => right.avg_engagement_rate - left.avg_engagement_rate),
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
        engagement_rate: value.reach > 0 ? Number(((value.engagementTotal / value.reach) * 100).toFixed(2)) : 0,
        published_posts: value.posts,
      }))
      .sort((left, right) => right.engagement_rate - left.engagement_rate)
      .slice(0, 5),
  };
}
