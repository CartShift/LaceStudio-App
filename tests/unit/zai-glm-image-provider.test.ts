import { afterEach, describe, expect, it, vi } from "vitest";
import { ZaiGlmImageProvider } from "@/server/providers/image/zai-glm-image-provider";
import type { ImageGenerationRequest } from "@/server/providers/image/types";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";

vi.mock("@/lib/env", () => ({
	getEnv: () => ({
		ZAI_API_BASE_URL: "https://api.z.ai/api/paas/v4",
		ZAI_API_KEY: "test-zai-key",
		ZAI_IMAGE_MODEL: "glm-image",
	}),
}));

describe("zai-glm-image-provider", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("uses image generations endpoint with textual reference context", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [{ b64_json: "AAAA" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		vi.stubGlobal("fetch", fetchMock);

		const provider = new ZaiGlmImageProvider();
		const response = await provider.generate(
			createInput({
				references: [{ url: sampleDataUrl(), weight: "primary", title: "identity lock" }],
			}),
		);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.z.ai/api/paas/v4/images/generations");
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(String(init.body));
		expect(body.quality).toBe("hd");
		expect(String(body.prompt)).toContain("Reference context");
		expect(response.assets).toHaveLength(1);
		expect(response.provider_payload?.endpoint).toBe("https://api.z.ai/api/paas/v4/images/generations");
	});

	it("generates one request per batch item", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ b64_json: "BBBB" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ data: [{ b64_json: "CCCC" }] }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
			);

		vi.stubGlobal("fetch", fetchMock);

		const provider = new ZaiGlmImageProvider();
		const response = await provider.generate(createInput({ batch_size: 2, seeds: [11, 22], references: [] }));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.z.ai/api/paas/v4/images/generations");
		expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.z.ai/api/paas/v4/images/generations");
		expect(response.assets).toHaveLength(2);
		expect(response.assets?.[0]?.seed).toBe(11);
		expect(response.assets?.[1]?.seed).toBe(22);
	});

	it("uses standard quality for non-glm image models", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [{ b64_json: "DDDD" }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			}),
		);

		vi.stubGlobal("fetch", fetchMock);

		const provider = new ZaiGlmImageProvider();
		await provider.generate(createInput({ model_id: "cogview-4-250304", references: [] }));

		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		const body = JSON.parse(String(init.body));
		expect(body.quality).toBe("standard");
	});
});

function createInput(overrides?: Partial<ImageGenerationRequest>): ImageGenerationRequest {
	return {
		job_id: "job-zai-1",
		model_provider: "zai_glm",
		model_id: "glm-image",
		prompt_text: "Editorial portrait of the same model",
		negative_prompt: "",
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
			base_model: "glm-image",
		},
		controlnet: undefined,
		creative_controls: createDefaultCreativeControls(),
		references: [],
		...overrides,
	};
}

function sampleDataUrl(): string {
	const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+6m0AAAAASUVORK5CYII=";
	return `data:image/png;base64,${pngBase64}`;
}
