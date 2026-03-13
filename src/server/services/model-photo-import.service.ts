import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import type { ImageModelProvider, ModelSourceReferenceStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { characterDesignSchema, personalityProfileSchema, photoImportStartOptionsSchema, photoImportSuggestionSchema, socialTracksSchema } from "@/server/schemas/model-workflow";
import { startCanonicalPackGeneration } from "@/server/services/canonical-pack.service";
import { analyzeModelPhotosWithVision } from "@/server/services/model-photo-import-vision.service";
import { defaultWorkflowState, deriveModelStatusForWorkflow, mergeWorkflowState } from "@/server/services/model-workflow.service";
import { createSignedReadUrlForGcsUri, uploadImageBytesToModelBucket } from "@/server/services/storage/gcs-storage";

const MIN_PHOTO_IMPORT_FILES = 3;
const MAX_PHOTO_IMPORT_FILES = 20;
const MAX_PHOTO_IMPORT_BYTES = 8 * 1024 * 1024;
const PHOTO_IMPORT_STALE_MS = 20 * 60 * 1000;

const SUPPORTED_PHOTO_IMPORT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const DEFAULT_PHOTO_IMPORT_OPTIONS = {
	keep_as_references: true,
	auto_generate_on_apply: false,
	canonical_provider: "nano_banana_2" as const,
	canonical_candidates_per_shot: 1
};

export type PhotoImportStatus = "IDLE" | "UPLOADING" | "ANALYZING" | "READY" | "FAILED";

type WorkflowStep = "character_design" | "personality" | "social_strategy";
const ALL_WORKFLOW_STEPS: WorkflowStep[] = ["character_design", "personality", "social_strategy"];

type PhotoImportState = {
	job_id?: string;
	status?: PhotoImportStatus;
	started_at?: string;
	heartbeat_at?: string;
	completed_at?: string;
	error?: string | null;
	keep_as_references?: boolean;
	auto_generate_on_apply?: boolean;
	canonical_provider?: ImageModelProvider;
	canonical_model_id?: string;
	canonical_candidates_per_shot?: number;
	provider?: string;
	counts?: {
		pending: number;
		accepted: number;
		rejected: number;
		total: number;
	};
	latest_suggestion?: unknown;
};

export type ModelPhotoImportSuggestion = ReturnType<typeof photoImportSuggestionSchema.parse>;

export type ModelPhotoImportSnapshot = {
	job_id: string | null;
	status: PhotoImportStatus;
	started_at: string | null;
	completed_at: string | null;
	error: string | null;
	analysis_provider: "zai_vision" | "openai_vision" | "gemini_fallback" | "heuristic" | null;
	counts: {
		pending: number;
		accepted: number;
		rejected: number;
		total: number;
	};
	options: {
		keep_as_references: boolean;
		auto_generate_on_apply: boolean;
		canonical_provider?: ImageModelProvider;
		canonical_model_id?: string;
		canonical_candidates_per_shot: number;
	};
	references: Array<{
		id: string;
		image_gcs_uri: string;
		preview_url: string | null;
		status: ModelSourceReferenceStatus;
		rejection_reason: string | null;
		file_name: string | null;
		mime_type: string;
		byte_size: number;
		sort_order: number;
		created_at: string;
	}>;
	latest_suggestion: ModelPhotoImportSuggestion | null;
};

export async function startModelPhotoImport(input: {
	modelId: string;
	initiatedBy: string;
	files: File[];
	options: z.infer<typeof photoImportStartOptionsSchema>;
}): Promise<{ job_id: string; status: "ANALYZING"; started_at: string; counts: { total: number } }> {
	const sourceReferenceDelegate = getModelSourceReferenceDelegate();

	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			id: true,
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	if (input.files.length < MIN_PHOTO_IMPORT_FILES || input.files.length > MAX_PHOTO_IMPORT_FILES) {
		throw new ApiError(400, "VALIDATION_ERROR", `Upload between ${MIN_PHOTO_IMPORT_FILES} and ${MAX_PHOTO_IMPORT_FILES} photos.`);
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const currentPhotoState = readPhotoImportState(onboardingState);

	if (isPhotoImportLocked(currentPhotoState)) {
		throw new ApiError(409, "CONFLICT", "A photo import is already running for this model.", { job_id: currentPhotoState?.job_id });
	}

	const jobId = randomUUID();
	const nowIso = new Date().toISOString();

	const options = photoImportStartOptionsSchema.parse(input.options);
	const preparedOptions: PhotoImportState = {
		keep_as_references: options.keep_as_references,
		auto_generate_on_apply: options.auto_generate_on_apply,
		canonical_provider: options.canonical_provider,
		canonical_model_id: options.canonical_model_id,
		canonical_candidates_per_shot: options.canonical_candidates_per_shot
	};

	await prisma.aiModel.update({
		where: { id: input.modelId },
		data: {
			onboarding_state: toInputJson({
				...onboardingState,
				photo_import: {
					...currentPhotoState,
					...preparedOptions,
					job_id: jobId,
					status: "UPLOADING",
					started_at: nowIso,
					heartbeat_at: nowIso,
					completed_at: undefined,
					error: null,
					provider: undefined,
					latest_suggestion: undefined,
					counts: {
						pending: 0,
						accepted: 0,
						rejected: 0,
						total: input.files.length
					}
				}
			})
		}
	});

	let uploadedCount = 0;
	const maxSort = await sourceReferenceDelegate.aggregate({
		where: { model_id: input.modelId },
		_max: { sort_order: true }
	});
	const sortBase = maxSort._max.sort_order ?? 0;

	try {
		for (let index = 0; index < input.files.length; index += 1) {
			const file = input.files[index];
			if (!file) continue;

			const bytes = Buffer.from(await file.arrayBuffer());
			const size = bytes.byteLength;
			if (size <= 0) {
				throw new ApiError(400, "VALIDATION_ERROR", `Uploaded file '${file.name}' is empty.`);
			}
			if (size > MAX_PHOTO_IMPORT_BYTES) {
				throw new ApiError(400, "VALIDATION_ERROR", `Uploaded file '${file.name}' exceeds ${Math.floor(MAX_PHOTO_IMPORT_BYTES / (1024 * 1024))}MB.`);
			}

			const detectedMime = detectImageMimeType(bytes);
			if (!detectedMime || !SUPPORTED_PHOTO_IMPORT_MIME_TYPES.has(detectedMime)) {
				throw new ApiError(400, "VALIDATION_ERROR", `Unsupported image format for '${file.name}'. Allowed: JPEG, PNG, WEBP.`);
			}

			const declaredMime = normalizeMimeType(file.type);
			if (declaredMime && declaredMime !== detectedMime) {
				throw new ApiError(400, "VALIDATION_ERROR", `Uploaded file '${file.name}' does not match its declared MIME type.`);
			}

			const extension = mimeTypeToExtension(detectedMime);
			const safeName = sanitizeUploadFileName(file.name) ?? `photo-${index + 1}`;
			const destinationPath = `model-source-references/${input.modelId}/${jobId}/${Date.now()}-${safeName}.${extension}`;
			const gcsUri = await uploadImageBytesToModelBucket({
				bytes,
				contentType: detectedMime,
				destinationPath
			});

			await sourceReferenceDelegate.create({
				data: {
					model_id: input.modelId,
					uploaded_by: input.initiatedBy,
					image_gcs_uri: gcsUri,
					file_name: file.name || null,
					mime_type: detectedMime,
					byte_size: size,
					status: "PENDING",
					sort_order: sortBase + index + 1
				}
			});
			uploadedCount += 1;
		}
	} catch (error) {
		await updatePhotoImportState({
			modelId: input.modelId,
			jobId,
			status: "FAILED",
			heartbeat_at: new Date().toISOString(),
			completed_at: new Date().toISOString(),
			error: error instanceof Error ? error.message : "Failed to upload photo import files.",
			counts: {
				pending: 0,
				accepted: 0,
				rejected: 0,
				total: uploadedCount
			}
		});
		throw error;
	}

	const afterUpload = new Date().toISOString();
	await updatePhotoImportState({
		modelId: input.modelId,
		jobId,
		status: "ANALYZING",
		error: null,
		heartbeat_at: afterUpload,
		completed_at: undefined,
		counts: {
			pending: uploadedCount,
			accepted: 0,
			rejected: 0,
			total: input.files.length
		},
		options: preparedOptions
	});

	void runPhotoImportAnalysis({
		modelId: input.modelId,
		jobId,
		initiatedBy: input.initiatedBy
	});

	log({
		level: "info",
		service: "api",
		action: "model_photo_import_started",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.initiatedBy,
		metadata: {
			job_id: jobId,
			photos_uploaded: uploadedCount
		}
	});

	return {
		job_id: jobId,
		status: "ANALYZING",
		started_at: nowIso,
		counts: {
			total: input.files.length
		}
	};
}

export async function getModelPhotoImportSnapshot(input: { modelId: string }): Promise<ModelPhotoImportSnapshot> {
	const sourceReferenceDelegate = getModelSourceReferenceDelegate();

	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const photoState = readPhotoImportState(onboardingState);
	const jobId = photoState?.job_id;

	const where: Prisma.ModelSourceReferenceWhereInput = {
		model_id: input.modelId,
		...(jobId
			? {
					image_gcs_uri: {
						contains: `/${jobId}/`
					}
				}
			: {})
	};

	const references = await sourceReferenceDelegate.findMany({
		where,
		orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
	});

	const mappedReferences = await Promise.all(
		references.map(async reference => {
			let previewUrl: string | null = null;
			try {
				previewUrl = await createSignedReadUrlForGcsUri(reference.image_gcs_uri, 3600);
			} catch {
				previewUrl = null;
			}

			return {
				id: reference.id,
				image_gcs_uri: reference.image_gcs_uri,
				preview_url: previewUrl,
				status: reference.status,
				rejection_reason: reference.rejection_reason,
				file_name: reference.file_name,
				mime_type: reference.mime_type,
				byte_size: reference.byte_size,
				sort_order: reference.sort_order,
				created_at: reference.created_at.toISOString()
			};
		})
	);

	const computedCounts = {
		pending: mappedReferences.filter(reference => reference.status === "PENDING").length,
		accepted: mappedReferences.filter(reference => reference.status === "ACCEPTED").length,
		rejected: mappedReferences.filter(reference => reference.status === "REJECTED").length,
		total: mappedReferences.length
	};

	const parsedSuggestion = photoImportSuggestionSchema.safeParse(photoState?.latest_suggestion);

	return {
		job_id: jobId ?? null,
		status: photoState?.status ?? "IDLE",
		started_at: photoState?.started_at ?? null,
		completed_at: photoState?.completed_at ?? null,
		error: photoState?.error ?? null,
		analysis_provider:
			photoState?.provider === "zai_vision" ||
			photoState?.provider === "openai_vision" ||
			photoState?.provider === "gemini_fallback" ||
			photoState?.provider === "heuristic"
				? photoState.provider
				: null,
		counts: photoState?.counts ?? computedCounts,
		options: {
			keep_as_references: photoState?.keep_as_references ?? DEFAULT_PHOTO_IMPORT_OPTIONS.keep_as_references,
			auto_generate_on_apply: photoState?.auto_generate_on_apply ?? DEFAULT_PHOTO_IMPORT_OPTIONS.auto_generate_on_apply,
			canonical_provider: photoState?.canonical_provider,
			canonical_model_id: photoState?.canonical_model_id,
			canonical_candidates_per_shot: photoState?.canonical_candidates_per_shot ?? DEFAULT_PHOTO_IMPORT_OPTIONS.canonical_candidates_per_shot
		},
		references: mappedReferences,
		latest_suggestion: parsedSuggestion.success ? parsedSuggestion.data : null
	};
}

export async function reanalyzeModelPhotoImport(input: {
	modelId: string;
	initiatedBy: string;
}): Promise<{ job_id: string; status: "ANALYZING"; counts: { total: number } }> {
	const sourceReferenceDelegate = getModelSourceReferenceDelegate();

	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			id: true,
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const photoState = readPhotoImportState(onboardingState);
	if (!photoState?.job_id) {
		throw new ApiError(409, "CONFLICT", "Upload photos before reanalyzing identity anchors.");
	}

	if (isPhotoImportLocked(photoState)) {
		throw new ApiError(409, "CONFLICT", "Photo analysis is already running for this model.", { job_id: photoState.job_id });
	}

	const referenceCount = await sourceReferenceDelegate.count({
		where: {
			model_id: input.modelId,
			image_gcs_uri: {
				contains: `/${photoState.job_id}/`
			}
		}
	});

	if (referenceCount === 0) {
		throw new ApiError(409, "CONFLICT", "No uploaded photos were found for the current import. Upload photos again and retry.");
	}

	const nowIso = new Date().toISOString();
	await updatePhotoImportState({
		modelId: input.modelId,
		jobId: photoState.job_id,
		status: "ANALYZING",
		heartbeat_at: nowIso,
		completed_at: undefined,
		error: null,
		latest_suggestion: null,
		provider: null,
		counts: {
			pending: referenceCount,
			accepted: 0,
			rejected: 0,
			total: referenceCount
		}
	});

	void runPhotoImportAnalysis({
		modelId: input.modelId,
		jobId: photoState.job_id,
		initiatedBy: input.initiatedBy
	});

	log({
		level: "info",
		service: "api",
		action: "model_photo_import_reanalysis_started",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.initiatedBy,
		metadata: {
			job_id: photoState.job_id,
			photos_uploaded: referenceCount
		}
	});

	return {
		job_id: photoState.job_id,
		status: "ANALYZING",
		counts: {
			total: referenceCount
		}
	};
}

export async function applyModelPhotoImportSuggestion(input: {
	modelId: string;
	appliedBy: string;
	sections?: WorkflowStep[];
	startCanonicalGeneration?: boolean;
	canonicalProvider?: ImageModelProvider;
	canonicalModelId?: string;
	canonicalCandidatesPerShot?: number;
}): Promise<{
	applied: true;
	model_id: string;
	workflow_state: {
		current_step: WorkflowStep;
		completed_steps: WorkflowStep[];
		last_saved_at: string;
	};
	draft: {
		character_design: ReturnType<typeof photoImportSuggestionSchema.parse>["character_design"];
		personality: ReturnType<typeof photoImportSuggestionSchema.parse>["personality"];
		social_strategy: ReturnType<typeof photoImportSuggestionSchema.parse>["social_strategy"];
	};
	canonical_job?: {
		job_id: string;
		pack_version: number;
	};
	canonical_warning?: string;
}> {
	const sourceReferenceDelegate = getModelSourceReferenceDelegate();

	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			id: true,
			status: true,
			body_profile: true,
			face_profile: true,
			active_canonical_pack_version: true,
			canonical_pack_status: true,
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const photoState = readPhotoImportState(onboardingState);
	if (!photoState || photoState.status !== "READY") {
		throw new ApiError(409, "CONFLICT", "Photo import results aren't ready yet. Please wait and try again.");
	}

	const suggestionResult = photoImportSuggestionSchema.safeParse(photoState.latest_suggestion);
	if (!suggestionResult.success) {
		throw new ApiError(409, "CONFLICT", "No valid suggestion is ready to apply yet. Please review imported photos and try again.");
	}
	const suggestion = suggestionResult.data;

	const sections: WorkflowStep[] = [...ALL_WORKFLOW_STEPS];

	const selectedCanonicalCount =
		model.active_canonical_pack_version > 0
			? await prisma.canonicalReference.count({
					where: {
						model_id: input.modelId,
						pack_version: model.active_canonical_pack_version
					}
				})
			: 0;
	const acceptedImportedReferenceCount = await sourceReferenceDelegate.count({
		where: {
			model_id: input.modelId,
			status: "ACCEPTED"
		}
	});

	let nextWorkflowState = toWorkflowState(onboardingState);
	for (const step of sections) {
		nextWorkflowState = mergeWorkflowState(nextWorkflowState, step);
	}

	const nowIso = new Date().toISOString();
	const nextOnboardingState = {
		...onboardingState,
		...nextWorkflowState,
		photo_import: {
			...photoState,
			heartbeat_at: nowIso,
			completed_at: photoState.completed_at ?? nowIso,
			error: null,
			last_applied_at: nowIso,
			applied_sections: sections
		}
	};

	const payload: Prisma.AiModelUpdateInput = {
		onboarding_state: toInputJson(nextOnboardingState),
		body_profile: toInputJson(suggestion.character_design.body_profile),
		face_profile: toInputJson(suggestion.character_design.face_profile),
		imperfection_fingerprint: toInputJson(suggestion.character_design.imperfection_fingerprint),
		personality_profile: toInputJson(suggestion.personality),
		social_tracks_profile: toInputJson(suggestion.social_strategy)
	};

	const resolvedModelLike = {
		...model,
		body_profile: suggestion.character_design.body_profile,
		face_profile: suggestion.character_design.face_profile
	};

	payload.status = deriveModelStatusForWorkflow(resolvedModelLike, selectedCanonicalCount, acceptedImportedReferenceCount);

	await prisma.aiModel.update({
		where: { id: input.modelId },
		data: payload
	});

	let canonicalJob: { job_id: string; pack_version: number } | undefined;
	let canonicalWarning: string | undefined;
	const shouldStartCanonicalGeneration = input.startCanonicalGeneration === true;

	if (shouldStartCanonicalGeneration) {
		const provider = input.canonicalProvider ?? photoState.canonical_provider ?? "nano_banana_2";
		const candidatesPerShot = Math.max(
			1,
			Math.min(5, Math.trunc(input.canonicalCandidatesPerShot ?? photoState.canonical_candidates_per_shot ?? DEFAULT_PHOTO_IMPORT_OPTIONS.canonical_candidates_per_shot))
		);

		try {
			canonicalJob = await startCanonicalPackGeneration({
				modelId: input.modelId,
				initiatedBy: input.appliedBy,
				provider,
				providerModelId: input.canonicalModelId ?? photoState.canonical_model_id,
				candidatesPerShot
			});
		} catch (error) {
			canonicalWarning =
				error instanceof Error ? `Model info was updated, but canonical generation could not start: ${error.message}` : "Model info was updated, but canonical generation could not start.";
		}
	}

	log({
		level: "info",
		service: "api",
		action: "model_photo_import_applied",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.appliedBy,
		metadata: {
			sections,
			canonical_generation_started: Boolean(canonicalJob),
			canonical_job_id: canonicalJob?.job_id,
			canonical_warning: canonicalWarning
		}
	});

	return {
		applied: true,
		model_id: input.modelId,
		workflow_state: nextWorkflowState,
		draft: {
			character_design: suggestion.character_design,
			personality: suggestion.personality,
			social_strategy: suggestion.social_strategy
		},
		...(canonicalJob ? { canonical_job: canonicalJob } : {}),
		...(canonicalWarning ? { canonical_warning: canonicalWarning } : {})
	};
}

async function runPhotoImportAnalysis(input: { modelId: string; jobId: string; initiatedBy: string }) {
	const sourceReferenceDelegate = getModelSourceReferenceDelegate();

	try {
		const stillCurrent = await ensurePhotoImportJobStillCurrent(input.modelId, input.jobId);
		if (!stillCurrent) {
			return;
		}

		const model = await prisma.aiModel.findUnique({
			where: { id: input.modelId },
			select: {
				name: true,
				body_profile: true,
				face_profile: true,
				imperfection_fingerprint: true,
				personality_profile: true,
				social_tracks_profile: true,
				onboarding_state: true,
				source_references: {
					where: {
						image_gcs_uri: {
							contains: `/${input.jobId}/`
						}
					},
					orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
				}
			}
		});

		if (!model) {
			return;
		}

		const signedReferences = await Promise.all(
			model.source_references.map(async reference => {
				let url = reference.image_gcs_uri;
				try {
					url = await createSignedReadUrlForGcsUri(reference.image_gcs_uri, 1800);
				} catch {
					url = reference.image_gcs_uri;
				}

				return {
					reference_id: reference.id,
					url,
					file_name: reference.file_name
				};
			})
		);

		if (signedReferences.length === 0) {
			throw new ApiError(400, "VALIDATION_ERROR", "No uploaded photos were found for this import job.");
		}

		const vision = await analyzeModelPhotosWithVision({
			modelName: model.name,
			references: signedReferences,
			currentModelData: resolveCurrentModelDataSeed(model)
		});

		const reviewById = new Map(vision.suggestion.image_reviews.map(review => [review.reference_id, review]));

		const updates: Prisma.PrismaPromise<unknown>[] = [];
		let acceptedCount = 0;
		let rejectedCount = 0;

		for (const reference of model.source_references) {
			const review = reviewById.get(reference.id);
			const accepted = review?.solo_subject !== false && review?.face_visible !== false;
			const status: ModelSourceReferenceStatus = accepted ? "ACCEPTED" : "REJECTED";
			const rejectionReason = accepted ? null : (review?.reason ?? "Rejected: non-solo subject or insufficient face visibility.");

			if (accepted) {
				acceptedCount += 1;
			} else {
				rejectedCount += 1;
			}

			updates.push(
				sourceReferenceDelegate.update({
					where: { id: reference.id },
					data: {
						status,
						rejection_reason: rejectionReason
					}
				})
			);
		}

		if (updates.length > 0) {
			await prisma.$transaction(updates);
		}

		const stillCurrentAfter = await ensurePhotoImportJobStillCurrent(input.modelId, input.jobId);
		if (!stillCurrentAfter) return;

		const status: PhotoImportStatus = acceptedCount > 0 ? "READY" : "FAILED";
		const error = status === "FAILED" ? "No photos passed the single-subject face policy. Upload clearer solo photos and retry." : null;
		const nowIso = new Date().toISOString();

		await updatePhotoImportState({
			modelId: input.modelId,
			jobId: input.jobId,
			status,
			heartbeat_at: nowIso,
			completed_at: nowIso,
			error,
			latest_suggestion: vision.suggestion,
			counts: {
				pending: 0,
				accepted: acceptedCount,
				rejected: rejectedCount,
				total: model.source_references.length
			},
			provider: vision.provider
		});

		log({
			level: "info",
			service: "api",
			action: "model_photo_import_completed",
			entity_type: "ai_model",
			entity_id: input.modelId,
			user_id: input.initiatedBy,
			metadata: {
				job_id: input.jobId,
				provider: vision.provider,
				accepted: acceptedCount,
				rejected: rejectedCount,
				status
			}
		});
	} catch (error) {
		const stillCurrent = await ensurePhotoImportJobStillCurrent(input.modelId, input.jobId);
		if (stillCurrent) {
			await updatePhotoImportState({
				modelId: input.modelId,
				jobId: input.jobId,
				status: "FAILED",
				heartbeat_at: new Date().toISOString(),
				completed_at: new Date().toISOString(),
				error: error instanceof Error ? error.message : "Photo import analysis failed."
			});
		}

		log({
			level: "error",
			service: "api",
			action: "model_photo_import_failed",
			entity_type: "ai_model",
			entity_id: input.modelId,
			user_id: input.initiatedBy,
			error: error instanceof Error ? error.message : "Photo import analysis failed",
			metadata: {
				job_id: input.jobId
			}
		});
	}
}

function getModelSourceReferenceDelegate() {
	const delegate = (prisma as PrismaClientWithSourceReference).modelSourceReference;
	if (!delegate) {
		throw new ApiError(503, "INTERNAL_ERROR", "Photo import is temporarily unavailable because Prisma client is out of date. Run `pnpm prisma generate` and restart the server.");
	}
	return delegate;
}

type PrismaClientWithSourceReference = typeof prisma & {
	modelSourceReference?: {
		aggregate: typeof prisma.modelSourceReference.aggregate;
		create: typeof prisma.modelSourceReference.create;
		count: typeof prisma.modelSourceReference.count;
		findMany: typeof prisma.modelSourceReference.findMany;
		update: typeof prisma.modelSourceReference.update;
	};
};

async function ensurePhotoImportJobStillCurrent(modelId: string, jobId: string): Promise<boolean> {
	const model = await prisma.aiModel.findUnique({
		where: { id: modelId },
		select: {
			onboarding_state: true
		}
	});
	if (!model) return false;

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const photoState = readPhotoImportState(onboardingState);
	if (!photoState) return false;

	return photoState.job_id === jobId;
}

async function updatePhotoImportState(input: {
	modelId: string;
	jobId: string;
	status: PhotoImportStatus;
	heartbeat_at: string;
	completed_at?: string;
	error?: string | null;
	latest_suggestion?: unknown;
	counts?: {
		pending: number;
		accepted: number;
		rejected: number;
		total: number;
	};
	options?: Partial<PhotoImportState>;
	provider?: string | null;
}) {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			onboarding_state: true
		}
	});
	if (!model) return;

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const photoState = readPhotoImportState(onboardingState);
	if (!photoState || photoState.job_id !== input.jobId) return;

	const nextPhotoState: PhotoImportState = {
		...photoState,
		...input.options,
		status: input.status,
		heartbeat_at: input.heartbeat_at,
		completed_at: input.completed_at ?? photoState.completed_at,
		error: input.error ?? photoState.error ?? null,
		latest_suggestion:
			Object.prototype.hasOwnProperty.call(input, "latest_suggestion") ? input.latest_suggestion : photoState.latest_suggestion,
		counts: input.counts ?? photoState.counts,
		provider: Object.prototype.hasOwnProperty.call(input, "provider") ? input.provider ?? undefined : photoState.provider
	};

	await prisma.aiModel.update({
		where: { id: input.modelId },
		data: {
			onboarding_state: toInputJson({
				...onboardingState,
				photo_import: nextPhotoState
			})
		}
	});
}

