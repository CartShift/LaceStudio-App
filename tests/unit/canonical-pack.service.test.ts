import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildCanonicalShotProviderOrder,
	buildAllFailedCanonicalErrorMessage,
	getCanonicalPackSummary,
	resolveCanonicalGenerationProviderSelection,
	startCanonicalPackGeneration
} from "@/server/services/canonical-pack.service";

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		aiModel: {
			findUnique: vi.fn(),
			update: vi.fn(),
			updateMany: vi.fn()
		},
		modelReferenceCandidate: {
			aggregate: vi.fn(),
			findMany: vi.fn()
		}
	}
}));

vi.mock("@/lib/prisma", () => ({
	prisma: prismaMock
}));

vi.mock("@/server/services/storage/gcs-storage", () => ({
	createSignedReadUrlForGcsUri: vi.fn(async (uri: string) => uri),
	uploadImageFromUriToModelBucket: vi.fn(async ({ sourceUri }: { sourceUri: string }) => sourceUri)
}));

vi.mock("@/server/providers", () => ({
	getImageProvider: vi.fn(() => ({
		generate: vi.fn(async () => ({
			status: "completed",
			assets: []
		}))
	}))
}));

vi.mock("@/server/services/canonical-qa.service", () => ({
	scoreCanonicalCandidate: vi.fn(async () => ({
		realism_score: 0.8,
		clarity_score: 0.8,
		consistency_score: 0.8,
		composite_score: 0.8,
		qa_notes: "ok",
		source: "heuristic"
	}))
}));

vi.mock("@/lib/env", () => ({
	getEnv: () => ({
		OPENAI_IMAGE_MODEL: "gpt-image-1",
		NANO_BANANA_MODEL: "gemini-3.1-flash-image-preview"
	})
}));

