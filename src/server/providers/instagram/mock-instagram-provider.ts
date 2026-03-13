import { randomUUID } from "node:crypto";
import type {
  InstagramAccountContext,
  InstagramInsights,
  InstagramInsightsInput,
  InstagramMediaInput,
  InstagramProvider,
  InstagramPublishInput,
} from "./types";

export class MockInstagramProvider implements InstagramProvider {
  async createMedia(account: InstagramAccountContext, _input: InstagramMediaInput): Promise<{ containerId: string }> {
    void account;
    void _input;
    return { containerId: `mock_container_${randomUUID()}` };
  }

  async publishMedia(account: InstagramAccountContext, _input: InstagramPublishInput): Promise<{ mediaId: string }> {
    void account;
    void _input;
    return { mediaId: `mock_media_${randomUUID()}` };
  }

  async fetchInsights(account: InstagramAccountContext, _input: InstagramInsightsInput): Promise<InstagramInsights> {
    void _input;
    const boost = (account.profileId ?? account.instagramUserId).length;
    return {
      impressions: 12_500 + boost * 3,
      reach: 10_400 + boost * 2,
      views: 18_200 + boost * 4,
      likes_count: 460 + boost,
      comments_count: 39 + Math.floor(boost / 2),
      saves_count: 88 + Math.floor(boost / 3),
      shares_count: 54 + Math.floor(boost / 4),
      replies_count: 16 + Math.floor(boost / 5),
      avg_watch_time_ms: 4_300 + boost * 10,
      total_watch_time_ms: 81_000 + boost * 100,
      profile_visits_count: 26 + Math.floor(boost / 4),
      follows_count: 8 + Math.floor(boost / 6),
      raw_metrics: {
        impressions: 12_500 + boost * 3,
        reach: 10_400 + boost * 2,
        views: 18_200 + boost * 4,
      },
    };
  }
}
