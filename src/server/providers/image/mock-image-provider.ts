import type { ImageModelProvider } from "@/server/schemas/creative";
import type { ImageGenerationAsset, ImageGenerationRequest, ImageGenerationResponse, ImageProvider } from "./types";

export class MockImageProvider implements ImageProvider {
  constructor(public readonly provider: ImageModelProvider) {}

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const assets: ImageGenerationAsset[] = [];

    for (let index = 0; index < input.batch_size; index += 1) {
      const sequence = index + 1;
      assets.push({
        uri: `gs://lacestudio-campaign-raw-private/${input.output_path_prefix}asset_${sequence}.webp`,
        seed: input.seeds[index] ?? input.seeds[0] ?? 42,
        width: input.width,
        height: input.height,
        generation_time_ms: 10_000 + index * 500,
        provider_metadata: {
          provider: this.provider,
          model_id: input.model_id ?? "mock-model",
        },
      });
    }

    return {
      job_id: input.job_id,
      status: "completed",
      estimated_time_ms: assets.reduce((total, asset) => total + asset.generation_time_ms, 0),
      assets,
      provider_payload: {
        mock: true,
        provider: this.provider,
      },
    };
  }
}
