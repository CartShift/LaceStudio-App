import { ApiError } from "@/lib/http";
import type { GpuProvider } from "@/server/providers/gpu/types";
import type { ImageGenerationRequest, ImageGenerationResponse, ImageProvider } from "./types";

export class GpuImageProvider implements ImageProvider {
  readonly provider = "gpu" as const;

  constructor(private readonly gpuProvider: GpuProvider) {}

  async generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    if (!input.callback) {
      throw new ApiError(500, "INTERNAL_ERROR", "GPU setup is incomplete for this request. Add callback settings and try again.");
    }

    const response = await this.gpuProvider.generate({
      job_id: input.job_id,
      callback_url: input.callback.url,
      callback_secret: input.callback.secret,
      model_config: {
        base_model: input.model_config.base_model,
        lora_url: input.model_config.lora_url ?? "",
        lora_strength: input.model_config.lora_strength ?? 0.8,
      },
      generation_params: {
        prompt: input.prompt_text,
        negative_prompt: input.negative_prompt,
        seed: input.seeds,
        steps: 30,
        cfg_scale: 7.5,
        width: input.width,
        height: input.height,
        batch_size: input.batch_size,
        scheduler: "DPM++ 2M Karras",
      },
      controlnet: input.controlnet,
      upscale: {
        enabled: input.upscale,
        model: "real-esrgan-4x",
        target_resolution: 2048,
      },
      output: {
        format: "webp",
        quality: 95,
        bucket: "lacestudio-campaign-raw-private",
        path_prefix: input.output_path_prefix,
      },
    });

    return {
      job_id: response.job_id,
      status: "accepted",
      estimated_time_ms: response.estimated_time_ms,
    };
  }
}