describe("canonical-pack.service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns active job details when canonical generation is already running", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			name: "Ava Prime",
			body_profile: {},
			face_profile: {},
			onboarding_state: {
				canonical_pack_generation: {
					job_id: "job-active",
					pack_version: 3,
					heartbeat_at: new Date().toISOString()
				}
			},
			canonical_pack_status: "GENERATING",
			active_canonical_pack_version: 2,
			updated_at: new Date().toISOString(),
			canonical_references: [],
			model_versions: [{ id: "v1" }]
		});

		await expect(
			startCanonicalPackGeneration({
				modelId: "model-1",
				initiatedBy: "admin-1",
				provider: "openai",
				candidatesPerShot: 2
			})
		).resolves.toMatchObject({
			job_id: "job-active",
			pack_version: 3
		});
	});

	it("defaults summary to in-flight pack version and progress", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			canonical_pack_status: "GENERATING",
			active_canonical_pack_version: 2,
			onboarding_state: {
				canonical_pack_generation: {
					pack_version: 4,
					completed_shots: 5,
					total_shots: 8
				}
			}
		});
		prismaMock.modelReferenceCandidate.aggregate.mockResolvedValue({
			_max: { pack_version: 3 }
		});
		prismaMock.modelReferenceCandidate.findMany.mockResolvedValue([
			{
				id: "cand-1",
				model_id: "model-1",
				pack_version: 4,
				shot_code: "frontal_closeup",
				candidate_index: 1,
				image_gcs_uri: "https://cdn.example.com/cand-1.png",
				composite_score: "0.91"
			}
		]);

		const summary = await getCanonicalPackSummary({ modelId: "model-1" });

		expect(summary.pack_version).toBe(4);
		expect(summary.progress?.completed_shots).toBe(5);
		expect(summary.progress?.total_shots).toBe(8);
		expect(summary.shots).toHaveLength(8);
	});

	it("marks stale generating state as failed when reading summary", async () => {
		const staleHeartbeat = new Date(Date.now() - 25 * 60 * 1000).toISOString();
		prismaMock.aiModel.findUnique.mockResolvedValue({
			canonical_pack_status: "GENERATING",
			active_canonical_pack_version: 0,
			onboarding_state: {
				canonical_pack_generation: {
					job_id: "job-stale",
					pack_version: 1,
					heartbeat_at: staleHeartbeat,
					completed_shots: 0,
					total_shots: 1,
					failed_shots: 0,
					shot_codes: ["frontal_closeup"],
					generation_mode: "front_only"
				}
			}
		});
		prismaMock.aiModel.updateMany.mockResolvedValue({ count: 1 });
		prismaMock.modelReferenceCandidate.aggregate.mockResolvedValue({
			_max: { pack_version: 0 }
		});
		prismaMock.modelReferenceCandidate.findMany.mockResolvedValue([]);

		const summary = await getCanonicalPackSummary({ modelId: "model-1" });

		expect(prismaMock.aiModel.updateMany).toHaveBeenCalledTimes(1);
		expect(summary.status).toBe("FAILED");
		expect(summary.error).toContain("timed out");
	});

	it("rejects when generation is active but no reusable job metadata exists", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			name: "Ava Prime",
			body_profile: {},
			face_profile: {},
			onboarding_state: {},
			canonical_pack_status: "GENERATING",
			active_canonical_pack_version: 2,
			updated_at: new Date().toISOString(),
			canonical_references: [],
			source_references: [],
			model_versions: [{ id: "v1" }]
		});

		await expect(
			startCanonicalPackGeneration({
				modelId: "model-1",
				initiatedBy: "admin-1",
				provider: "openai",
				candidatesPerShot: 2
			})
		).rejects.toMatchObject({
			status: 409,
			code: "CONFLICT"
		});
	});

	it("defaults summary to latest candidate pack when no generation metadata exists", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			canonical_pack_status: "READY",
			active_canonical_pack_version: 1,
			onboarding_state: {}
		});
		prismaMock.modelReferenceCandidate.aggregate.mockResolvedValue({
			_max: { pack_version: 6 }
		});
		prismaMock.modelReferenceCandidate.findMany.mockResolvedValue([]);

		const summary = await getCanonicalPackSummary({ modelId: "model-1" });

		expect(summary.pack_version).toBe(6);
		expect(summary.progress?.generated_candidates).toBe(0);
	});

	it("allows canonical generation to start without any accepted references", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			name: "Ava Prime",
			body_profile: {},
			face_profile: {},
			onboarding_state: {},
			canonical_pack_status: "NOT_STARTED",
			active_canonical_pack_version: 0,
			updated_at: new Date().toISOString(),
			canonical_references: [],
			source_references: [],
			model_versions: [{ id: "v1" }]
		});
		prismaMock.modelReferenceCandidate.aggregate.mockResolvedValue({
			_max: { pack_version: 0 }
		});
		prismaMock.aiModel.updateMany.mockResolvedValue({ count: 1 });

		await expect(
			startCanonicalPackGeneration({
				modelId: "model-1",
				initiatedBy: "admin-1",
				provider: "openai",
				candidatesPerShot: 1
			})
		).resolves.toMatchObject({
			pack_version: 1
		});
	});

	it("reroutes zai glm canonical generation to nano when identity references are present", () => {
		expect(
			resolveCanonicalGenerationProviderSelection({
				requestedProvider: "zai_glm",
				requestedModelId: "glm-image",
				conditioningReferenceCount: 4
			})
		).toEqual({
			provider: "nano_banana_2"
		});
	});

	it("preserves the requested provider and model id when the provider supports conditioning", () => {
		expect(
			resolveCanonicalGenerationProviderSelection({
				requestedProvider: "openai",
				requestedModelId: "gpt-image-1",
				conditioningReferenceCount: 4
			})
		).toEqual({
			provider: "openai",
			providerModelId: "gpt-image-1"
		});
	});

	it("preserves shot-level failures when every angle fails", () => {
		expect(
			buildAllFailedCanonicalErrorMessage({
				completedShots: 0,
				totalShots: 1,
				shotErrors: ["Shot frontal_closeup: provider timeout"]
			})
		).toContain("Shot frontal_closeup: provider timeout");
	});

	it("falls back from nano to openai for reference-conditioned canonical shots", () => {
		expect(
			buildCanonicalShotProviderOrder({
				requestedProvider: "nano_banana_2",
				referenceCount: 4
			})
		).toEqual(["nano_banana_2", "openai"]);
	});
});
