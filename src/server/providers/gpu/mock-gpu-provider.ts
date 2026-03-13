import { log } from "@/lib/logger";
import type { GpuGeneratePayload, GpuGenerateResponse, GpuProvider } from "./types";

export class MockGpuProvider implements GpuProvider {
  async generate(payload: GpuGeneratePayload): Promise<GpuGenerateResponse> {
    log({
      level: "info",
      service: "gpu",
      action: "mock.generate",
      entity_type: "generation_job",
      entity_id: payload.job_id,
      metadata: {
        batch_size: payload.generation_params.batch_size,
        resolution: `${payload.generation_params.width}x${payload.generation_params.height}`,
      },
    });

    return {
      job_id: payload.job_id,
      status: "accepted",
      estimated_time_ms: payload.generation_params.batch_size * 75_000,
    };
  }
}
