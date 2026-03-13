export type GpuGeneratePayload = {
  job_id: string;
  callback_url: string;
  callback_secret: string;
  model_config: {
    base_model: string;
    lora_url: string;
    lora_strength: number;
  };
  generation_params: {
    prompt: string;
    negative_prompt?: string;
    seed: number[];
    steps: number;
    cfg_scale: number;
    width: number;
    height: number;
    batch_size: number;
    scheduler: string;
  };
  controlnet?: {
    model: string;
    images: string[];
    strength: number;
  };
  upscale: {
    enabled: boolean;
    model: string;
    target_resolution: number;
  };
  output: {
    format: "webp" | "png";
    quality: number;
    bucket: string;
    path_prefix: string;
  };
};

export type GpuGenerateResponse = {
  job_id: string;
  status: "accepted";
  estimated_time_ms: number;
};

export type GpuProvider = {
  generate(payload: GpuGeneratePayload): Promise<GpuGenerateResponse>;
};
