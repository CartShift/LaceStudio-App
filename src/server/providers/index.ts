import { getEnv } from "@/lib/env";
import { LiveGpuProvider } from "@/server/providers/gpu/live-gpu-provider";
import { MockGpuProvider } from "@/server/providers/gpu/mock-gpu-provider";
import type { GpuProvider } from "@/server/providers/gpu/types";
import { GpuImageProvider } from "@/server/providers/image/gpu-image-provider";
import { MockImageProvider } from "@/server/providers/image/mock-image-provider";
import { NanoBananaImageProvider } from "@/server/providers/image/nano-banana-image-provider";
import { OpenAiImageProvider } from "@/server/providers/image/openai-image-provider";
import { ZaiGlmImageProvider } from "@/server/providers/image/zai-glm-image-provider";
import type { ImageProvider } from "@/server/providers/image/types";
import { LiveInstagramProvider } from "@/server/providers/instagram/live-instagram-provider";
import { MockInstagramProvider } from "@/server/providers/instagram/mock-instagram-provider";
import type { InstagramProvider } from "@/server/providers/instagram/types";
import type { ImageModelProvider } from "@/server/schemas/creative";

export function getGpuProvider(): GpuProvider {
  const env = getEnv();
  return env.GPU_PROVIDER_MODE === "live" ? new LiveGpuProvider() : new MockGpuProvider();
}

export function getImageProvider(provider: ImageModelProvider): ImageProvider {
  const env = getEnv();

  if (provider === "openai") {
    return new OpenAiImageProvider();
  }

  if (provider === "nano_banana_2") {
    return new NanoBananaImageProvider();
  }

  if (provider === "zai_glm") {
    return new ZaiGlmImageProvider();
  }

  if (env.GPU_PROVIDER_MODE === "mock") {
    return new MockImageProvider("gpu");
  }

  return new GpuImageProvider(getGpuProvider());
}

export function getInstagramProvider(): InstagramProvider {
  const env = getEnv();
  return env.INSTAGRAM_PROVIDER_MODE === "live"
    ? new LiveInstagramProvider()
    : new MockInstagramProvider();
}
