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
        reach: "220",
        engagement_rate: "20",
        fetched_at: new Date("2026-03-11T18:00:00.000Z"),
        campaign_id: "campaign-2",
        campaign_name: "Campaign Two",
      },
      {
        id: "snap-2",
        publishing_queue_id: "queue-1",
        ig_media_id: "ig-1",
        reach: "150",
        engagement_rate: "10",
        fetched_at: "2026-03-11T08:00:00.000Z",
        campaign_id: "campaign-1",
        campaign_name: "Campaign One",
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
          reach: 220,
          engagement_rate: 20,
          fetched_at: "2026-03-11T18:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-2", name: "Campaign Two" } } },
        },
        {
          id: "snap-2",
          publishing_queue_id: "queue-1",
          ig_media_id: "ig-1",
          reach: 150,
          engagement_rate: 10,
          fetched_at: "2026-03-11T08:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-1", name: "Campaign One" } } },
        },
      ],
      total: 2,
    });
  });

  it("maps dashboard aggregates returned from SQL", async () => {
    prismaMock.$queryRaw
      .mockResolvedValueOnce([
        {
          total_reach: "370",
          total_engagement: "59",
          total_posts: "2",
          top_post_queue_id: "queue-2",
          top_post_engagement_rate: "20",
        },
      ])
      .mockResolvedValueOnce([
        {
          model_id: "model-2",
          reach: "220",
          engagement_rate: "20",
          post_count: "1",
        },
        {
          model_id: "model-1",
          reach: "150",
          engagement_rate: "10",
          post_count: "1",
        },
      ])
      .mockResolvedValueOnce([
        {
          date: "2026-03-10",
          engagement_rate: "10",
        },
        {
          date: "2026-03-11",
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
        total_reach: 370,
        avg_engagement_rate: 15.95,
        total_posts: 2,
        top_post: {
          publishing_queue_id: "queue-2",
          engagement_rate: 20,
        },
      },
      model_breakdown: [
        {
          model_id: "model-2",
          reach: 220,
          engagement_rate: 20,
          post_count: 1,
        },
        {
          model_id: "model-1",
          reach: 150,
          engagement_rate: 10,
          post_count: 1,
        },
      ],
      trend_data: [
        {
          date: "2026-03-10",
          engagement_rate: 10,
        },
        {
          date: "2026-03-11",
          engagement_rate: 15.95,
        },
      ],
    });
  });
});
