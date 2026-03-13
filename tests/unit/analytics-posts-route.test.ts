import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "admin-1" })),
  assertRoleMock: vi.fn(),
  isDemoModeMock: vi.fn(() => false),
  analyticsPostsMock: vi.fn(),
  listLatestAnalyticsPostsPageMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSessionContext: mocks.getSessionContextMock,
  assertRole: mocks.assertRoleMock,
}));

vi.mock("@/server/demo/mode", () => ({
  isDemoMode: mocks.isDemoModeMock,
}));

vi.mock("@/server/demo/store", () => ({
  demoStore: {
    analyticsPosts: mocks.analyticsPostsMock,
  },
}));

vi.mock("@/server/services/analytics-reporting.service", () => ({
  listLatestAnalyticsPostsPage: mocks.listLatestAnalyticsPostsPageMock,
}));

import { GET } from "@/app/api/analytics/posts/route";

describe("analytics posts route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoModeMock.mockReturnValue(false);
  });

  it("delegates latest-post pagination to the reporting service", async () => {
    mocks.listLatestAnalyticsPostsPageMock.mockResolvedValue({
      data: [
        {
          id: "snap-3",
          publishing_queue_id: "queue-2",
          ig_media_id: "ig-2",
          impressions: 410,
          reach: 220,
          views: 520,
          engagement_rate: 20,
          share_rate: 3.1,
          save_rate: 2.7,
          likes_count: 120,
          comments_count: 14,
          saves_count: 18,
          shares_count: 16,
          replies_count: 0,
          avg_watch_time_ms: 6400,
          post_type: "reel",
          scheduled_at: "2026-03-11T17:00:00.000Z",
          published_at: "2026-03-11T17:05:00.000Z",
          fetched_at: "2026-03-11T18:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-2", name: "Campaign Two" } } },
        },
        {
          id: "snap-2",
          publishing_queue_id: "queue-1",
          ig_media_id: "ig-1",
          impressions: 260,
          reach: 150,
          views: 320,
          engagement_rate: 10,
          share_rate: 1.9,
          save_rate: 1.4,
          likes_count: 80,
          comments_count: 6,
          saves_count: 9,
          shares_count: 7,
          replies_count: 0,
          avg_watch_time_ms: null,
          post_type: "feed",
          scheduled_at: "2026-03-11T07:00:00.000Z",
          published_at: "2026-03-11T07:10:00.000Z",
          fetched_at: "2026-03-11T08:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-1", name: "Campaign One" } } },
        },
      ],
      total: 2,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/analytics/posts?page=1&limit=50&sort_by=engagement_rate&start_date=2026-03-10T00:00:00.000Z&end_date=2026-03-11T23:59:59.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.listLatestAnalyticsPostsPageMock).toHaveBeenCalledWith({
      filters: {
        modelId: undefined,
        startDate: new Date("2026-03-10T00:00:00.000Z"),
        endDate: new Date("2026-03-11T23:59:59.000Z"),
      },
      sortBy: "engagement_rate",
      skip: 0,
      take: 50,
    });
    await expect(response.json()).resolves.toEqual({
      data: [
        {
          id: "snap-3",
          publishing_queue_id: "queue-2",
          ig_media_id: "ig-2",
          impressions: 410,
          reach: 220,
          views: 520,
          engagement_rate: 20,
          share_rate: 3.1,
          save_rate: 2.7,
          likes_count: 120,
          comments_count: 14,
          saves_count: 18,
          shares_count: 16,
          replies_count: 0,
          avg_watch_time_ms: 6400,
          post_type: "reel",
          scheduled_at: "2026-03-11T17:00:00.000Z",
          published_at: "2026-03-11T17:05:00.000Z",
          fetched_at: "2026-03-11T18:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-2", name: "Campaign Two" } } },
        },
        {
          id: "snap-2",
          publishing_queue_id: "queue-1",
          ig_media_id: "ig-1",
          impressions: 260,
          reach: 150,
          views: 320,
          engagement_rate: 10,
          share_rate: 1.9,
          save_rate: 1.4,
          likes_count: 80,
          comments_count: 6,
          saves_count: 9,
          shares_count: 7,
          replies_count: 0,
          avg_watch_time_ms: null,
          post_type: "feed",
          scheduled_at: "2026-03-11T07:00:00.000Z",
          published_at: "2026-03-11T07:10:00.000Z",
          fetched_at: "2026-03-11T08:00:00.000Z",
          queue: { asset: { campaign: { id: "campaign-1", name: "Campaign One" } } },
        },
      ],
      pagination: {
        page: 1,
        limit: 50,
        total: 2,
      },
    });
  });
});
