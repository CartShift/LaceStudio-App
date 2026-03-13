export type VideoGenerationStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

export type GenerateVideoInput = {
  imageUrl: string;
  prompt: string;
  aspectRatio: "9:16";
  durationSeconds: number;
};

export type VideoGenerationResult = {
  providerJobId: string;
  status: VideoGenerationStatus;
  outputUrl?: string | null;
  previewImageUrl?: string | null;
  metadata?: Record<string, unknown> | null;
  errorMessage?: string | null;
};

export type VideoGenerationProvider = {
  createVideo(input: GenerateVideoInput): Promise<VideoGenerationResult>;
  getJob(providerJobId: string): Promise<VideoGenerationResult>;
};
