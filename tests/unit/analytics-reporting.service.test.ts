import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: prismaMock,
}));

import {
  getAnalyticsDashboardData,
  listLatestAnalyticsPostsPage,
} from "@/server/services/analytics-reporting.service";

describe("analytics-reporting.service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps latest post rows from database-side pagination queries", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([{ total_count: "2" }]).mockResolvedValueOnce([
      {
        id: "snap-3",
        publishing_queue_id: "queue-2",
        ig_media_id: "ig-2",
        impressions: "410",
        reach: "220",
        views: "520",
        engagement_rate: "20",
        likes_count: "120",
        comments_count: "14",
        saves_count: "18",
        shares_count: "16",
        replies_count: "0",
        avg_watch_time_ms: "6400",
        fetched_at: new Date("2026-03-11T18:00:00.000Z"),
        campaign_id: "campaign-2",
        campaign_name: "Campaign Two",
        campaign_model_id: "model-2",
        profile_id: "profile-2",
        profile_handle: "@campaign_two",
        pillar_key: "discoverability_reels",
        post_type: "reel",
        scheduled_at: new Date("2026-03-11T17:00:00.000Z"),
        published_at: new Date("2026-03-11T17:05:00.000Z"),
        strategy_snapshot: null,
      },
      {
        id: "snap-2",
        publishing_queue_id: "queue-1",
        ig_media_id: "ig-1",
        impressions: "260",
        reach: "150",
        views: "320",
        engagement_rate: "10",
        likes_count: "80",
        comments_count: "6",
        saves_count: "9",
        shares_count: "7",
        replies_count: "0",
        avg_watch_time_ms: null,
        fetched_at: "2026-03-11T08:00:00.000Z",
        campaign_id: "campaign-1",
        campaign_name: "Campaign One",
        campaign_model_id: "model-1",
        profile_id: "profile-1",
        profile_handle: "@campaign_one",
        pillar_key: "saveable_feed",
        post_type: "feed",
        scheduled_at: "2026-03-11T07:00:00.000Z",
        published_at: "2026-03-11T07:10:00.000Z",
        strategy_snapshot: null,
      },
    ]);

    const result = await listLatestAnalyticsPostsPage({
      filters: {
        startDate: new Date("2026-03-10T00:00:00.000Z"),
        endDate: new Date("2026-03-11T23:59:59.000Z"),
      },
      sortBy: "engagement_rate",
      skip: 0,
      take: 50,
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      data: [
        {
          id: "snap-3",
          publishing_queue_id: "queue-2",
          ig_media_id: "ig-2",
          impressions: 410,
          reach: 220,
          views: 520,
          engagement_rate: 20,
          share_rate: 3.08,
          save_rate: 3.46,
          likes_count: 120,
          comments_count: 14,
          saves_count: 18,
          shares_count: 16,
          replies_count: 0,
          avg_watch_time_ms: 6400,
          profile_id: "profile-2",
          profile_handle: "@campaign_two",
          pillar_key: "discoverability_reels",
          post_type: "reel",
          scheduled_at: "2026-03-11T17:00:00.000Z",
          published_at: "2026-03-11T17:05:00.000Z",
          fetched_at: "2026-03-11T18:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-2", name: "Campaign Two", model_id: "model-2" } } },
        },
        {
          id: "snap-2",
          publishing_queue_id: "queue-1",
          ig_media_id: "ig-1",
          impressions: 260,
          reach: 150,
          views: 320,
          engagement_rate: 10,
          share_rate: 2.19,
          save_rate: 2.81,
          likes_count: 80,
          comments_count: 6,
          saves_count: 9,
          shares_count: 7,
          replies_count: 0,
          avg_watch_time_ms: null,
          profile_id: "profile-1",
          profile_handle: "@campaign_one",
          pillar_key: "saveable_feed",
          post_type: "feed",
          scheduled_at: "2026-03-11T07:00:00.000Z",
          published_at: "2026-03-11T07:10:00.000Z",
          fetched_at: "2026-03-11T08:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-1", name: "Campaign One", model_id: "model-1" } } },
        },
      ],
      total: 2,
    });
  });

  it("maps dashboard aggregates returned from SQL", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          total_views: "840",
          total_reach: "370",
          total_engagement: "59",
          total_shares: "23",
          total_saves: "27",
          total_posts: "2",
          top_post_queue_id: "queue-2",
          top_post_views: "520",
          top_post_engagement_rate: "20",
        },
      ])
      .mockResolvedValueOnce([
        {
          model_id: "model-2",
          views: "520",
          reach: "220",
          engagement_rate: "20",
          share_rate: "3.08",
          save_rate: "3.46",
          post_count: "1",
        },
        {
          model_id: "model-1",
          views: "320",
          reach: "150",
          engagement_rate: "10",
          share_rate: "2.19",
          save_rate: "2.81",
          post_count: "1",
        },
      ])
      .mockResolvedValueOnce([
        {
          date: "2026-03-10",
          views: "320",
          engagement_rate: "10",
        },
        {
          date: "2026-03-11",
          views: "520",
          engagement_rate: "15.95",
        },
      ]);

    const result = await getAnalyticsDashboardData({
      startDate: new Date("2026-03-10T00:00:00.000Z"),
      endDate: new Date("2026-03-11T23:59:59.000Z"),
    });

    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(3);
    expect(result).toEqual({
      kpis: {
        total_views: 840,
        total_reach: 370,
        avg_engagement_rate: 15.95,
        avg_share_rate: 2.74,
        avg_save_rate: 3.21,
        total_posts: 2,
        top_post: {
          publishing_queue_id: "queue-2",
          views: 520,
          engagement_rate: 20,
        },
      },
      model_breakdown: [
        {
          model_id: "model-2",
          views: 520,
          reach: 220,
          engagement_rate: 20,
          share_rate: 3.08,
          save_rate: 3.46,
          post_count: 1,
        },
        {
          model_id: "model-1",
          views: 320,
          reach: 150,
          engagement_rate: 10,
          share_rate: 2.19,
          save_rate: 2.81,
          post_count: 1,
        },
      ],
      trend_data: [
        {
          date: "2026-03-10",
          views: 320,
          engagement_rate: 10,
        },
        {
          date: "2026-03-11",
          views: 520,
          engagement_rate: 15.95,
        },
      ],
    });
  });
});
