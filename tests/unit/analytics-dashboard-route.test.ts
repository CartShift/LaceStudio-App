import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSessionContextMock: vi.fn(async () => ({ role: "admin", userId: "admin-1" })),
  assertRoleMock: vi.fn(),
  isDemoModeMock: vi.fn(() => false),
  analyticsDashboardMock: vi.fn(),
  getAnalyticsDashboardDataMock: vi.fn(),
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
    analyticsDashboard: mocks.analyticsDashboardMock,
  },
}));

vi.mock("@/server/services/analytics-reporting.service", () => ({
  getAnalyticsDashboardData: mocks.getAnalyticsDashboardDataMock,
}));

import { GET } from "@/app/api/analytics/dashboard/route";

describe("analytics dashboard route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isDemoModeMock.mockReturnValue(false);
  });

  it("delegates analytics aggregation to the reporting service", async () => {
    mocks.getAnalyticsDashboardDataMock.mockResolvedValue({
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

    const response = await GET(
      new Request(
        "http://localhost/api/analytics/dashboard?start_date=2026-03-10T00:00:00.000Z&end_date=2026-03-11T23:59:59.000Z",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.getAnalyticsDashboardDataMock).toHaveBeenCalledWith({
      modelId: undefined,
      startDate: new Date("2026-03-10T00:00:00.000Z"),
      endDate: new Date("2026-03-11T23:59:59.000Z"),
    });
    await expect(response.json()).resolves.toEqual({
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
