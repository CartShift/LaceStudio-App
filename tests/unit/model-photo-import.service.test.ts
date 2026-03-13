import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, startCanonicalPackGenerationMock } = vi.hoisted(() => ({
	prismaMock: {
		aiModel: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
		modelSourceReference: {
			aggregate: vi.fn(),
			count: vi.fn(),
			create: vi.fn(),
			findMany: vi.fn(),
			update: vi.fn(),
		},
		canonicalReference: {
			count: vi.fn(),
		},
		$transaction: vi.fn(),
	},
	startCanonicalPackGenerationMock: vi.fn(async () => ({ job_id: "job-1", pack_version: 1 })),
}));

vi.mock("@/lib/prisma", () => ({
	prisma: prismaMock,
}));

vi.mock("@/server/services/storage/gcs-storage", () => ({
	uploadImageFromUriToModelBucket: vi.fn(async () => "gs://bucket/path.png"),
	createSignedReadUrlForGcsUri: vi.fn(async (uri: string) => uri),
}));

vi.mock("@/server/services/canonical-pack.service", () => ({
	startCanonicalPackGeneration: startCanonicalPackGenerationMock,
}));

vi.mock("@/server/services/model-photo-import-vision.service", () => ({
	analyzeModelPhotosWithVision: vi.fn(async () => ({
		provider: "heuristic",
		suggestion: {
			character_design: {
				body_profile: {
					height_cm: 170,
					build: "athletic",
					skin_tone: "olive",
					hair_color: "brown",
					hair_length: "long",
					hair_style: "waves",
					eye_color: "brown",
					distinguishing_features: [],
					advanced_traits: {
						shoulder_width: "balanced",
					},
				},
				face_profile: {
					face_shape: "oval",
					jawline: "defined",
					nose_profile: "straight",
					lip_profile: "balanced",
					brow_profile: "soft_arch",
					eye_spacing: "balanced",
					eye_shape: "almond",
					forehead_height: "balanced",
					cheekbones: "defined",
					advanced_traits: {},
				},
				imperfection_fingerprint: [],
			},
			personality: {
				social_voice: "warm",
				temperament: "confident",
				interests: ["fashion"],
				boundaries: ["No explicit"],
				communication_style: {
					caption_tone: "aspirational",
					emoji_usage: "minimal",
					language_style: "balanced",
				},
			},
			social_strategy: {
				reality_like_daily: {
					enabled: true,
					style_brief: "daily",
					target_ratio_percent: 60,
					weekly_post_goal: 3,
				},
				fashion_editorial: {
					enabled: true,
					style_brief: "editorial",
					target_ratio_percent: 40,
					weekly_post_goal: 2,
				},
			},
			confidence: {
				character_design: 0.4,
				personality: 0.4,
				social_strategy: 0.4,
			},
			warnings: [],
			image_reviews: [],
		},
	})),
}));

import {
	applyModelPhotoImportSuggestion,
	getModelPhotoImportSnapshot,
	reanalyzeModelPhotoImport,
	startModelPhotoImport,
} from "@/server/services/model-photo-import.service";

