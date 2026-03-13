import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiImageProvider } from "@/server/providers/image/openai-image-provider";
import type { ImageGenerationRequest } from "@/server/providers/image/types";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_IMAGE_MODEL: "gpt-image-1",
  }),
}));

describe("openai-image-provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses image edits endpoint when image references are available", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const response = await provider.generate(
      createInput({
        references: [
          {
            url: sampleDataUrl(),
            weight: "primary",
            title: "face lock",
          },
        ],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/edits");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).getAll("image[]")).toHaveLength(1);
    expect((init.body as FormData).get("response_format")).toBeNull();

    expect(response.assets).toHaveLength(1);
    expect(response.provider_payload?.endpoint).toBe("images/edits");
    expect(response.provider_payload?.reference_images_used).toBe(1);
  });

  it("uses image generations endpoint when no references are provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "BBBB" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const response = await provider.generate(createInput({ references: [] }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/generations");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body.prompt).toContain("Character consistency lock");
    expect(body).not.toHaveProperty("response_format");

    expect(response.assets).toHaveLength(1);
    expect(response.provider_payload?.endpoint).toBe("images/generations");
  });

  it("retries edits without fidelity before falling back to generations", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ b64_json: "CCCC" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const response = await provider.generate(
      createInput({
        references: [{ url: sampleDataUrl(), weight: "primary" }],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/edits");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/images/edits");

    const firstBody = fetchMock.mock.calls[0]?.[1]?.body as FormData;
    const secondBody = fetchMock.mock.calls[1]?.[1]?.body as FormData;
    expect(firstBody.get("input_fidelity")).toBe("high");
    expect(secondBody.get("input_fidelity")).toBeNull();

    expect(response.assets).toHaveLength(1);
    expect(response.provider_payload?.endpoint).toBe("images/edits");
    expect(response.provider_payload?.input_fidelity).toBe("none");
    expect(response.provider_payload?.edit_fallback_status).toBe(400);
  });

  it("falls back to generations after both edit attempts fail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported high fidelity" } }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "unsupported edit request" } }), { status: 400 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ b64_json: "EEEE" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const response = await provider.generate(
      createInput({
        references: [{ url: sampleDataUrl(), weight: "primary" }],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/edits");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.openai.com/v1/images/edits");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://api.openai.com/v1/images/generations");

    expect(response.assets).toHaveLength(1);
    expect(response.provider_payload?.endpoint).toBe("images/generations");
    expect(response.provider_payload?.edit_fallback_status).toBe(400);
  });

  it("surfaces the OpenAI API error message when every attempt fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Unsupported parameter: 'response_format'. This parameter is not supported for this model.",
            },
          }),
          { status: 400, headers: { "x-request-id": "req_high" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "Too many reference images were supplied for edits.",
            },
          }),
          { status: 400, headers: { "x-request-id": "req_low" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message: "This request was blocked by the safety system.",
            },
          }),
          { status: 400, headers: { "x-request-id": "req_gen" } },
        ),
      );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();

    await expect(
      provider.generate(
        createInput({
          references: [{ url: sampleDataUrl(), weight: "primary" }],
        }),
      ),
    ).rejects.toMatchObject({
      message: "OpenAI image request failed: Unsupported parameter: 'response_format'. This parameter is not supported for this model.",
      details: expect.objectContaining({
        request_id: "req_gen",
        attempts: expect.arrayContaining([
          expect.objectContaining({
            endpoint: "images/edits",
            input_fidelity: "high",
            message: "Unsupported parameter: 'response_format'. This parameter is not supported for this model.",
          }),
          expect.objectContaining({
            endpoint: "images/edits",
            input_fidelity: "none",
            message: "Too many reference images were supplied for edits.",
          }),
          expect.objectContaining({
            endpoint: "images/generations",
            message: "This request was blocked by the safety system.",
          }),
        ]),
      }),
    });
  });

  it("ignores blocked private reference URLs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: "DDDD" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAiImageProvider();
    const response = await provider.generate(
      createInput({
        references: [{ url: "http://169.254.169.254/latest/meta-data", weight: "primary" }],
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.openai.com/v1/images/generations");
    expect(response.provider_payload?.reference_images_used).toBe(0);
  });
});

function createInput(overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest {
  return {
    job_id: "job-1",
    model_provider: "openai",
    model_id: "gpt-image-1",
    prompt_text: "Editorial portrait of the same model",
    negative_prompt: "",
    width: 1024,
    height: 1024,
    batch_size: 1,
    seeds: [42],
    upscale: true,
    output_path_prefix: "model/campaign/",
    callback: {
      url: "https://example.com/webhook",
      secret: "secret",
    },
    model_config: {
      base_model: "gpt-image-1",
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
