export type PromptEmbeddingJob = {
  idempotencyKey: string;
  assetId: string;
  campaignId: string;
  modelId: string;
  promptText: string;
};

export type PublishDueJob = {
  idempotencyKey: string;
  publishingQueueId: string;
  scheduledAt: string;
};

export type AnalyticsIngestJob = {
  idempotencyKey: string;
  publishingQueueId: string;
  mediaId: string;
  fetchedAt: string;
};