describe("model-photo-import.service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("applies suggestion even when explicitly requested canonical generation fails", async () => {
		startCanonicalPackGenerationMock.mockRejectedValueOnce(new Error("provider unavailable"));

		prismaMock.aiModel.findUnique.mockResolvedValue({
			id: "model-1",
			status: "DRAFT",
			body_profile: null,
			face_profile: null,
			active_canonical_pack_version: 0,
			canonical_pack_status: "NOT_STARTED",
			onboarding_state: {
				photo_import: {
					status: "READY",
					auto_generate_on_apply: true,
					latest_suggestion: {
						character_design: {
							body_profile: {
								height_cm: 170,
								build: "athletic",
								skin_tone: "olive",
								hair_color: "brown",
								hair_length: "long",
								hair_style: "waves",
								eye_color: "brown",
								distinguishing_features: [],
								advanced_traits: { shoulder_width: "balanced" },
							},
							face_profile: {
								face_shape: "oval",
								jawline: "defined",
								nose_profile: "straight",
								lip_profile: "balanced",
								brow_profile: "soft_arch",
								eye_spacing: "balanced",
								eye_shape: "almond",
								forehead_height: "balanced",
								cheekbones: "defined",
								advanced_traits: {},
							},
							imperfection_fingerprint: [],
						},
						personality: {
							social_voice: "warm",
							temperament: "confident",
							interests: ["fashion"],
							boundaries: ["No explicit"],
							communication_style: {
								caption_tone: "aspirational",
								emoji_usage: "minimal",
								language_style: "balanced",
							},
						},
						social_strategy: {
							reality_like_daily: {
								enabled: true,
								style_brief: "daily",
								target_ratio_percent: 60,
								weekly_post_goal: 3,
							},
							fashion_editorial: {
								enabled: true,
								style_brief: "editorial",
								target_ratio_percent: 40,
								weekly_post_goal: 2,
							},
						},
						confidence: {
							character_design: 0.4,
							personality: 0.4,
							social_strategy: 0.4,
						},
						warnings: [],
						image_reviews: [],
					},
				},
			},
		});
		prismaMock.canonicalReference.count.mockResolvedValue(0);
		prismaMock.modelSourceReference.count.mockResolvedValue(3);
		prismaMock.aiModel.update.mockResolvedValue({ id: "model-1" });

		const result = await applyModelPhotoImportSuggestion({
			modelId: "model-1",
			appliedBy: "user-1",
			startCanonicalGeneration: true,
		});

		expect(result.applied).toBe(true);
		expect(result.canonical_job).toBeUndefined();
		expect(result.canonical_warning).toContain("could not start");
		expect(prismaMock.aiModel.update).toHaveBeenCalledTimes(1);
	});

	it("applies all model sections even if a partial section list is requested", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			id: "model-1",
			status: "DRAFT",
			body_profile: null,
			face_profile: null,
			active_canonical_pack_version: 0,
			canonical_pack_status: "NOT_STARTED",
			onboarding_state: {
				photo_import: {
					status: "READY",
					auto_generate_on_apply: true,
					latest_suggestion: {
						character_design: {
							body_profile: {
								height_cm: 170,
								build: "athletic",
								skin_tone: "olive",
								hair_color: "brown",
								hair_length: "long",
								hair_style: "waves",
								eye_color: "brown",
								distinguishing_features: [],
								advanced_traits: { shoulder_width: "balanced" },
							},
							face_profile: {
								face_shape: "oval",
								jawline: "defined",
								nose_profile: "straight",
								lip_profile: "balanced",
								brow_profile: "soft_arch",
								eye_spacing: "balanced",
								eye_shape: "almond",
								forehead_height: "balanced",
								cheekbones: "defined",
								advanced_traits: {},
							},
							imperfection_fingerprint: [],
						},
						personality: {
							social_voice: "warm",
							temperament: "confident",
							interests: ["fashion"],
							boundaries: ["No explicit"],
							communication_style: {
								caption_tone: "aspirational",
								emoji_usage: "minimal",
								language_style: "balanced",
							},
						},
						social_strategy: {
							reality_like_daily: {
								enabled: true,
								style_brief: "daily",
								target_ratio_percent: 60,
								weekly_post_goal: 3,
							},
							fashion_editorial: {
								enabled: true,
								style_brief: "editorial",
								target_ratio_percent: 40,
								weekly_post_goal: 2,
							},
						},
						confidence: {
							character_design: 0.4,
							personality: 0.4,
							social_strategy: 0.4,
						},
						warnings: [],
						image_reviews: [],
					},
				},
			},
		});
		prismaMock.canonicalReference.count.mockResolvedValue(0);
		prismaMock.modelSourceReference.count.mockResolvedValue(3);
		prismaMock.aiModel.update.mockResolvedValue({ id: "model-1" });

		await applyModelPhotoImportSuggestion({
			modelId: "model-1",
			appliedBy: "user-1",
			sections: ["character_design"],
		});

		expect(prismaMock.aiModel.update).toHaveBeenCalledTimes(1);
		expect(startCanonicalPackGenerationMock).not.toHaveBeenCalled();
		const updatePayload = prismaMock.aiModel.update.mock.calls[0]?.[0]?.data;
		expect(updatePayload?.body_profile).toBeDefined();
		expect(updatePayload?.face_profile).toBeDefined();
		expect(updatePayload?.imperfection_fingerprint).toBeDefined();
		expect(updatePayload?.personality_profile).toBeDefined();
		expect(updatePayload?.social_tracks_profile).toBeDefined();
	});

	it("rejects start when fewer than minimum photos are uploaded", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			id: "model-1",
			onboarding_state: null,
		});

		await expect(
			startModelPhotoImport({
				modelId: "model-1",
				initiatedBy: "user-1",
				files: [new File([Uint8Array.of(1)], "photo-1.jpg", { type: "image/jpeg" })],
				options: {
					keep_as_references: true,
					auto_generate_on_apply: true,
					canonical_candidates_per_shot: 1,
				},
			}),
		).rejects.toMatchObject({
			code: "VALIDATION_ERROR",
			status: 400,
		});
	});

	it("rejects start when an import job is already running", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			id: "model-1",
			onboarding_state: {
				photo_import: {
					job_id: "existing-job",
					status: "ANALYZING",
					heartbeat_at: new Date().toISOString(),
				},
			},
		});

		const files = [
			new File([Uint8Array.of(1)], "photo-1.jpg", { type: "image/jpeg" }),
			new File([Uint8Array.of(1)], "photo-2.jpg", { type: "image/jpeg" }),
			new File([Uint8Array.of(1)], "photo-3.jpg", { type: "image/jpeg" }),
		];

		await expect(
			startModelPhotoImport({
				modelId: "model-1",
				initiatedBy: "user-1",
				files,
				options: {
					keep_as_references: true,
					auto_generate_on_apply: true,
					canonical_candidates_per_shot: 1,
				},
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			status: 409,
		});
	});

	it("rejects apply when suggestion is not ready", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			id: "model-1",
			status: "DRAFT",
			body_profile: null,
			face_profile: null,
			active_canonical_pack_version: 0,
			canonical_pack_status: "NOT_STARTED",
			onboarding_state: {},
		});

		await expect(
			applyModelPhotoImportSuggestion({
				modelId: "model-1",
				appliedBy: "user-1",
			}),
		).rejects.toMatchObject({
			code: "CONFLICT",
			status: 409,
		});
	});

	it("exposes the analysis provider in the snapshot", async () => {
		prismaMock.aiModel.findUnique.mockResolvedValue({
			onboarding_state: {
				photo_import: {
					job_id: "job-1",
					status: "READY",
					started_at: "2026-03-13T10:00:00.000Z",
					completed_at: "2026-03-13T10:01:00.000Z",
					provider: "heuristic",
					counts: {
						pending: 0,
						accepted: 3,
						rejected: 0,
						total: 3,
					},
					latest_suggestion: {
						character_design: {
							body_profile: {
								height_cm: 170,
								build: "athletic",
								skin_tone: "olive",
								hair_color: "brown",
								hair_length: "long",
								hair_style: "waves",
								eye_color: "brown",
								distinguishing_features: [],
								advanced_traits: { shoulder_width: "balanced" },
							},
							face_profile: {
								face_shape: "oval",
								jawline: "defined",
								nose_profile: "straight",
								lip_profile: "balanced",
								brow_profile: "soft_arch",
								eye_spacing: "balanced",
								eye_shape: "almond",
								forehead_height: "balanced",
								cheekbones: "defined",
								advanced_traits: {},
							},
							imperfection_fingerprint: [],
						},
						personality: {
							social_voice: "warm",
							temperament: "confident",
							interests: ["fashion"],
							boundaries: ["No explicit"],
							communication_style: {
								caption_tone: "aspirational",
								emoji_usage: "minimal",
								language_style: "balanced",
							},
						},
						social_strategy: {
							reality_like_daily: {
								enabled: true,
								style_brief: "daily",
								target_ratio_percent: 60,
								weekly_post_goal: 3,
							},
							fashion_editorial: {
								enabled: true,
								style_brief: "editorial",
								target_ratio_percent: 40,
								weekly_post_goal: 2,
							},
						},
						confidence: {
							character_design: 0.4,
							personality: 0.4,
							social_strategy: 0.4,
						},
						warnings: ["Vision providers were unavailable. The existing model profile baseline was kept."],
						image_reviews: [],
					},
				},
			},
		});
		prismaMock.modelSourceReference.findMany.mockResolvedValue([]);

		const snapshot = await getModelPhotoImportSnapshot({ modelId: "model-1" });

		expect(snapshot.analysis_provider).toBe("heuristic");
	});

	it("requeues photo analysis for the current import job", async () => {
		prismaMock.aiModel.findUnique
			.mockResolvedValueOnce({
				id: "model-1",
				onboarding_state: {
					photo_import: {
						job_id: "job-1",
						status: "READY",
						heartbeat_at: "2026-03-13T10:01:00.000Z",
						counts: {
							pending: 0,
							accepted: 3,
							rejected: 0,
							total: 3,
						},
						latest_suggestion: {
							character_design: {
								body_profile: {
									height_cm: 170,
									build: "athletic",
									skin_tone: "olive",
									hair_color: "brown",
									hair_length: "long",
									hair_style: "waves",
									eye_color: "brown",
									distinguishing_features: [],
									advanced_traits: { shoulder_width: "balanced" },
								},
								face_profile: {
									face_shape: "oval",
									jawline: "defined",
									nose_profile: "straight",
									lip_profile: "balanced",
									brow_profile: "soft_arch",
									eye_spacing: "balanced",
									eye_shape: "almond",
									forehead_height: "balanced",
									cheekbones: "defined",
									advanced_traits: {},
								},
								imperfection_fingerprint: [],
							},
							personality: {
								social_voice: "warm",
								temperament: "confident",
								interests: ["fashion"],
								boundaries: ["No explicit"],
								communication_style: {
									caption_tone: "aspirational",
									emoji_usage: "minimal",
									language_style: "balanced",
								},
							},
							social_strategy: {
								reality_like_daily: {
									enabled: true,
									style_brief: "daily",
									target_ratio_percent: 60,
									weekly_post_goal: 3,
								},
								fashion_editorial: {
									enabled: true,
									style_brief: "editorial",
									target_ratio_percent: 40,
									weekly_post_goal: 2,
								},
							},
							confidence: {
								character_design: 0.4,
								personality: 0.4,
								social_strategy: 0.4,
							},
							warnings: [],
							image_reviews: [],
						},
					},
				},
			})
			.mockResolvedValueOnce({
				onboarding_state: {
					photo_import: {
						job_id: "job-1",
						status: "READY",
						heartbeat_at: "2026-03-13T10:01:00.000Z",
						counts: {
							pending: 0,
							accepted: 3,
							rejected: 0,
							total: 3,
						},
						latest_suggestion: {},
					},
				},
			})
			.mockResolvedValue({
				onboarding_state: {
					photo_import: {
						job_id: "other-job",
					},
				},
			});
		prismaMock.modelSourceReference.count.mockResolvedValue(3);
		prismaMock.aiModel.update.mockResolvedValue({ id: "model-1" });

		const result = await reanalyzeModelPhotoImport({
			modelId: "model-1",
			initiatedBy: "user-1",
		});

		expect(result).toMatchObject({
			job_id: "job-1",
			status: "ANALYZING",
			counts: { total: 3 },
		});
		expect(prismaMock.aiModel.update).toHaveBeenCalledTimes(1);
		const updatePayload = prismaMock.aiModel.update.mock.calls[0]?.[0] as {
			data?: { onboarding_state?: { photo_import?: { latest_suggestion?: unknown } } };
		};
		expect(updatePayload.data?.onboarding_state?.photo_import?.latest_suggestion).toBeNull();
	});
});
