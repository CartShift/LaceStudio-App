import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/http";
import { LiveGpuProvider } from "@/server/providers/gpu/live-gpu-provider";
import type { GpuGeneratePayload } from "@/server/providers/gpu/types";

vi.mock("@/lib/env", () => ({
	getEnv: () => ({
		GPU_SERVICE_URL: "https://gpu.internal",
		GPU_API_KEY: "gpu-test-key"
	})
}));

describe("live-gpu-provider", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("posts to the GPU generate endpoint with bearer auth", async () => {
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					job_id: "job-1",
					status: "accepted",
					estimated_time_ms: 42000
				}),
				{ status: 200, headers: { "content-type": "application/json" } }
			)
		);
		vi.stubGlobal("fetch", fetchMock);

		const provider = new LiveGpuProvider();
		const response = await provider.generate(createPayload());

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gpu.internal/generate");
		const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer gpu-test-key");
		expect(response.status).toBe("accepted");
		expect(response.job_id).toBe("job-1");
	});

	it("retries transient GPU failures before succeeding", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(new Response(JSON.stringify({ error: "busy" }), { status: 503 }))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						job_id: "job-2",
						status: "accepted",
						estimated_time_ms: 35000
					}),
					{ status: 200, headers: { "content-type": "application/json" } }
				)
			);
		vi.stubGlobal("fetch", fetchMock);

		const provider = new LiveGpuProvider();
		const response = await provider.generate(createPayload());

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(response.job_id).toBe("job-2");
	});

	it("throws ApiError on non-retryable GPU failure", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "bad request" }), { status: 400 }));
		vi.stubGlobal("fetch", fetchMock);

		const provider = new LiveGpuProvider();
		await expect(provider.generate(createPayload())).rejects.toBeInstanceOf(ApiError);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

function createPayload(): GpuGeneratePayload {
	return {
		job_id: "job-test",
		callback_url: "https://example.com/webhook",
		callback_secret: "secret",
		model_config: {
			base_model: "sdxl-1.0",
			lora_url: "",
			lora_strength: 0.8
		},
		generation_params: {
			prompt: "fashion portrait",
			negative_prompt: "",
			seed: [42],
			steps: 30,
			cfg_scale: 7.5,
			width: 1024,
			height: 1024,
			batch_size: 1,
			scheduler: "DPM++ 2M Karras"
		},
		upscale: {
			enabled: false,
			model: "real-esrgan-4x",
			target_resolution: 2048
		},
		output: {
			format: "webp",
			quality: 95,
			bucket: "lacestudio-campaign-raw-private",
			path_prefix: "model/campaign/"
		}
	};
}
