export type InstagramAccountContext = {
  profileId?: string;
  accessToken: string;
  instagramUserId: string;
  graphApiVersion?: string;
  handle?: string | null;
};

export type InstagramMediaInput = {
  imageUrl: string;
  caption: string;
  postType: "feed" | "story" | "reel";
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
  likes_count: number;
  comments_count: number;
  saves_count: number;
  shares_count: number;
};

export type InstagramProvider = {
  createMedia(account: InstagramAccountContext, input: InstagramMediaInput): Promise<{ containerId: string }>;
  publishMedia(account: InstagramAccountContext, input: InstagramPublishInput): Promise<{ mediaId: string }>;
  fetchInsights(account: InstagramAccountContext, input: InstagramInsightsInput): Promise<InstagramInsights>;
};