function readPhotoImportState(onboardingState: Record<string, unknown>): PhotoImportState | null {
	const raw = asRecord(onboardingState.photo_import);
	if (!raw) return null;

	const status = raw.status === "IDLE" || raw.status === "UPLOADING" || raw.status === "ANALYZING" || raw.status === "READY" || raw.status === "FAILED" ? raw.status : undefined;

	const countsRaw = asRecord(raw.counts);

	return {
		job_id: typeof raw.job_id === "string" ? raw.job_id : undefined,
		status,
		started_at: typeof raw.started_at === "string" ? raw.started_at : undefined,
		heartbeat_at: typeof raw.heartbeat_at === "string" ? raw.heartbeat_at : undefined,
		completed_at: typeof raw.completed_at === "string" ? raw.completed_at : undefined,
		error: typeof raw.error === "string" ? raw.error : null,
		keep_as_references: typeof raw.keep_as_references === "boolean" ? raw.keep_as_references : undefined,
		auto_generate_on_apply: typeof raw.auto_generate_on_apply === "boolean" ? raw.auto_generate_on_apply : undefined,
		canonical_provider:
			raw.canonical_provider === "openai" || raw.canonical_provider === "nano_banana_2" || raw.canonical_provider === "zai_glm" || raw.canonical_provider === "gpu"
				? raw.canonical_provider
				: undefined,
		canonical_model_id: typeof raw.canonical_model_id === "string" ? raw.canonical_model_id : undefined,
		canonical_candidates_per_shot: readPositiveInt(raw.canonical_candidates_per_shot),
		provider:
			raw.provider === "zai_vision" || raw.provider === "openai_vision" || raw.provider === "gemini_fallback" || raw.provider === "heuristic"
				? raw.provider
				: undefined,
		counts: countsRaw
			? {
					pending: readNonNegativeInt(countsRaw.pending) ?? 0,
					accepted: readNonNegativeInt(countsRaw.accepted) ?? 0,
					rejected: readNonNegativeInt(countsRaw.rejected) ?? 0,
					total: readNonNegativeInt(countsRaw.total) ?? 0
				}
			: undefined,
		latest_suggestion: raw.latest_suggestion
	};
}

