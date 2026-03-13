export type InstagramAccountContext = {
  profileId?: string;
  accessToken: string;
  instagramUserId: string;
  graphApiVersion?: string;
  handle?: string | null;
};

export type InstagramMediaInput = {
  imageUrl?: string;
  videoUrl?: string;
  caption: string;
  postType: "feed" | "story" | "reel";
  shareToFeed?: boolean;
};

export type InstagramPublishInput = {
  containerId: string;
};

export type InstagramInsightsInput = {
  mediaId: string;
};

export type InstagramInsights = {
  impressions: number;
  reach: number;
  views: number;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  shares_count: number;
  replies_count: number;
  avg_watch_time_ms: number | null;
  total_watch_time_ms: number | null;
  profile_visits_count: number;
  follows_count: number;
  raw_metrics?: Record<string, number | null>;
};

export type InstagramProvider = {
  createMedia(account: InstagramAccountContext, input: InstagramMediaInput): Promise<{ containerId: string }>;
  publishMedia(account: InstagramAccountContext, input: InstagramPublishInput): Promise<{ mediaId: string }>;
  fetchInsights(account: InstagramAccountContext, input: InstagramInsightsInput): Promise<InstagramInsights>;
};
