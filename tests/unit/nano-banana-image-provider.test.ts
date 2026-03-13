import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NanoBananaImageProvider } from "@/server/providers/image/nano-banana-image-provider";
import type { ImageGenerationRequest } from "@/server/providers/image/types";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";

const env = {
  NANO_BANANA_API_URL: "https://generativelanguage.googleapis.com/v1beta/models",
  NANO_BANANA_API_KEY: "test-nano-key",
  NANO_BANANA_MODEL: "nano-banana-2",
};

vi.mock("@/lib/env", () => ({
  getEnv: () => env,
}));

describe("nano-banana-image-provider", () => {
  beforeEach(() => {
    env.NANO_BANANA_API_URL = "https://generativelanguage.googleapis.com/v1beta/models";
    env.NANO_BANANA_API_KEY = "test-nano-key";
    env.NANO_BANANA_MODEL = "nano-banana-2";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses Gemini generateContent endpoint with x-goog-api-key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "AAAA",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new NanoBananaImageProvider();
    const response = await provider.generate(
      createInput({
        references: [{ url: sampleDataUrl(), weight: "primary" }],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-nano-key");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();

    const body = JSON.parse(String(init.body));
    expect(body.contents?.[0]?.parts?.some((part: Record<string, unknown>) => "inline_data" in part)).toBe(true);
    expect(body.generationConfig?.responseModalities).toEqual(["IMAGE"]);
    expect(body.generationConfig?.imageConfig?.imageSize).toBe("1K");
    expect(body.generationConfig?.thinkingConfig?.thinkingLevel).toBe("minimal");

    expect(response.assets).toHaveLength(1);
    expect(response.assets?.[0]?.uri).toBe("data:image/png;base64,AAAA");
    expect(response.provider_payload?.backend).toBe("gemini");
  });

  it("uses gateway /generate endpoint with bearer auth when URL is non-Google", async () => {
    env.NANO_BANANA_API_URL = "https://nano.gateway.local";
    env.NANO_BANANA_MODEL = "nano-banana-2";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          assets: [{ url: "https://cdn.example.com/generated.png", seed: 77 }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new NanoBananaImageProvider();
    const response = await provider.generate(createInput({ references: [] }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://nano.gateway.local/generate");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-nano-key");

    expect(response.assets).toHaveLength(1);
    expect(response.provider_payload?.backend).toBe("gateway");
  });

  it("skips blocked private reference URLs for Gemini generation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "EEEE",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new NanoBananaImageProvider();
    const response = await provider.generate(
      createInput({
        references: [{ url: "http://169.254.169.254/latest/meta-data", weight: "primary" }],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    const hasInlineReference = body.contents?.[0]?.parts?.some((part: Record<string, unknown>) => "inline_data" in part);
    expect(hasInlineReference).toBe(false);
    expect(response.provider_payload?.reference_images_used).toBe(0);
  });

  it("applies gemini-2.5 limits and omits unsupported config fields", async () => {
    env.NANO_BANANA_MODEL = "nano-banana";

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "image/png",
                      data: "BBBB",
                    },
                  },
                ],
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new NanoBananaImageProvider();
    const response = await provider.generate(
      createInput({
        model_id: "nano-banana",
        references: [
          { url: sampleDataUrl(), weight: "primary", title: "Model Identity frontal" },
          { url: sampleDataUrl(), weight: "secondary", title: "Model Identity left45" },
          { url: sampleDataUrl(), weight: "secondary", title: "Model Identity right45" },
          { url: sampleDataUrl(), weight: "secondary", title: "Campaign board outfit" },
          { url: sampleDataUrl(), weight: "secondary", title: "Campaign board location" },
        ],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent",
    );

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    const parts = body.contents?.[0]?.parts ?? [];
    const inlineReferenceCount = parts.filter((part: Record<string, unknown>) => "inline_data" in part).length;

    expect(inlineReferenceCount).toBe(3);
    expect(body.generationConfig?.responseModalities).toEqual(["IMAGE"]);
    expect(body.generationConfig?.imageConfig?.aspectRatio).toBe("1:1");
    expect(body.generationConfig?.imageConfig?.imageSize).toBeUndefined();
    expect(body.generationConfig?.thinkingConfig).toBeUndefined();

    expect(response.provider_payload?.reference_images_attempted).toBe(3);
    expect(response.provider_payload?.reference_images_dropped).toBe(2);
    expect(response.provider_payload?.image_size).toBeNull();
  });
});

function createInput(overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest {
  return {
    job_id: "job-nano-1",
    model_provider: "nano_banana_2",
    model_id: "nano-banana-2",
    prompt_text: "Editorial portrait of the same model",
    negative_prompt: "blurry, low quality",
    width: 1024,
    height: 1024,
    batch_size: 1,
    seeds: [42],
    upscale: false,
    output_path_prefix: "model/campaign/",
    callback: {
      url: "https://example.com/webhook",
      secret: "secret",
    },
    model_config: {
      base_model: "nano-banana-2",
    },
    controlnet: undefined,
    creative_controls: createDefaultCreativeControls(),
    references: [],
    ...overrides,
  };
}

function sampleDataUrl(): string {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+6m0AAAAASUVORK5CYII=";
  return `data:image/png;base64,${pngBase64}`;
}
