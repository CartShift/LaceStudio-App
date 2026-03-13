import { randomUUID } from "node:crypto";
import type { GenerateVideoInput, VideoGenerationProvider, VideoGenerationResult } from "./types";

const jobs = new Map<string, VideoGenerationResult>();

export class MockVideoGenerationProvider implements VideoGenerationProvider {
  async createVideo(input: GenerateVideoInput): Promise<VideoGenerationResult> {
    const providerJobId = `mock_video_${randomUUID()}`;
    const result: VideoGenerationResult = {
      providerJobId,
      status: "PROCESSING",
      metadata: {
        prompt: input.prompt,
        aspect_ratio: input.aspectRatio,
        duration_seconds: input.durationSeconds,
      },
    };

    jobs.set(providerJobId, {
      ...result,
      status: "COMPLETED",
      outputUrl: `https://cdn.example.com/generated/${providerJobId}.mp4`,
      previewImageUrl: `https://cdn.example.com/generated/${providerJobId}.jpg`,
    });

    return result;
  }

  async getJob(providerJobId: string): Promise<VideoGenerationResult> {
    return (
      jobs.get(providerJobId) ?? {
        providerJobId,
        status: "FAILED",
        errorMessage: "Mock video job was not found.",
      }
    );
  }
}
