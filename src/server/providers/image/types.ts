import type { CreativeControls, ImageModelProvider } from "@/server/schemas/creative";

export type ImageReferenceInput = {
  url: string;
  source?: "pinterest_upload" | "pinterest_url" | "external_url";
  title?: string;
  weight: "primary" | "secondary";
  similarity_score?: number;
};

export type ImageGenerationRequest = {
  job_id: string;
  model_provider: ImageModelProvider;
  model_id?: string;
  prompt_text: string;
  negative_prompt?: string;
  width: number;
  height: number;
  batch_size: number;
  seeds: number[];
  upscale: boolean;
  output_path_prefix: string;
  callback?: {
    url: string;
    secret: string;
  };
  model_config: {
    base_model: string;
    lora_url?: string;
    lora_strength?: number;
  };
  controlnet?: {
    model: string;
    images: string[];
    strength: number;
  };
  creative_controls: CreativeControls;
  references: ImageReferenceInput[];
};

export type ImageGenerationAsset = {
  uri: string;
  seed: number;
  width: number;
  height: number;
  generation_time_ms: number;
  provider_metadata?: Record<string, unknown>;
};

export type ImageGenerationResponse = {
  job_id: string;
  status: "accepted" | "completed";
  estimated_time_ms?: number;
  assets?: ImageGenerationAsset[];
  provider_payload?: Record<string, unknown>;
};

export type ImageProvider = {
  provider: ImageModelProvider;
  generate(input: ImageGenerationRequest): Promise<ImageGenerationResponse>;
};