function isPhotoImportLocked(state: PhotoImportState | null): boolean {
	if (!state) return false;
	if (state.status !== "UPLOADING" && state.status !== "ANALYZING") return false;
	const heartbeat = state.heartbeat_at ? new Date(state.heartbeat_at) : null;
	if (!heartbeat || Number.isNaN(heartbeat.getTime())) return true;
	return Date.now() - heartbeat.getTime() < PHOTO_IMPORT_STALE_MS;
}

function toWorkflowState(raw: Record<string, unknown>) {
	const defaultState = defaultWorkflowState();
	const current = raw.current_step === "character_design" || raw.current_step === "personality" || raw.current_step === "social_strategy" ? raw.current_step : defaultState.current_step;

	const completed = Array.isArray(raw.completed_steps)
		? raw.completed_steps.filter((step): step is WorkflowStep => step === "character_design" || step === "personality" || step === "social_strategy")
		: [];

	return {
		current_step: current,
		completed_steps: completed,
		last_saved_at: typeof raw.last_saved_at === "string" ? raw.last_saved_at : defaultState.last_saved_at
	};
}

function resolveCurrentModelDataSeed(model: { body_profile: unknown; face_profile: unknown; imperfection_fingerprint: unknown; personality_profile: unknown; social_tracks_profile: unknown }) {
	const characterDesign = characterDesignSchema.safeParse({
		body_profile: model.body_profile,
		face_profile: model.face_profile,
		imperfection_fingerprint: Array.isArray(model.imperfection_fingerprint) ? model.imperfection_fingerprint : []
	});
	const personality = personalityProfileSchema.safeParse(model.personality_profile);
	const socialTracks = socialTracksSchema.safeParse(model.social_tracks_profile);

	return {
		...(characterDesign.success ? { character_design: characterDesign.data } : {}),
		...(personality.success ? { personality: personality.data } : {}),
		...(socialTracks.success ? { social_strategy: socialTracks.data } : {})
	};
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

function normalizeMimeType(value: string | null | undefined): string | null {
	const normalized = (value ?? "").split(";")[0]?.trim().toLowerCase();
	return normalized || null;
}

function sanitizeUploadFileName(fileName: string): string | null {
	const baseName = fileName
		.trim()
		.replace(/\.[^./\\]+$/, "")
		.replace(/[^a-zA-Z0-9_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 80);
	return baseName.length > 0 ? baseName : null;
}

function detectImageMimeType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
	if (bytes.byteLength < 12) return null;

	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}

	if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
		return "image/png";
	}

	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
		return "image/webp";
	}

	return null;
}

function mimeTypeToExtension(mimeType: "image/jpeg" | "image/png" | "image/webp") {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	return "png";
}

function readPositiveInt(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(parsed)) return undefined;
	const rounded = Math.trunc(parsed);
	return rounded > 0 ? rounded : undefined;
}

function readNonNegativeInt(value: unknown): number | undefined {
	const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
	if (!Number.isFinite(parsed)) return undefined;
	const rounded = Math.trunc(parsed);
	return rounded >= 0 ? rounded : undefined;
}
