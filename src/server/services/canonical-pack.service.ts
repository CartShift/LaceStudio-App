import { randomInt, randomUUID } from "node:crypto";
import type { ImageReferenceInput } from "@/server/providers/image/types";
import type { ImageModelProvider } from "@/server/schemas/creative";
import { ApiError } from "@/lib/http";
import { log } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/retry";
import { sleep } from "@/lib/utils";
import { getEnv } from "@/lib/env";
import { getImageProvider } from "@/server/providers";
import { createDefaultCreativeControls } from "@/server/services/creative-controls";
import { scoreCanonicalCandidate } from "@/server/services/canonical-qa.service";
import { photoImportSuggestionSchema } from "@/server/schemas/model-workflow";
import { buildCanonicalShotPlan } from "@/server/services/canonical-shot-plan";
import { REQUIRED_CANONICAL_SHOT_CODES, buildModelCapabilityFlags, deriveModelStatusForWorkflow } from "@/server/services/model-workflow.service";
import { createSignedReadUrlForGcsUri, uploadImageFromUriToModelBucket } from "@/server/services/storage/gcs-storage";

const CANONICAL_SHOT_DELAY_MS = 2_500;
const CANONICAL_RATE_LIMIT_DELAY_MS = 5_000;
const CANONICAL_SHOT_MAX_ATTEMPTS = 3;
const CANONICAL_SHOT_TIMEOUT_MS = 180_000;
const CANONICAL_RETRY_BASE_DELAY_MS = 1_200;
const CANONICAL_UPLOAD_MAX_ATTEMPTS = 3;
const CANONICAL_UPLOAD_BASE_DELAY_MS = 800;
const CANONICAL_JOB_STALE_MS = 20 * 60 * 1000;
const CANONICAL_ERROR_PREVIEW_LIMIT = 6;
const MAX_CANONICAL_CONDITIONING_REFERENCES = 10;
const MAX_SHOT_CONDITIONING_REFERENCES = 4;
const MAX_QA_REFERENCE_IMAGES = 4;
const CANONICAL_REFERENCE_SIGNED_URL_TTL_SECONDS = 60 * 60;
const CANONICAL_REFERENCE_RESOLVE_CONCURRENCY = 6;
const FRONT_CANONICAL_SHOT_CODE = "frontal_closeup";

type CanonicalGenerationMode = "front_only" | "remaining" | "full";
type CanonicalShotCode = (typeof REQUIRED_CANONICAL_SHOT_CODES)[number];
type PhotoReferenceViewAngle = "frontal" | "left_45" | "right_45" | "left_profile" | "right_profile" | "unknown";
type PhotoReferenceFraming = "closeup" | "head_shoulders" | "half_body" | "full_body" | "unknown";
type PhotoReferenceExpression = "neutral" | "soft_smile" | "serious" | "other";

type CanonicalGenerationState = {
	job_id?: string;
	pack_version?: number;
	provider?: ImageModelProvider;
	provider_model_id?: string;
	error_request_id?: string;
	generation_mode?: CanonicalGenerationMode;
	status?: "GENERATING" | "READY" | "FAILED" | "APPROVED";
	error?: string | null;
	started_at?: string;
	heartbeat_at?: string;
	completed_at?: string;
	completed_shots?: number;
	total_shots?: number;
	failed_shots?: number;
	candidates_per_shot?: number;
	shot_codes?: CanonicalShotCode[];
	reference_pool?: CanonicalConditioningReference[];
};

type PhotoImportImageReview = {
	reference_id: string;
	accepted: boolean;
	reason?: string;
	solo_subject?: boolean;
	face_visible?: boolean;
	view_angle?: PhotoReferenceViewAngle;
	framing?: PhotoReferenceFraming;
	expression?: PhotoReferenceExpression;
	sharpness_score?: number;
	identity_anchor_score?: number;
};

type CanonicalConditioningReference = ImageReferenceInput & {
	source_kind: "selected_front_candidate" | "canonical_reference" | "uploaded_photo";
	canonical_shot_code?: CanonicalShotCode;
	view_angle?: PhotoReferenceViewAngle;
	framing?: PhotoReferenceFraming;
	expression?: PhotoReferenceExpression;
	identity_anchor_score?: number;
	sharpness_score?: number;
};

export async function uploadCandidateReference(input: {
	modelId: string;
	initiatedBy: string;
	shotCode: string;
	imageDataUrl: string;
	candidateId?: string;
	candidateIndex?: number;
	packVersion?: number;
}) {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			name: true,
			body_profile: true,
			face_profile: true,
			imperfection_fingerprint: true,
			canonical_pack_status: true,
			active_canonical_pack_version: true,
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	let packVersion = input.packVersion ?? model.active_canonical_pack_version;
	if (packVersion <= 0) {
		packVersion = 1;
	}

	const nowIso = new Date().toISOString();
	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const generationState = readCanonicalGenerationState(onboardingState);
	const packState = readCanonicalPackState(onboardingState, packVersion);

	// Manual uploads can recover packs that were never started or previously failed.
	if (model.canonical_pack_status === "NOT_STARTED" || model.canonical_pack_status === "FAILED") {
		const nextPackState: CanonicalGenerationState = {
			...(packState ?? generationState ?? {}),
			pack_version: packVersion,
			status: "READY",
			error: null,
			heartbeat_at: nowIso,
			completed_at: nowIso
		};
		await prisma.aiModel.update({
			where: { id: input.modelId },
			data: {
				canonical_pack_status: "READY",
				onboarding_state: {
					...onboardingState,
					canonical_pack_error: null,
					canonical_pack_generation: {
						...generationState,
						...nextPackState
					},
					canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, packVersion, nextPackState)
				}
			}
		});
	}

	const replacementTarget = await findCanonicalCandidateReplacementTarget({
		modelId: input.modelId,
		packVersion,
		shotCode: input.shotCode,
		candidateId: input.candidateId,
		candidateIndex: input.candidateIndex
	});

	// Auto-increment candidate index if not provided
	let candidateIndex = replacementTarget?.candidate_index ?? input.candidateIndex;
	if (!candidateIndex) {
		const aggregate = await prisma.modelReferenceCandidate.aggregate({
			where: { model_id: input.modelId, pack_version: packVersion, shot_code: input.shotCode },
			_max: { candidate_index: true }
		});
		candidateIndex = (aggregate._max.candidate_index ?? 0) + 1;
	}

	const destinationPath = `${input.modelId}/canonical/v${packVersion}/${input.shotCode}/manual-candidate-${candidateIndex}-${Date.now()}.png`;

	const gcsUri = await withRetry({
		maxAttempts: CANONICAL_UPLOAD_MAX_ATTEMPTS,
		baseDelayMs: CANONICAL_UPLOAD_BASE_DELAY_MS,
		jitterMs: 400,
		shouldRetry: ({ error }) => (error ? isRetryableCanonicalError(error) : false),
		run: () =>
			uploadImageFromUriToModelBucket({
				sourceUri: input.imageDataUrl,
				destinationPath
			})
	});

	const shotPlan = buildCanonicalShotPlan({
		modelName: model.name,
		bodyProfile: asRecord(model.body_profile),
		faceProfile: asRecord(model.face_profile),
		imperfectionFingerprint: asRecordArray(model.imperfection_fingerprint)
	});

	const shotPrompt = shotPlan.find(s => s.shot_code === input.shotCode)?.prompt ?? "Manual upload canonical candidate";

	const score = await safeScoreCanonicalCandidate({
		imageUrl: input.imageDataUrl,
		shotCode: input.shotCode,
		shotPrompt
	});

	const candidateData = {
		model_id: input.modelId,
		pack_version: packVersion,
		shot_code: input.shotCode,
		candidate_index: candidateIndex,
		seed: randomInt(10_000, 999_999), // Just a dummy seed for manual uploads
		prompt_text: shotPrompt,
		image_gcs_uri: gcsUri,
		provider: "openai" as const, // Treat manual config as openai/gpu basically
		provider_model_id: "manual-upload",
		realism_score: score.realism_score,
		clarity_score: score.clarity_score,
		consistency_score: score.consistency_score,
		composite_score: score.composite_score,
		qa_notes: "Uploaded manually. " + (score.qa_notes ?? "")
	};

	const candidate = replacementTarget
		? await prisma.modelReferenceCandidate.update({
				where: { id: replacementTarget.id },
				data: candidateData
		  })
		: await prisma.modelReferenceCandidate.create({
				data: {
					...candidateData,
					status: "CANDIDATE"
				}
		  });

	if (replacementTarget) {
		await syncCanonicalReferenceForCandidate({
			modelId: input.modelId,
			packVersion,
			candidateId: replacementTarget.id,
			seed: candidateData.seed,
			promptText: candidateData.prompt_text,
			imageGcsUri: candidateData.image_gcs_uri,
			qaNotes: candidateData.qa_notes
		});
	}

	log({
		level: "info",
		service: "api",
		action: "canonical_candidate_uploaded",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.initiatedBy,
		metadata: {
			pack_version: packVersion,
			shot_code: input.shotCode,
			candidate_id: candidate.id
		}
	});

	return candidate;
}

export async function startCanonicalPackGeneration(input: {
	modelId: string;
	initiatedBy: string;
	provider: ImageModelProvider;
	providerModelId?: string;
	candidatesPerShot: number;
	generationMode?: CanonicalGenerationMode;
	packVersion?: number;
	shotCodes?: CanonicalShotCode[];
	replaceCandidateId?: string;
	regenerateExisting?: boolean;
	awaitCompletion?: boolean;
}): Promise<{ job_id: string; pack_version: number }> {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		include: {
			canonical_references: {
				where: {
					pack_version: {
						gt: 0
					}
				},
				orderBy: [{ pack_version: "desc" }, { sort_order: "asc" }]
			},
			source_references: {
				where: {
					status: "ACCEPTED"
				},
				orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
			},
			model_versions: {
				where: { is_active: true },
				take: 1
			}
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	if (input.provider === "gpu" && model.model_versions.length === 0) {
		throw new ApiError(400, "VALIDATION_ERROR", "This Model has no active version for GPU image creation. Use another Image Engine or activate a version.");
	}

	const requestedGenerationMode = input.generationMode ?? "front_only";
	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const activeGenerationState = readCanonicalGenerationState(onboardingState);
	const staleFromState = model.canonical_pack_status === "GENERATING" ? isCanonicalGenerationStateStale(activeGenerationState) : false;
	const staleFromModelUpdatedAt = model.canonical_pack_status === "GENERATING" && !activeGenerationState ? Date.now() - new Date(model.updated_at).getTime() > CANONICAL_JOB_STALE_MS : false;
	const staleGeneration = staleFromState || staleFromModelUpdatedAt;

	if (model.canonical_pack_status === "GENERATING" && !staleGeneration) {
		const existingJobId = activeGenerationState?.job_id;
		const existingPackVersion = activeGenerationState?.pack_version;
		if (existingJobId && existingPackVersion) {
			log({
				level: "info",
				service: "api",
				action: "canonical_pack_generation_reused",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: {
					job_id: existingJobId,
					pack_version: existingPackVersion,
					generation_mode: activeGenerationState.generation_mode
				}
			});

			return {
				job_id: existingJobId,
				pack_version: existingPackVersion
			};
		}

		throw new ApiError(
			409,
			"CONFLICT",
			existingPackVersion ? `Reference Set creation is already running for set v${existingPackVersion}. Wait for it to finish, then try again.` : "Reference Set creation is already running for this Model. Please wait for it to finish.",
			{
				active_job_id: activeGenerationState?.job_id,
				pack_version: existingPackVersion
			}
		);
	}

	const maxCandidatePack = await prisma.modelReferenceCandidate.aggregate({
		where: { model_id: input.modelId },
		_max: { pack_version: true }
	});
	const trackedPackVersions = Object.keys(readCanonicalPackStateMap(onboardingState))
		.map(value => Number(value))
		.filter(value => Number.isInteger(value) && value > 0);
	const latestTrackedPackVersion = trackedPackVersions.length > 0 ? Math.max(...trackedPackVersions) : 0;
	const requestedPackVersion = input.packVersion ?? 0;
	const resumeExistingPack = requestedPackVersion > 0;
	const latestKnownPackVersion = Math.max(
		model.active_canonical_pack_version,
		maxCandidatePack._max.pack_version ?? 0,
		activeGenerationState?.pack_version ?? 0,
		latestTrackedPackVersion
	);
	const storedGenerationForPack =
		activeGenerationState?.pack_version === requestedPackVersion ? activeGenerationState : readCanonicalPackState(onboardingState, requestedPackVersion);
	const generationMode = resumeExistingPack && storedGenerationForPack?.generation_mode ? storedGenerationForPack.generation_mode : requestedGenerationMode;
	let selectedFrontCandidateUri: string | undefined;
	const packVersion = resumeExistingPack ? requestedPackVersion : Math.max(model.active_canonical_pack_version, maxCandidatePack._max.pack_version ?? 0, latestTrackedPackVersion) + 1;

	if (resumeExistingPack && latestKnownPackVersion > 0 && requestedPackVersion > latestKnownPackVersion) {
		throw new ApiError(400, "VALIDATION_ERROR", "This Reference Set version could not be found. Refresh and try again.");
	}

	if (generationMode === "remaining") {
		if (packVersion <= 0) {
			throw new ApiError(400, "VALIDATION_ERROR", "A valid set version is required before creating remaining looks. Refresh and try again.");
		}

		const selectedFrontCandidate = await prisma.modelReferenceCandidate.findFirst({
			where: {
				model_id: input.modelId,
				pack_version: packVersion,
				shot_code: FRONT_CANONICAL_SHOT_CODE,
				status: "SELECTED"
			},
			select: {
				image_gcs_uri: true
			}
		});

		if (!selectedFrontCandidate?.image_gcs_uri) {
			throw new ApiError(400, "VALIDATION_ERROR", "Front look approval is required before creating remaining looks. Approve a front look option and try again.");
		}

		selectedFrontCandidateUri = selectedFrontCandidate.image_gcs_uri;
	}

	const photoImportReviews = readPhotoImportImageReviews(onboardingState);
	const conditioningReferencePool =
		resumeExistingPack && storedGenerationForPack?.reference_pool && storedGenerationForPack.reference_pool.length > 0
			? storedGenerationForPack.reference_pool
			: buildCanonicalConditioningReferencePool({
					selectedFrontCandidateUri,
					canonicalReferences: model.canonical_references.map(item => ({
						url: item.reference_image_url,
						shotCode: normalizeCanonicalShotCode(item.shot_code)
					})),
					sourceReferences: (model.source_references ?? []).map(item => ({
						id: item.id,
						url: item.image_gcs_uri,
						fileName: item.file_name,
						sortOrder: item.sort_order
					})),
					photoImportReviews
			  });
	const requestedCandidatesPerShot = Math.max(1, Math.min(5, Math.trunc(input.candidatesPerShot || 1)));
	const effectiveCandidatesPerShot = resumeExistingPack && storedGenerationForPack?.candidates_per_shot ? storedGenerationForPack.candidates_per_shot : requestedCandidatesPerShot;
	const requestedProvider = resumeExistingPack && storedGenerationForPack?.provider ? storedGenerationForPack.provider : input.provider;
	const requestedProviderModelId =
		resumeExistingPack && storedGenerationForPack?.provider_model_id ? storedGenerationForPack.provider_model_id : input.providerModelId;
	const shotCodes = normalizeRequestedCanonicalShotCodes(input.shotCodes);
	const storedShotCodes = resolveTrackedCanonicalShotCodes(storedGenerationForPack);
	const targetShotCodes = shotCodes.length > 0 ? shotCodes : storedShotCodes.length > 0 ? storedShotCodes : resolveShotCodesForGenerationMode(generationMode);
	if (input.replaceCandidateId && targetShotCodes.length !== 1) {
		throw new ApiError(400, "VALIDATION_ERROR", "Replacing an existing reference only works for a single angle at a time.");
	}
	const effectiveProviderSelection = resolveCanonicalGenerationProviderSelection({
		requestedProvider,
		requestedModelId: requestedProviderModelId,
		conditioningReferenceCount: conditioningReferencePool.length
	});

	const jobId = randomUUID();
	const nowIso = new Date().toISOString();
	const generationPayload: CanonicalGenerationState = {
		...activeGenerationState,
		job_id: jobId,
		pack_version: packVersion,
		provider: effectiveProviderSelection.provider,
		provider_model_id: effectiveProviderSelection.providerModelId,
		generation_mode: generationMode,
		status: "GENERATING",
		error: null,
		started_at: nowIso,
		heartbeat_at: nowIso,
		completed_at: undefined,
		completed_shots: 0,
		total_shots: targetShotCodes.length,
		failed_shots: 0,
		candidates_per_shot: effectiveCandidatesPerShot,
		shot_codes: targetShotCodes,
		reference_pool: conditioningReferencePool
	};
	const onboardingStateForGeneration = {
		...onboardingState,
		canonical_pack_error: null,
		canonical_pack_generation: generationPayload,
		canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, packVersion, generationPayload)
	};

	if (model.canonical_pack_status === "GENERATING" && staleGeneration) {
		await prisma.aiModel.update({
			where: { id: input.modelId },
			data: {
				canonical_pack_status: "GENERATING",
				onboarding_state: onboardingStateForGeneration
			}
		});
	} else {
		const lock = await prisma.aiModel.updateMany({
			where: {
				id: input.modelId,
				canonical_pack_status: {
					not: "GENERATING"
				}
			},
			data: {
				canonical_pack_status: "GENERATING",
				onboarding_state: onboardingStateForGeneration
			}
		});

		if (lock.count === 0) {
			throw new ApiError(409, "CONFLICT", "Reference Set creation is already running for this Model. Please wait for it to finish.");
		}
	}

	log({
		level: "info",
		service: "api",
		action: "canonical_pack_generation_started",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.initiatedBy,
		metadata: {
			pack_version: packVersion,
			provider: effectiveProviderSelection.provider,
			requested_provider: requestedProvider,
			candidates_per_shot: effectiveCandidatesPerShot,
			generation_mode: generationMode,
			job_id: jobId,
			resume_existing_pack: resumeExistingPack,
			regenerate_existing: input.regenerateExisting === true,
			stale_takeover: model.canonical_pack_status === "GENERATING" && staleGeneration,
			conditioning_reference_count: conditioningReferencePool.length
		}
	});

	const generationRequest = {
		...input,
		provider: effectiveProviderSelection.provider,
		providerModelId: effectiveProviderSelection.providerModelId,
		candidatesPerShot: effectiveCandidatesPerShot,
		packVersion,
		jobId,
		modelName: model.name,
		bodyProfile: asRecord(model.body_profile),
		faceProfile: asRecord(model.face_profile),
		imperfectionFingerprint: asRecordArray(model.imperfection_fingerprint),
		referencePool: conditioningReferencePool,
		shotCodes: targetShotCodes,
		replaceCandidateId: input.replaceCandidateId,
		generationMode,
		regenerateExisting: input.regenerateExisting === true
	};

	if (input.awaitCompletion) {
		await generateCanonicalPackInternal(generationRequest);
	} else {
		// Fire-and-persist generation asynchronously to keep API responsive.
		void generateCanonicalPackInternal(generationRequest);
	}

	return {
		job_id: jobId,
		pack_version: packVersion
	};
}

export function resolveCanonicalGenerationProviderSelection(input: {
	requestedProvider: ImageModelProvider;
	requestedModelId?: string;
	conditioningReferenceCount: number;
}): { provider: ImageModelProvider; providerModelId?: string } {
	const requestedModelId = input.requestedModelId?.trim();

	// Z.AI GLM generation is text-only in this app, so it cannot preserve identity
	// from uploaded reference photos. Route canonical jobs with references through
	// an image-conditioned provider instead.
	if (input.conditioningReferenceCount > 0 && input.requestedProvider === "zai_glm") {
		return {
			provider: "nano_banana_2"
		};
	}

	return {
		provider: input.requestedProvider,
		providerModelId: requestedModelId && requestedModelId.length > 0 ? requestedModelId : undefined
	};
}

async function generateCanonicalPackInternal(input: {
	modelId: string;
	initiatedBy: string;
	provider: ImageModelProvider;
	providerModelId?: string;
	candidatesPerShot: number;
	packVersion: number;
	jobId: string;
	modelName: string;
	bodyProfile: Record<string, unknown> | null;
	faceProfile: Record<string, unknown> | null;
	imperfectionFingerprint: Array<Record<string, unknown>> | null;
	referencePool: CanonicalConditioningReference[];
	shotCodes: CanonicalShotCode[];
	replaceCandidateId?: string;
	generationMode: CanonicalGenerationMode;
	regenerateExisting: boolean;
}) {
	let completedShots = 0;
	let totalShots: number = input.shotCodes.length;
	let lastErrorRequestId: string | undefined;

	try {
		const isCurrentJob = await ensureCanonicalJobStillCurrent(input.modelId, input.jobId);
		if (!isCurrentJob) {
			log({
				level: "warn",
				service: "api",
				action: "canonical_pack_generation_superseded",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: { job_id: input.jobId, pack_version: input.packVersion }
			});
			return;
		}

		const env = getEnv();
		const fullShotPlan = buildCanonicalShotPlan({
			modelName: input.modelName,
			bodyProfile: input.bodyProfile,
			faceProfile: input.faceProfile,
			imperfectionFingerprint: input.imperfectionFingerprint
		});
		const shotPlanByCode = new Map(fullShotPlan.map(shot => [shot.shot_code, shot] as const));
		const shotPlan = input.shotCodes.flatMap(shotCode => {
			const shot = shotPlanByCode.get(shotCode);
			return shot ? [shot] : [];
		});
		totalShots = shotPlan.length;
		if (totalShots === 0) {
			throw new ApiError(400, "VALIDATION_ERROR", "This generation mode has no available reference angles. Choose a different mode and try again.");
		}
		const preferredProviderModelId = resolveProviderModelId(input.provider, env, input.providerModelId);
		const resolvedReferencePool = await resolveCanonicalConditioningReferenceInputs(input.referencePool);
		if (input.referencePool.length > 0 && resolvedReferencePool.length === 0) {
			log({
				level: "warn",
				service: "api",
				action: "canonical_reference_resolution_empty",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: {
					provided_reference_count: input.referencePool.length,
					resolved_reference_count: resolvedReferencePool.length,
					mode: "text_only_fallback"
				}
			});
		}
		const completedShotCodes = await listCompletedCanonicalShotCodes({
			modelId: input.modelId,
			packVersion: input.packVersion,
			shotCodes: shotPlan.map(shot => shot.shot_code)
		});
		const pendingShotPlan = input.regenerateExisting ? shotPlan : shotPlan.filter(shot => !completedShotCodes.has(shot.shot_code));
		completedShots = input.regenerateExisting ? 0 : shotPlan.filter(shot => completedShotCodes.has(shot.shot_code)).length;
		const shotErrors: string[] = [];

		if (completedShots > 0) {
			log({
				level: "info",
				service: "api",
				action: "canonical_pack_generation_resumed",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: {
					pack_version: input.packVersion,
					job_id: input.jobId,
					completed_shots: completedShots,
					pending_shots: pendingShotPlan.length,
					total_shots: totalShots
				}
			});
		}

		await updateCanonicalGenerationState({
			modelId: input.modelId,
			jobId: input.jobId,
			packVersion: input.packVersion,
			generationMode: input.generationMode,
			shotCodes: input.shotCodes,
			status: "GENERATING",
			provider: input.provider,
			providerModelId: preferredProviderModelId,
			completedShots,
			totalShots,
			failedShots: 0,
			error: null,
			candidatesPerShot: input.candidatesPerShot,
			referencePool: input.referencePool
		});

		for (let shotIndex = 0; shotIndex < pendingShotPlan.length; shotIndex += 1) {
			const shot = pendingShotPlan[shotIndex]!;
			const replacementTarget =
				input.replaceCandidateId && pendingShotPlan.length === 1
					? await findCanonicalCandidateReplacementTarget({
							modelId: input.modelId,
							packVersion: input.packVersion,
							shotCode: shot.shot_code,
							candidateId: input.replaceCandidateId
					  })
					: null;

			// Rate-limit delay between shots (skip for first shot)
			if (shotIndex > 0) {
				await sleep(CANONICAL_SHOT_DELAY_MS);
			}

			const stillCurrent = await ensureCanonicalJobStillCurrent(input.modelId, input.jobId);
			if (!stillCurrent) {
				log({
					level: "warn",
					service: "api",
					action: "canonical_pack_generation_superseded",
					entity_type: "ai_model",
					entity_id: input.modelId,
					user_id: input.initiatedBy,
					metadata: {
						shot_code: shot.shot_code,
						job_id: input.jobId,
						pack_version: input.packVersion
					}
				});
				return;
			}

			try {
				const shotReferences = buildShotConditioningReferences({
					shotCode: shot.shot_code,
					referencePool: resolvedReferencePool,
					generationMode: input.generationMode
				});
				const seedBase = randomInt(10_000, 999_999);
				const seeds = Array.from({ length: input.candidatesPerShot }, (_, index) => seedBase + index * 37);
				const response = await withRetry({
					maxAttempts: CANONICAL_SHOT_MAX_ATTEMPTS,
					baseDelayMs: CANONICAL_RETRY_BASE_DELAY_MS,
					jitterMs: 400,
					shouldRetry: ({ error }) => (error ? isRetryableCanonicalError(error) : false),
					onRetry: ({ nextAttempt, maxAttempts, delayMs, error }) => {
						log({
							level: "warn",
							service: "api",
							action: "canonical_shot_retry_scheduled",
							entity_type: "ai_model",
							entity_id: input.modelId,
							user_id: input.initiatedBy,
							error: error instanceof Error ? error.message : String(error),
							metadata: {
								pack_version: input.packVersion,
								shot_code: shot.shot_code,
								attempt: nextAttempt,
								max_attempts: maxAttempts,
								retry_in_ms: Math.round(delayMs)
							}
						});
					},
					run: () =>
						withTimeout(
							generateShotWithFallback({
								provider: input.provider,
								env,
								requestedModelId: input.providerModelId,
								jobId: `${input.jobId}_${shot.shot_code}`,
								prompt: shot.prompt,
								seeds,
								outputPathPrefix: `${input.modelId}/canonical/v${input.packVersion}/${shot.shot_code}/`,
								references: shotReferences
							}),
							CANONICAL_SHOT_TIMEOUT_MS,
							`Shot ${shot.shot_code} timed out`
						)
				});

				const assets = (response.assets ?? []).slice(0, input.candidatesPerShot);
				if (assets.length === 0) {
					throw new ApiError(502, "INTERNAL_ERROR", "The Image Engine returned no images. Try again or switch Image Engines.");
				}

				let candidateIndex = replacementTarget?.candidate_index ?? (await nextCandidateIndexForShot(input.modelId, input.packVersion, shot.shot_code));
				let persistedCandidates = 0;

				for (let assetIndex = 0; assetIndex < assets.length; assetIndex += 1) {
					const asset = assets[assetIndex]!;
					const replacementForAsset = assetIndex === 0 ? replacementTarget : null;
					const assignedCandidateIndex = replacementForAsset?.candidate_index ?? candidateIndex;
					if (!replacementForAsset) {
						candidateIndex += 1;
					}

					try {
						const destinationPath = `${input.modelId}/canonical/v${input.packVersion}/${shot.shot_code}/candidate-${assignedCandidateIndex}-${Date.now()}.png`;
						let gcsUri = asset.uri;

						try {
							gcsUri = await withRetry({
								maxAttempts: CANONICAL_UPLOAD_MAX_ATTEMPTS,
								baseDelayMs: CANONICAL_UPLOAD_BASE_DELAY_MS,
								jitterMs: 400,
								shouldRetry: ({ error }) => (error ? isRetryableCanonicalError(error) : false),
								run: () =>
									uploadImageFromUriToModelBucket({
										sourceUri: asset.uri,
										destinationPath
									})
							});
						} catch (uploadError) {
							if (process.env.NODE_ENV === "production") {
								throw uploadError;
							}

							log({
								level: "warn",
								service: "api",
								action: "canonical_candidate_upload_fallback",
								entity_type: "ai_model",
								entity_id: input.modelId,
								user_id: input.initiatedBy,
								error: uploadError instanceof Error ? uploadError.message : "Unknown GCS upload failure",
								metadata: {
									pack_version: input.packVersion,
									shot_code: shot.shot_code,
									destination_path: destinationPath,
									fallback: "source_uri"
								}
							});
						}

						const score = await safeScoreCanonicalCandidate({
							imageUrl: asset.uri,
							shotCode: shot.shot_code,
							shotPrompt: shot.prompt,
							referenceImageUrls: shotReferences.map(reference => reference.url).slice(0, MAX_QA_REFERENCE_IMAGES)
						});

						const candidateData = {
							model_id: input.modelId,
							pack_version: input.packVersion,
							shot_code: shot.shot_code,
							candidate_index: assignedCandidateIndex,
							seed: asset.seed,
							prompt_text: shot.prompt,
							image_gcs_uri: gcsUri,
							provider: response.provider,
							provider_model_id: response.provider_model_id,
							realism_score: score.realism_score,
							clarity_score: score.clarity_score,
							consistency_score: score.consistency_score,
							composite_score: score.composite_score,
							qa_notes: score.qa_notes
						};

						if (replacementForAsset) {
							await prisma.modelReferenceCandidate.update({
								where: { id: replacementForAsset.id },
								data: candidateData
							});
							await syncCanonicalReferenceForCandidate({
								modelId: input.modelId,
								packVersion: input.packVersion,
								candidateId: replacementForAsset.id,
								seed: candidateData.seed,
								promptText: candidateData.prompt_text,
								imageGcsUri: candidateData.image_gcs_uri,
								qaNotes: candidateData.qa_notes
							});
						} else {
							await prisma.modelReferenceCandidate.create({
								data: {
									...candidateData,
									status: "CANDIDATE"
								}
							});
						}

						persistedCandidates += 1;
					} catch (candidateError) {
						log({
							level: "warn",
							service: "api",
							action: "canonical_candidate_persist_failed",
							entity_type: "ai_model",
							entity_id: input.modelId,
							user_id: input.initiatedBy,
							error: candidateError instanceof Error ? candidateError.message : "Unknown candidate persist failure",
							metadata: {
								pack_version: input.packVersion,
								shot_code: shot.shot_code,
								candidate_index: assignedCandidateIndex
							}
						});
					}
				}

				if (persistedCandidates === 0) {
					throw new ApiError(502, "INTERNAL_ERROR", "No options were saved for this angle. Try again.");
				}

				completedShots += 1;
			} catch (shotError) {
				const shotMsg = shotError instanceof Error ? shotError.message : "Unknown shot error";
				const shotRequestId = extractProviderRequestId(shotError);
				if (shotRequestId) {
					lastErrorRequestId = shotRequestId;
				}
				shotErrors.push(`Shot ${shot.shot_code}: ${shotMsg}`);
				log({
					level: "warn",
					service: "api",
					action: "canonical_shot_failed",
					entity_type: "ai_model",
					entity_id: input.modelId,
					user_id: input.initiatedBy,
					error: shotMsg,
					metadata: {
						shot_code: shot.shot_code,
						pack_version: input.packVersion,
						shot_index: shotIndex,
						error_request_id: shotRequestId
					}
				});

				// If we hit a rate limit, add extra delay before next shot
				if (isRateLimitErrorMessage(shotMsg)) {
					await sleep(CANONICAL_RATE_LIMIT_DELAY_MS);
				}
			}

			const updateError = buildCanonicalFailureMessage({
				completedShots,
				totalShots,
				shotErrors
			});

			await updateCanonicalGenerationState({
				modelId: input.modelId,
				jobId: input.jobId,
				packVersion: input.packVersion,
				generationMode: input.generationMode,
				shotCodes: input.shotCodes,
				status: "GENERATING",
				provider: input.provider,
				providerModelId: preferredProviderModelId,
				completedShots,
				totalShots,
				failedShots: shotErrors.length,
				error: updateError,
				errorRequestId: updateError ? lastErrorRequestId : undefined
			});
		}

		if (completedShots === 0) {
			throw new ApiError(502, "INTERNAL_ERROR", buildAllFailedCanonicalErrorMessage({ completedShots, totalShots, shotErrors }));
		}

		const finalError = buildCanonicalFailureMessage({
			completedShots,
			totalShots,
			shotErrors
		});
		const persisted = await updateCanonicalGenerationState({
			modelId: input.modelId,
			jobId: input.jobId,
			packVersion: input.packVersion,
			generationMode: input.generationMode,
			shotCodes: input.shotCodes,
			status: "READY",
			provider: input.provider,
			providerModelId: preferredProviderModelId,
			completedShots,
			totalShots,
			failedShots: shotErrors.length,
			error: finalError,
			errorRequestId: finalError ? lastErrorRequestId : undefined
		});

		if (!persisted) {
			log({
				level: "warn",
				service: "api",
				action: "canonical_pack_generation_superseded",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: {
					pack_version: input.packVersion,
					job_id: input.jobId,
					stage: "complete"
				}
			});
			return;
		}

		log({
			level: "info",
			service: "api",
			action: "canonical_pack_generation_completed",
			entity_type: "ai_model",
			entity_id: input.modelId,
			user_id: input.initiatedBy,
			metadata: {
				pack_version: input.packVersion,
				job_id: input.jobId,
				completed_shots: completedShots,
				total_shots: shotPlan.length,
				generation_mode: input.generationMode,
				errors: shotErrors.length > 0 ? shotErrors : undefined
			}
		});
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : "Unknown canonical generation error";
		const errorRequestId = extractProviderRequestId(error) ?? lastErrorRequestId;
		const persisted = await updateCanonicalGenerationState({
			modelId: input.modelId,
			jobId: input.jobId,
			packVersion: input.packVersion,
			generationMode: input.generationMode,
			shotCodes: input.shotCodes,
			status: "FAILED",
			provider: input.provider,
			providerModelId: input.providerModelId,
			completedShots,
			totalShots,
			failedShots: Math.max(totalShots - completedShots, 1),
			error: errorMessage,
			errorRequestId
		});

		if (!persisted) {
			log({
				level: "warn",
				service: "api",
				action: "canonical_pack_generation_superseded",
				entity_type: "ai_model",
				entity_id: input.modelId,
				user_id: input.initiatedBy,
				metadata: {
					pack_version: input.packVersion,
					job_id: input.jobId,
					stage: "failed"
				}
			});
			return;
		}

		log({
			level: "error",
			service: "api",
			action: "canonical_pack_generation_failed",
			entity_type: "ai_model",
			entity_id: input.modelId,
			user_id: input.initiatedBy,
			error: errorMessage,
			metadata: {
				pack_version: input.packVersion,
				job_id: input.jobId,
				generation_mode: input.generationMode,
				error_request_id: errorRequestId
			}
		});
	}
}

export async function getCanonicalPackSummary(input: { modelId: string; packVersion?: number }) {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			canonical_pack_status: true,
			active_canonical_pack_version: true,
			onboarding_state: true
		}
	});
	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const generationState = readCanonicalGenerationState(onboardingState);

	const latestCandidatePack = await latestPackVersion(input.modelId);
	const packVersion = inferPackVersion({
		requestedPackVersion: input.packVersion,
		activePackVersion: model.active_canonical_pack_version,
		latestCandidatePackVersion: latestCandidatePack,
		generationPackVersion: generationState?.pack_version
	});
	const storedPackState = readCanonicalPackState(onboardingState, packVersion);
	let effectiveGenerationState = generationState?.pack_version === packVersion ? generationState : storedPackState;
	let effectiveStatus =
		generationState?.pack_version === packVersion ? model.canonical_pack_status : effectiveGenerationState?.status ?? model.canonical_pack_status;
	let effectiveError =
		generationState?.pack_version === packVersion
			? typeof onboardingState.canonical_pack_error === "string"
				? onboardingState.canonical_pack_error
				: null
			: effectiveGenerationState?.error ?? null;
	let effectiveErrorRequestId = effectiveGenerationState?.error_request_id;
	const staleGeneration =
		generationState?.pack_version === packVersion && effectiveStatus === "GENERATING" && isCanonicalGenerationStateStale(generationState);

	if (!packVersion || packVersion <= 0) {
		return {
			pack_version: 0,
			status: effectiveStatus,
			error: effectiveError,
			error_request_id: effectiveErrorRequestId,
			shots: REQUIRED_CANONICAL_SHOT_CODES.map(shot => ({
				shot_code: shot,
				recommended_candidate_id: undefined,
				candidates: []
			}))
		};
	}

	const candidates = await prisma.modelReferenceCandidate.findMany({
		where: {
			model_id: input.modelId,
			pack_version: packVersion
		},
		orderBy: [{ shot_code: "asc" }, { composite_score: "desc" }, { candidate_index: "asc" }]
	});

	// D1 fix: resolve signed URLs for unique GCS URIs only (avoids N+1 GCS calls)
	const uniqueUris = [...new Set(candidates.map(c => c.image_gcs_uri))];
	const resolvedUrlMap = new Map<string, string | null>();
	await mapWithConcurrency(uniqueUris, 12, async uri => {
		resolvedUrlMap.set(uri, await resolveCandidatePreviewUrl(uri));
	});
	const candidatesWithPreview = candidates.map(candidate => ({
		...candidate,
		preview_image_url: resolvedUrlMap.get(candidate.image_gcs_uri) ?? null
	}));

	const grouped = REQUIRED_CANONICAL_SHOT_CODES.map(shotCode => {
		const shotCandidates = candidatesWithPreview.filter(item => item.shot_code === shotCode);
		const recommended = [...shotCandidates].sort((a, b) => Number(b.composite_score ?? 0) - Number(a.composite_score ?? 0))[0];

		return {
			shot_code: shotCode,
			recommended_candidate_id: recommended?.id,
			candidates: shotCandidates
		};
	});
	const completedShots = grouped.filter(shot => shot.candidates.length > 0).length;
	const totalShots = REQUIRED_CANONICAL_SHOT_CODES.length;
	const completedShotCodes = new Set(
		grouped.filter(shot => shot.candidates.length > 0).map(shot => shot.shot_code as CanonicalShotCode)
	);
	const initialGenerationProgressMatchesPack = effectiveGenerationState?.pack_version === packVersion;
	const initialTrackedShotCodes = initialGenerationProgressMatchesPack ? resolveTrackedCanonicalShotCodes(effectiveGenerationState) : [];

	if (staleGeneration) {
		const staleRecovery = buildCanonicalStaleRecovery({
			generationState,
			completedShotCodes,
			fallbackTotalShots: totalShots
		});

		if (staleRecovery) {
			const staleTakeover = await prisma.aiModel.updateMany({
				where: {
					id: input.modelId,
					canonical_pack_status: "GENERATING"
				},
				data: {
					canonical_pack_status: staleRecovery.status,
					onboarding_state: {
						...onboardingState,
						canonical_pack_error: staleRecovery.error,
						canonical_pack_generation: staleRecovery.generationState,
						canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, packVersion, {
							...staleRecovery.generationState,
							error: staleRecovery.error
						})
					}
				}
			});

			if (staleTakeover.count > 0) {
				effectiveStatus = staleRecovery.status;
				effectiveError = staleRecovery.error;
				effectiveGenerationState = staleRecovery.generationState;
				effectiveErrorRequestId = staleRecovery.generationState?.error_request_id;
			}
		}
	}

	const generationProgressMatchesPack = effectiveGenerationState?.pack_version === packVersion;
	const trackedShotCodes = generationProgressMatchesPack ? resolveTrackedCanonicalShotCodes(effectiveGenerationState) : [];
	const completedTrackedShotCodes = trackedShotCodes.filter(shotCode => completedShotCodes.has(shotCode));
	const missingTrackedShotCodes = trackedShotCodes.filter(shotCode => !completedShotCodes.has(shotCode));
	const completedFromState = generationProgressMatchesPack ? effectiveGenerationState?.completed_shots : undefined;
	const totalFromState = generationProgressMatchesPack ? effectiveGenerationState?.total_shots : undefined;
	const resumeAvailable =
		generationProgressMatchesPack &&
		effectiveStatus !== "GENERATING" &&
		effectiveStatus !== "APPROVED" &&
		missingTrackedShotCodes.length > 0;
	const generationSummary =
		generationProgressMatchesPack && effectiveGenerationState
			? {
					mode: effectiveGenerationState.generation_mode,
					provider: effectiveGenerationState.provider,
					provider_model_id: effectiveGenerationState.provider_model_id,
					candidates_per_shot: effectiveGenerationState.candidates_per_shot,
					started_at: effectiveGenerationState.started_at,
					heartbeat_at: effectiveGenerationState.heartbeat_at,
					failed_shots: effectiveGenerationState.failed_shots,
					shot_codes: trackedShotCodes.length > 0 ? trackedShotCodes : initialTrackedShotCodes,
					resume_available: resumeAvailable,
					completed_shot_codes: completedTrackedShotCodes,
					missing_shot_codes: missingTrackedShotCodes
			  }
			: undefined;

	return {
		pack_version: packVersion,
		status: effectiveStatus,
		error: effectiveError,
		error_request_id: effectiveErrorRequestId,
		progress: {
			completed_shots: Math.max(completedShots, completedFromState ?? 0),
			total_shots: totalFromState && totalFromState > 0 ? totalFromState : totalShots,
			generated_candidates: candidatesWithPreview.length
		},
		generation: generationSummary,
		shots: grouped
	};
}

export async function listCanonicalPackHistory(input: { modelId: string }) {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			canonical_pack_status: true,
			active_canonical_pack_version: true,
			onboarding_state: true
		}
	});
	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const [candidates, canonicalReferences] = await Promise.all([
		prisma.modelReferenceCandidate.findMany({
			where: { model_id: input.modelId },
			select: {
				pack_version: true,
				shot_code: true,
				status: true,
				created_at: true
			}
		}),
		prisma.canonicalReference.findMany({
			where: { model_id: input.modelId },
			select: {
				pack_version: true,
				shot_code: true,
				created_at: true
			}
		})
	]);

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const generationState = readCanonicalGenerationState(onboardingState);
	const packVersions = Array.from(
		new Set(
			[
				...candidates.map(candidate => candidate.pack_version),
				...canonicalReferences.map(reference => reference.pack_version),
				model.active_canonical_pack_version,
				generationState?.pack_version ?? 0,
				...Object.keys(readCanonicalPackStateMap(onboardingState)).map(value => Number(value))
			].filter(packVersion => typeof packVersion === "number" && packVersion > 0)
		)
	).sort((a, b) => b - a);

	return packVersions.map(packVersion => {
		const packCandidates = candidates.filter(candidate => candidate.pack_version === packVersion);
		const packReferences = canonicalReferences.filter(reference => reference.pack_version === packVersion);
		const generatedShotCodes = Array.from(
			new Set(
				packCandidates
					.map(candidate => normalizeCanonicalShotCode(candidate.shot_code))
					.filter((shotCode): shotCode is CanonicalShotCode => Boolean(shotCode))
			)
		);
		const selectedShots = packCandidates.filter(candidate => candidate.status === "SELECTED").length;
		const hasFrontAnchor =
			packCandidates.some(candidate => candidate.status === "SELECTED" && candidate.shot_code === FRONT_CANONICAL_SHOT_CODE) ||
			packReferences.some(reference => reference.shot_code === FRONT_CANONICAL_SHOT_CODE);
		const lastUpdatedAt = [...packCandidates.map(candidate => candidate.created_at), ...packReferences.map(reference => reference.created_at)]
			.sort((a, b) => b.getTime() - a.getTime())[0]
			?.toISOString();
		const packState = generationState?.pack_version === packVersion ? generationState : readCanonicalPackState(onboardingState, packVersion);

		const status =
			generationState?.pack_version === packVersion
				? model.canonical_pack_status
				: packState?.status
					? packState.status
				: packReferences.length >= REQUIRED_CANONICAL_SHOT_CODES.length
					? "APPROVED"
					: generatedShotCodes.length > 0 || packReferences.length > 0
						? "READY"
						: "NOT_STARTED";

		return {
			pack_version: packVersion,
			status,
			is_active: model.active_canonical_pack_version === packVersion,
			generated_shots: generatedShotCodes.length,
			generated_candidates: packCandidates.length,
			selected_shots: selectedShots,
			has_front_anchor: hasFrontAnchor,
			last_updated_at: lastUpdatedAt ?? null
		};
	});
}

export async function stopCanonicalPackGeneration(input: { modelId: string; stoppedBy: string }): Promise<{ pack_version: number; status: "READY" | "FAILED" }> {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			canonical_pack_status: true,
			onboarding_state: true
		}
	});
	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const generationState = readCanonicalGenerationState(onboardingState);
	if (model.canonical_pack_status !== "GENERATING" || !generationState?.job_id || !generationState.pack_version) {
		throw new ApiError(409, "CONFLICT", "Reference generation is not currently running.");
	}

	const trackedShotCodes = resolveTrackedCanonicalShotCodes(generationState);
	const completedShotCodes = await listCompletedCanonicalShotCodes({
		modelId: input.modelId,
		packVersion: generationState.pack_version,
		shotCodes: trackedShotCodes
	});
	const completedShots = trackedShotCodes.filter(shotCode => completedShotCodes.has(shotCode)).length;
	const totalShots = generationState.total_shots ?? trackedShotCodes.length;
	const nextStatus: "READY" | "FAILED" = completedShots > 0 ? "READY" : "FAILED";
	const error =
		completedShots > 0
			? `Generation paused by user. ${completedShots}/${Math.max(totalShots, 1)} angles are already ready. Resume generation to continue from this set.`
			: "Generation stopped before any angles were saved. Resume generation to continue from this set.";
	const nowIso = new Date().toISOString();
	const stopToken = `stopped-${randomUUID()}`;
	const stoppedGenerationState: CanonicalGenerationState = {
		...generationState,
		job_id: stopToken,
		status: nextStatus,
		error,
		heartbeat_at: nowIso,
		completed_at: nowIso,
		completed_shots: completedShots,
		total_shots: totalShots,
		failed_shots: Math.max(totalShots - completedShots, 0)
	};

	await prisma.aiModel.update({
		where: { id: input.modelId },
		data: {
			canonical_pack_status: nextStatus,
			onboarding_state: {
				...onboardingState,
				canonical_pack_error: error,
				canonical_pack_generation: stoppedGenerationState,
				canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, generationState.pack_version, stoppedGenerationState)
			}
		}
	});

	log({
		level: "info",
		service: "api",
		action: "canonical_pack_generation_stopped",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.stoppedBy,
		metadata: {
			pack_version: generationState.pack_version,
			completed_shots: completedShots,
			total_shots: totalShots
		}
	});

	return {
		pack_version: generationState.pack_version,
		status: nextStatus
	};
}

export async function approveCanonicalPack(input: { modelId: string; packVersion: number; selections: Array<{ shot_code: string; candidate_id: string }>; approvedBy: string }) {
	validateSelectionShape(input.selections);

	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			id: true,
			status: true,
			body_profile: true,
			face_profile: true,
			onboarding_state: true
		}
	});

	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const candidates = await prisma.modelReferenceCandidate.findMany({
		where: {
			model_id: input.modelId,
			pack_version: input.packVersion
		}
	});

	for (const selection of input.selections) {
		const candidate = candidates.find(item => item.id === selection.candidate_id);
		if (!candidate) {
			throw new ApiError(400, "VALIDATION_ERROR", "One selected option is not valid for this Reference Set. Refresh and choose an option again.");
		}

		if (candidate.shot_code !== selection.shot_code) {
			throw new ApiError(400, "VALIDATION_ERROR", "A selected option does not match its angle. Refresh and choose one option for each angle.");
		}
	}

	const selectedIds = new Set(input.selections.map(item => item.candidate_id));
	const selectedCandidates = candidates.filter(item => selectedIds.has(item.id));
	const selectedCanonicalCount = selectedCandidates.length;
	const nowIso = new Date().toISOString();
	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const currentGenerationState = readCanonicalGenerationState(onboardingState);
	const approvedPackState: CanonicalGenerationState = {
		...(readCanonicalPackState(onboardingState, input.packVersion) ?? currentGenerationState ?? {}),
		pack_version: input.packVersion,
		status: "APPROVED",
		error: null,
		heartbeat_at: nowIso,
		completed_at: nowIso,
		completed_shots: REQUIRED_CANONICAL_SHOT_CODES.length,
		total_shots: REQUIRED_CANONICAL_SHOT_CODES.length,
		failed_shots: 0
	};

	await prisma.$transaction(async tx => {
		await tx.modelReferenceCandidate.updateMany({
			where: {
				model_id: input.modelId,
				pack_version: input.packVersion
			},
			data: {
				status: "REJECTED"
			}
		});

		await tx.modelReferenceCandidate.updateMany({
			where: {
				id: {
					in: Array.from(selectedIds)
				}
			},
			data: {
				status: "SELECTED"
			}
		});

		await tx.canonicalReference.deleteMany({
			where: {
				model_id: input.modelId,
				pack_version: input.packVersion
			}
		});

		await tx.canonicalReference.createMany({
			data: input.selections.map((selection, index) => {
				const candidate = selectedCandidates.find(item => item.id === selection.candidate_id);
				if (!candidate) {
					throw new ApiError(400, "VALIDATION_ERROR", "One selected option could not be found. Refresh and choose your options again.");
				}

				return {
					model_id: input.modelId,
					pack_version: input.packVersion,
					shot_code: selection.shot_code,
					source_candidate_id: selection.candidate_id,
					seed: candidate.seed,
					prompt_text: candidate.prompt_text,
					reference_image_url: candidate.image_gcs_uri,
					notes: candidate.qa_notes,
					sort_order: index
				};
			})
		});

		const nextStatus = deriveModelStatusForWorkflow(
			{
				...model,
				canonical_pack_status: "APPROVED",
				active_canonical_pack_version: input.packVersion
			},
			selectedCanonicalCount
		);

		await tx.aiModel.update({
			where: { id: input.modelId },
			data: {
				canonical_pack_status: "APPROVED",
				active_canonical_pack_version: input.packVersion,
				status: nextStatus,
				onboarding_state: {
					...onboardingState,
					canonical_pack_error: null,
					canonical_pack_generation: currentGenerationState?.pack_version === input.packVersion ? approvedPackState : currentGenerationState,
					canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, input.packVersion, approvedPackState)
				}
			}
		});
	});

	log({
		level: "info",
		service: "api",
		action: "canonical_pack_approved",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.approvedBy,
		metadata: {
			pack_version: input.packVersion,
			selected_count: selectedCanonicalCount
		}
	});
}

export async function approveCanonicalFrontCandidate(input: { modelId: string; packVersion: number; candidateId: string; approvedBy: string }) {
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

	const selectedCandidate = await prisma.modelReferenceCandidate.findFirst({
		where: {
			id: input.candidateId,
			model_id: input.modelId,
			pack_version: input.packVersion
		},
		select: {
			id: true,
			seed: true,
			prompt_text: true,
			image_gcs_uri: true,
			qa_notes: true,
			shot_code: true
		}
	});
	if (!selectedCandidate) {
		throw new ApiError(400, "VALIDATION_ERROR", "The selected front look option is not valid for this Reference Set. Refresh and choose a front option again.");
	}
	if (selectedCandidate.shot_code !== FRONT_CANONICAL_SHOT_CODE) {
		throw new ApiError(400, "VALIDATION_ERROR", "Front approval only works with the frontal closeup angle. Select a front look option and try again.");
	}

	await prisma.$transaction(async tx => {
		await tx.modelReferenceCandidate.updateMany({
			where: {
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: FRONT_CANONICAL_SHOT_CODE
			},
			data: {
				status: "REJECTED"
			}
		});

		await tx.modelReferenceCandidate.update({
			where: { id: selectedCandidate.id },
			data: {
				status: "SELECTED"
			}
		});

		await tx.canonicalReference.deleteMany({
			where: {
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: FRONT_CANONICAL_SHOT_CODE
			}
		});

		await tx.canonicalReference.create({
			data: {
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: FRONT_CANONICAL_SHOT_CODE,
				source_candidate_id: selectedCandidate.id,
				seed: selectedCandidate.seed,
				prompt_text: selectedCandidate.prompt_text,
				reference_image_url: selectedCandidate.image_gcs_uri,
				notes: selectedCandidate.qa_notes,
				sort_order: 0
			}
		});

		const onboardingState = asRecord(model.onboarding_state) ?? {};
		const currentGenerationState = readCanonicalGenerationState(onboardingState);
		const nowIso = new Date().toISOString();
		const readyPackState: CanonicalGenerationState = {
			...(readCanonicalPackState(onboardingState, input.packVersion) ?? currentGenerationState ?? {}),
			pack_version: input.packVersion,
			status: "READY",
			error: null,
			heartbeat_at: nowIso,
			completed_at: nowIso
		};
		await tx.aiModel.update({
			where: { id: input.modelId },
			data: {
				canonical_pack_status: "READY",
				onboarding_state: {
					...onboardingState,
					canonical_pack_error: null,
					canonical_pack_front_approved_at: nowIso,
					canonical_pack_generation: currentGenerationState?.pack_version === input.packVersion ? readyPackState : currentGenerationState,
					canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, input.packVersion, readyPackState)
				}
			}
		});
	});

	log({
		level: "info",
		service: "api",
		action: "canonical_pack_front_approved",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.approvedBy,
		metadata: {
			pack_version: input.packVersion,
			candidate_id: input.candidateId
		}
	});
}

export async function finalizeWorkflowModel(input: { modelId: string; finalizedBy: string }) {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		include: {
			model_versions: {
				where: { is_active: true },
				take: 1
			}
		}
	});
	if (!model) {
		throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
	}

	const selectedCanonicalCount = await prisma.canonicalReference.count({
		where: {
			model_id: input.modelId,
			pack_version: model.active_canonical_pack_version
		}
	});
	const acceptedImportedReferenceCount = await prisma.modelSourceReference.count({
		where: {
			model_id: input.modelId,
			status: "ACCEPTED"
		}
	});

	const nextStatus = deriveModelStatusForWorkflow(model, selectedCanonicalCount, acceptedImportedReferenceCount);

	const updated = await prisma.aiModel.update({
		where: { id: input.modelId },
		data: {
			status: nextStatus
		},
		include: {
			model_versions: {
				where: { is_active: true },
				take: 1
			}
		}
	});

	log({
		level: "info",
		service: "api",
		action: "model_workflow_finalized",
		entity_type: "ai_model",
		entity_id: input.modelId,
		user_id: input.finalizedBy,
		metadata: {
			status: updated.status,
			canonical_pack_status: updated.canonical_pack_status,
			active_pack_version: updated.active_canonical_pack_version
		}
	});

	return {
		model: updated,
		capabilities: buildModelCapabilityFlags(updated.model_versions.length > 0)
	};
}

async function latestPackVersion(modelId: string): Promise<number> {
	const aggregate = await prisma.modelReferenceCandidate.aggregate({
		where: {
			model_id: modelId
		},
		_max: {
			pack_version: true
		}
	});

	return aggregate._max.pack_version ?? 0;
}

async function nextCandidateIndexForShot(modelId: string, packVersion: number, shotCode: string): Promise<number> {
	const aggregate = await prisma.modelReferenceCandidate.aggregate({
		where: {
			model_id: modelId,
			pack_version: packVersion,
			shot_code: shotCode
		},
		_max: {
			candidate_index: true
		}
	});

	return (aggregate._max.candidate_index ?? 0) + 1;
}

async function findCanonicalCandidateReplacementTarget(input: {
	modelId: string;
	packVersion: number;
	shotCode: string;
	candidateId?: string;
	candidateIndex?: number;
}): Promise<{ id: string; candidate_index: number } | null> {
	if (input.candidateId) {
		const candidate = await prisma.modelReferenceCandidate.findFirst({
			where: {
				id: input.candidateId,
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: input.shotCode
			},
			select: {
				id: true,
				candidate_index: true
			}
		});

		if (!candidate) {
			throw new ApiError(
				400,
				"VALIDATION_ERROR",
				"This reference option could not be found in the current set. Refresh the set and try again."
			);
		}

		return candidate;
	}

	if (!input.candidateIndex) {
		return null;
	}

	return (
		(await prisma.modelReferenceCandidate.findFirst({
			where: {
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: input.shotCode,
				candidate_index: input.candidateIndex
			},
			orderBy: {
				created_at: "desc"
			},
			select: {
				id: true,
				candidate_index: true
			}
		})) ?? null
	);
}

async function syncCanonicalReferenceForCandidate(input: {
	modelId: string;
	packVersion: number;
	candidateId: string;
	seed: number;
	promptText: string;
	imageGcsUri: string;
	qaNotes?: string | null;
}): Promise<void> {
	await prisma.canonicalReference.updateMany({
		where: {
			model_id: input.modelId,
			pack_version: input.packVersion,
			source_candidate_id: input.candidateId
		},
		data: {
			seed: input.seed,
			prompt_text: input.promptText,
			reference_image_url: input.imageGcsUri,
			notes: input.qaNotes ?? null
		}
	});
}

async function listCompletedCanonicalShotCodes(input: {
	modelId: string;
	packVersion: number;
	shotCodes: CanonicalShotCode[];
}): Promise<Set<CanonicalShotCode>> {
	if (input.shotCodes.length === 0) {
		return new Set<CanonicalShotCode>();
	}

	const existingCandidates = await prisma.modelReferenceCandidate.findMany({
		where: {
			model_id: input.modelId,
			pack_version: input.packVersion,
			shot_code: {
				in: input.shotCodes
			}
		},
		select: {
			shot_code: true
		}
	});

	return new Set(
		existingCandidates
			.map(candidate => normalizeCanonicalShotCode(candidate.shot_code))
			.filter((shotCode): shotCode is CanonicalShotCode => Boolean(shotCode))
	);
}

async function safeScoreCanonicalCandidate(input: { imageUrl: string; shotCode: string; shotPrompt: string; referenceImageUrls?: string[] }) {
	try {
		return await withTimeout(scoreCanonicalCandidate(input), 60_000, `Scoring timed out for ${input.shotCode}`);
	} catch (error) {
		log({
			level: "warn",
			service: "api",
			action: "canonical_candidate_score_fallback",
			error: error instanceof Error ? error.message : "Unknown scoring failure",
			metadata: {
				shot_code: input.shotCode
			}
		});

		return {
			realism_score: 0.8,
			clarity_score: 0.8,
			consistency_score: 0.8,
			composite_score: 0.8,
			qa_notes: "Scoring fallback applied after QA service timeout/failure.",
			source: "heuristic" as const
		};
	}
}

function inferPackVersion(input: { requestedPackVersion?: number; activePackVersion: number; latestCandidatePackVersion: number; generationPackVersion?: number }): number {
	if (input.requestedPackVersion && input.requestedPackVersion > 0) {
		return input.requestedPackVersion;
	}

	const inferred = Math.max(input.activePackVersion, input.latestCandidatePackVersion, input.generationPackVersion ?? 0);
	return inferred > 0 ? inferred : 0;
}

function normalizeRequestedCanonicalShotCodes(shotCodes: CanonicalShotCode[] | undefined): CanonicalShotCode[] {
	if (!Array.isArray(shotCodes) || shotCodes.length === 0) {
		return [];
	}

	return Array.from(new Set(shotCodes.filter((shotCode): shotCode is CanonicalShotCode => REQUIRED_CANONICAL_SHOT_CODES.includes(shotCode))));
}

function resolveTrackedCanonicalShotCodes(state: CanonicalGenerationState | null | undefined): CanonicalShotCode[] {
	if (!state) return [];
	if (state.shot_codes && state.shot_codes.length > 0) {
		return state.shot_codes;
	}
	if (state.generation_mode) {
		return resolveShotCodesForGenerationMode(state.generation_mode);
	}
	return [];
}

function buildCanonicalStaleRecovery(input: {
	generationState: CanonicalGenerationState | null;
	completedShotCodes: Set<CanonicalShotCode>;
	fallbackTotalShots: number;
}): { status: "READY" | "FAILED"; error: string | null; generationState: CanonicalGenerationState } | null {
	if (!input.generationState) {
		return null;
	}

	const trackedShotCodes = resolveTrackedCanonicalShotCodes(input.generationState);
	const totalTrackedShots = trackedShotCodes.length || input.generationState.total_shots || input.fallbackTotalShots;
	const completedTrackedShotCodes = trackedShotCodes.filter(shotCode => input.completedShotCodes.has(shotCode));
	const completedTrackedCount = trackedShotCodes.length > 0 ? completedTrackedShotCodes.length : Math.min(input.completedShotCodes.size, totalTrackedShots);
	const missingTrackedCount = Math.max(totalTrackedShots - completedTrackedCount, 0);
	const nowIso = new Date().toISOString();

	let status: "READY" | "FAILED";
	let error: string | null;
	if (missingTrackedCount === 0 && completedTrackedCount > 0) {
		status = "READY";
		error = null;
	} else if (completedTrackedCount > 0) {
		status = "READY";
		error = `Generation paused after timing out. ${completedTrackedCount}/${totalTrackedShots} requested angles are already ready. Resume generation to continue without losing saved options.`;
	} else {
		status = "FAILED";
		error = `Canonical generation timed out after ${Math.round(CANONICAL_JOB_STALE_MS / 60_000)} minutes without heartbeat. Resume generation to continue from this set.`;
	}

	return {
		status,
		error,
		generationState: {
			...input.generationState,
			status,
			error,
			heartbeat_at: nowIso,
			completed_at: nowIso,
			completed_shots: completedTrackedCount,
			total_shots: totalTrackedShots,
			failed_shots: missingTrackedCount,
			shot_codes: trackedShotCodes.length > 0 ? trackedShotCodes : input.generationState.shot_codes
		}
	};
}

function buildCanonicalFailureMessage(input: { completedShots: number; totalShots: number; shotErrors: string[] }): string | null {
	if (input.shotErrors.length === 0) return null;

	const preview = input.shotErrors.slice(0, CANONICAL_ERROR_PREVIEW_LIMIT);
	const suffix = input.shotErrors.length > preview.length ? `; +${input.shotErrors.length - preview.length} more` : "";
	return `${input.completedShots}/${input.totalShots} shots completed. Failures: ${preview.join("; ")}${suffix}`;
}

export function buildAllFailedCanonicalErrorMessage(input: { completedShots: number; totalShots: number; shotErrors: string[] }): string {
	const detail = buildCanonicalFailureMessage(input);
	return detail ? `Reference Set creation failed for every angle. ${detail}` : "Reference Set creation failed for every angle. Try again or switch Image Engines.";
}

async function ensureCanonicalJobStillCurrent(modelId: string, jobId: string): Promise<boolean> {
	const model = await prisma.aiModel.findUnique({
		where: { id: modelId },
		select: {
			onboarding_state: true
		}
	});
	if (!model) return false;

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const generationState = readCanonicalGenerationState(onboardingState);
	if (!generationState?.job_id) return true;
	return generationState.job_id === jobId;
}

async function updateCanonicalGenerationState(input: {
	modelId: string;
	jobId: string;
	packVersion: number;
	generationMode: CanonicalGenerationMode;
	shotCodes: CanonicalShotCode[];
	status: "GENERATING" | "READY" | "FAILED";
	provider: ImageModelProvider;
	providerModelId?: string;
	completedShots: number;
	totalShots: number;
	failedShots: number;
	error: string | null;
	errorRequestId?: string;
	candidatesPerShot?: number;
	referencePool?: CanonicalConditioningReference[];
}): Promise<boolean> {
	const model = await prisma.aiModel.findUnique({
		where: { id: input.modelId },
		select: {
			onboarding_state: true
		}
	});
	if (!model) return false;

	const onboardingState = asRecord(model.onboarding_state) ?? {};
	const existingGeneration = readCanonicalGenerationState(onboardingState);
	if (existingGeneration?.job_id && existingGeneration.job_id !== input.jobId) {
		return false;
	}

	const nowIso = new Date().toISOString();
	const nextGeneration: CanonicalGenerationState = {
		...existingGeneration,
		job_id: input.jobId,
		pack_version: input.packVersion,
		provider: input.provider,
		provider_model_id: input.providerModelId?.trim() || existingGeneration?.provider_model_id,
		error_request_id: input.error ? input.errorRequestId?.trim() || undefined : undefined,
		generation_mode: input.generationMode,
		status: input.status,
		error: input.error,
		started_at: existingGeneration?.started_at ?? nowIso,
		heartbeat_at: nowIso,
		completed_at: input.status === "GENERATING" ? undefined : nowIso,
		completed_shots: input.completedShots,
		total_shots: input.totalShots,
		failed_shots: input.failedShots,
		candidates_per_shot: input.candidatesPerShot ?? existingGeneration?.candidates_per_shot,
		shot_codes: input.shotCodes,
		reference_pool: input.referencePool ?? existingGeneration?.reference_pool
	};

	await prisma.aiModel.update({
		where: { id: input.modelId },
		data: {
			canonical_pack_status: input.status,
			onboarding_state: {
				...onboardingState,
				canonical_pack_error: input.error,
				canonical_pack_generation: nextGeneration,
				canonical_pack_versions: upsertCanonicalPackStateMap(onboardingState, input.packVersion, nextGeneration)
			}
		}
	});

	return true;
}

function readCanonicalGenerationState(onboardingState: Record<string, unknown>): CanonicalGenerationState | null {
	return parseCanonicalGenerationState(onboardingState.canonical_pack_generation);
}

function parseCanonicalGenerationState(value: unknown): CanonicalGenerationState | null {
	const raw = asRecord(value);
	if (!raw) return null;

	return {
		job_id: readOptionalString(raw.job_id),
		pack_version: readOptionalPositiveInt(raw.pack_version),
		provider: asImageModelProvider(raw.provider),
		provider_model_id: readOptionalString(raw.provider_model_id),
		error_request_id: readOptionalString(raw.error_request_id),
		generation_mode: asCanonicalGenerationMode(raw.generation_mode),
		status: readCanonicalStatus(raw.status),
		error: typeof raw.error === "string" ? raw.error : raw.error === null ? null : undefined,
		started_at: readOptionalString(raw.started_at),
		heartbeat_at: readOptionalString(raw.heartbeat_at),
		completed_at: readOptionalString(raw.completed_at),
		completed_shots: readOptionalNonNegativeInt(raw.completed_shots),
		total_shots: readOptionalPositiveInt(raw.total_shots),
		failed_shots: readOptionalNonNegativeInt(raw.failed_shots),
		candidates_per_shot: readOptionalPositiveInt(raw.candidates_per_shot),
		shot_codes: readCanonicalShotCodes(raw.shot_codes),
		reference_pool: readCanonicalConditioningReferencePool(raw.reference_pool)
	};
}

function readCanonicalPackStateMap(onboardingState: Record<string, unknown>): Record<string, CanonicalGenerationState> {
	const raw = asRecord(onboardingState.canonical_pack_versions);
	if (!raw) {
		return {};
	}

	const packStates: Record<string, CanonicalGenerationState> = {};
	for (const [packVersion, state] of Object.entries(raw)) {
		const normalizedPackVersion = Number(packVersion);
		if (!Number.isInteger(normalizedPackVersion) || normalizedPackVersion <= 0) {
			continue;
		}

		const parsed = parseCanonicalGenerationState(state);
		if (!parsed) {
			continue;
		}

		packStates[String(normalizedPackVersion)] = {
			...parsed,
			pack_version: normalizedPackVersion
		};
	}

	return packStates;
}

function readCanonicalPackState(onboardingState: Record<string, unknown>, packVersion: number | undefined): CanonicalGenerationState | null {
	if (!packVersion || packVersion <= 0) {
		return null;
	}

	const packStates = readCanonicalPackStateMap(onboardingState);
	return packStates[String(packVersion)] ?? null;
}

function upsertCanonicalPackStateMap(
	onboardingState: Record<string, unknown>,
	packVersion: number,
	state: CanonicalGenerationState
): Record<string, CanonicalGenerationState> {
	const packStates = readCanonicalPackStateMap(onboardingState);
	return {
		...packStates,
		[String(packVersion)]: {
			...packStates[String(packVersion)],
			...state,
			pack_version: packVersion
		}
	};
}

function isCanonicalGenerationStateStale(state: CanonicalGenerationState | null | undefined): boolean {
	if (!state) return false;

	const heartbeat = state.heartbeat_at ?? state.started_at;
	if (!heartbeat) return false;

	const heartbeatMs = Date.parse(heartbeat);
	if (!Number.isFinite(heartbeatMs)) return false;

	return Date.now() - heartbeatMs > CANONICAL_JOB_STALE_MS;
}

function asImageModelProvider(value: unknown): ImageModelProvider | undefined {
	if (value === "gpu" || value === "openai" || value === "nano_banana_2" || value === "zai_glm") {
		return value;
	}
	return undefined;
}

function asCanonicalGenerationMode(value: unknown): CanonicalGenerationMode | undefined {
	if (value === "front_only" || value === "remaining" || value === "full") {
		return value;
	}
	return undefined;
}

function readCanonicalShotCodes(value: unknown): CanonicalShotCode[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const parsed = value.map(item => (typeof item === "string" ? item : "")).filter((item): item is CanonicalShotCode => REQUIRED_CANONICAL_SHOT_CODES.includes(item as CanonicalShotCode));
	return parsed.length > 0 ? Array.from(new Set(parsed)) : undefined;
}

function readCanonicalConditioningReferencePool(value: unknown): CanonicalConditioningReference[] | undefined {
	if (!Array.isArray(value)) return undefined;

	const parsed = value
		.map(item => {
			const raw = asRecord(item);
			if (!raw) return null;

			const url = readOptionalString(raw.url);
			const weight = raw.weight === "primary" || raw.weight === "secondary" ? raw.weight : undefined;
			const sourceKind =
				raw.source_kind === "selected_front_candidate" || raw.source_kind === "canonical_reference" || raw.source_kind === "uploaded_photo"
					? raw.source_kind
					: undefined;
			if (!url || !weight || !sourceKind) return null;

			const reference: CanonicalConditioningReference = {
				url,
				source: normalizeImageReferenceSource(raw.source),
				title: readOptionalString(raw.title),
				weight,
				similarity_score: readOptionalScore(raw.similarity_score),
				source_kind: sourceKind,
				canonical_shot_code: normalizeCanonicalShotCode(readOptionalString(raw.canonical_shot_code) ?? ""),
				view_angle: readPhotoReferenceViewAngle(raw.view_angle),
				framing: readPhotoReferenceFraming(raw.framing),
				expression: readPhotoReferenceExpression(raw.expression),
				identity_anchor_score: readOptionalScore(raw.identity_anchor_score),
				sharpness_score: readOptionalScore(raw.sharpness_score)
			};

			return reference;
		})
		.filter((item): item is CanonicalConditioningReference => Boolean(item));

	return parsed.length > 0 ? parsed : undefined;
}

function readCanonicalStatus(value: unknown): CanonicalGenerationState["status"] | undefined {
	if (value === "GENERATING" || value === "READY" || value === "FAILED" || value === "APPROVED") {
		return value;
	}
	return undefined;
}

function readOptionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readOptionalNonNegativeInt(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function readOptionalScore(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return clamp01(value);
	if (typeof value === "string") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return clamp01(parsed);
	}
	return undefined;
}

function readPhotoReferenceViewAngle(value: unknown): PhotoReferenceViewAngle | undefined {
	if (value === "frontal" || value === "left_45" || value === "right_45" || value === "left_profile" || value === "right_profile" || value === "unknown") {
		return value;
	}
	return undefined;
}

function readPhotoReferenceFraming(value: unknown): PhotoReferenceFraming | undefined {
	if (value === "closeup" || value === "head_shoulders" || value === "half_body" || value === "full_body" || value === "unknown") {
		return value;
	}
	return undefined;
}

function readPhotoReferenceExpression(value: unknown): PhotoReferenceExpression | undefined {
	if (value === "neutral" || value === "soft_smile" || value === "serious" || value === "other") {
		return value;
	}
	return undefined;
}

function normalizeImageReferenceSource(value: unknown): ImageReferenceInput["source"] | undefined {
	if (value === "external_url" || value === "pinterest_upload" || value === "pinterest_url") {
		return value;
	}
	return undefined;
}

function isRateLimitErrorMessage(message: string): boolean {
	const lower = message.toLowerCase();
	return lower.includes("429") || lower.includes("rate") || lower.includes("quota");
}

function extractProviderRequestId(error: unknown): string | undefined {
	if (!(error instanceof ApiError)) return undefined;

	const details = asRecord(error.details);
	const directRequestId = readOptionalString(details?.request_id);
	if (directRequestId) {
		return directRequestId;
	}

	const attempts = Array.isArray(details?.attempts) ? details.attempts : [];
	for (const attempt of attempts) {
		const requestId = readOptionalString(asRecord(attempt)?.request_id);
		if (requestId) {
			return requestId;
		}
	}

	return undefined;
}

function isRetryableCanonicalError(error: unknown): boolean {
	if (error instanceof ApiError) {
		if (error.status === 429 || (error.status >= 500 && error.status <= 504)) {
			return true;
		}

		const details = asRecord(error.details);
		const detailStatus = details?.status;
		if (typeof detailStatus === "number" && (detailStatus === 429 || (detailStatus >= 500 && detailStatus <= 504))) {
			return true;
		}
	}

	const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
	return (
		message.includes("429") ||
		message.includes("rate") ||
		message.includes("quota") ||
		message.includes("timeout") ||
		message.includes("timed out") ||
		message.includes("temporar") ||
		message.includes("econn") ||
		message.includes("socket") ||
		message.includes("network") ||
		message.includes("fetch failed") ||
		message.includes("503") ||
		message.includes("502") ||
		message.includes("504")
	);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			promise,
			new Promise<T>((_, reject) => {
				timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
			})
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

async function generateShotWithFallback(input: {
	provider: ImageModelProvider;
	env: ReturnType<typeof getEnv>;
	requestedModelId?: string;
	jobId: string;
	prompt: string;
	seeds: number[];
	outputPathPrefix: string;
	references: ImageReferenceInput[];
}): Promise<{
	provider: ImageModelProvider;
	provider_model_id: string;
	assets?: Array<{
		uri: string;
		seed: number;
		width: number;
		height: number;
		generation_time_ms: number;
	}>;
}> {
	const references = input.references;

	const runGenerate = async (provider: ImageModelProvider) => {
		const providerModelId = resolveProviderModelId(provider, input.env, provider === input.provider ? input.requestedModelId : undefined);
		const result = await getImageProvider(provider).generate({
			job_id: input.jobId,
			model_provider: provider,
			model_id: providerModelId,
			prompt_text: input.prompt,
			negative_prompt: "deformed anatomy, blurry face, low detail, watermark, stylized anime look, plastic skin",
			width: 1024,
			height: 1024,
			batch_size: input.seeds.length,
			seeds: input.seeds,
			upscale: false,
			output_path_prefix: input.outputPathPrefix,
			model_config: {
				base_model: providerModelId
			},
			creative_controls: createDefaultCreativeControls(),
			references
		});

		return {
			provider,
			provider_model_id: providerModelId,
			assets: result.assets
		};
	};

	const providerOrder = buildCanonicalShotProviderOrder({
		requestedProvider: input.provider,
		referenceCount: references.length
	});

	let lastError: unknown;
	for (const provider of providerOrder) {
		try {
			const generated = await runGenerate(provider);
			if ((generated.assets ?? []).length === 0) {
				throw new ApiError(502, "INTERNAL_ERROR", "The Image Engine returned no images. Try again or switch Image Engines.");
			}

			return generated;
		} catch (error) {
			lastError = error;
			const hasFallback = provider !== providerOrder[providerOrder.length - 1];
			if (!hasFallback) {
				throw error;
			}
		}
	}

	if (lastError) {
		throw lastError;
	}
	throw new ApiError(502, "INTERNAL_ERROR", "We couldn't create the Reference Set images. Please try again.");
}

export function buildCanonicalShotProviderOrder(input: {
	requestedProvider: ImageModelProvider;
	referenceCount: number;
}): ImageModelProvider[] {
	if (input.requestedProvider === "openai") {
		return ["openai", "nano_banana_2"];
	}

	if (input.requestedProvider === "zai_glm") {
		return ["zai_glm", "nano_banana_2"];
	}

	// Nano is the default canonical engine, but OpenAI edits are a better recovery
	// path for identity-conditioned shots when Gemini returns text-only responses.
	if (input.requestedProvider === "nano_banana_2") {
		return input.referenceCount > 0 ? ["nano_banana_2", "openai"] : ["nano_banana_2"];
	}

	return [input.requestedProvider];
}

function resolveProviderModelId(provider: ImageModelProvider, env: ReturnType<typeof getEnv>, requestedModelId?: string): string {
	if (requestedModelId && requestedModelId.trim().length > 0) {
		return requestedModelId.trim();
	}

	if (provider === "openai") return env.OPENAI_IMAGE_MODEL;
	if (provider === "nano_banana_2") return env.NANO_BANANA_MODEL;
	if (provider === "zai_glm") return env.ZAI_IMAGE_MODEL;
	return "sdxl-1.0";
}

export function buildCanonicalConditioningReferences(input: { canonicalReferences: string[]; sourceReferences: string[] }): string[] {
	const deduped: string[] = [];
	const seen = new Set<string>();

	// Prioritize freshly imported references, then fall back to older canonical images.
	for (const url of [...input.sourceReferences, ...input.canonicalReferences]) {
		const trimmed = url.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(trimmed);
		if (deduped.length >= MAX_CANONICAL_CONDITIONING_REFERENCES) {
			break;
		}
	}

	return deduped;
}

export function buildShotConditioningReferences(input: {
	shotCode: CanonicalShotCode;
	referencePool: CanonicalConditioningReference[];
	generationMode: CanonicalGenerationMode;
}): ImageReferenceInput[] {
	const ranked = input.referencePool
		.map(reference => ({
			reference,
			score: scoreConditioningReferenceForShot(reference, input.shotCode, input.generationMode)
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, MAX_SHOT_CONDITIONING_REFERENCES);

	return ranked.map((entry, index) => ({
		url: entry.reference.url,
		source: entry.reference.source,
		title: buildConditioningReferenceTitle(entry.reference),
		weight: index < 2 ? "primary" : "secondary",
		similarity_score: clamp01(entry.score)
	}));
}

function resolveShotCodesForGenerationMode(mode: CanonicalGenerationMode): CanonicalShotCode[] {
	if (mode === "front_only") {
		return [FRONT_CANONICAL_SHOT_CODE];
	}

	if (mode === "remaining") {
		return REQUIRED_CANONICAL_SHOT_CODES.filter(shotCode => shotCode !== FRONT_CANONICAL_SHOT_CODE);
	}

	return [...REQUIRED_CANONICAL_SHOT_CODES];
}

async function resolveCanonicalConditioningReferenceInputs(referenceInputs: CanonicalConditioningReference[]): Promise<CanonicalConditioningReference[]> {
	const resolved = await mapWithConcurrency(referenceInputs, CANONICAL_REFERENCE_RESOLVE_CONCURRENCY, async reference => {
		const url = await resolveCanonicalConditioningReferenceUrl(reference.url);
		return url ? { ...reference, url } : null;
	});

	const deduped: CanonicalConditioningReference[] = [];
	const seen = new Set<string>();

	for (const value of resolved) {
		if (!value) continue;
		const key = value.url.trim().toLowerCase();
		if (!key || seen.has(key)) continue;
		seen.add(key);
		deduped.push(value);
	}

	return deduped;
}

async function resolveCanonicalConditioningReferenceUrl(rawUrl: string): Promise<string | null> {
	const url = rawUrl.trim();
	if (!url) return null;
	if (url.startsWith("data:image/")) return url;
	if (isHttpUrl(url)) return url;

	if (url.startsWith("gs://")) {
		try {
			return await createSignedReadUrlForGcsUri(url, CANONICAL_REFERENCE_SIGNED_URL_TTL_SECONDS);
		} catch {
			return null;
		}
	}

	return null;
}

function buildCanonicalConditioningReferencePool(input: {
	selectedFrontCandidateUri?: string;
	canonicalReferences: Array<{ url: string; shotCode?: CanonicalShotCode }>;
	sourceReferences: Array<{ id: string; url: string; fileName?: string | null; sortOrder?: number }>;
	photoImportReviews: PhotoImportImageReview[];
}): CanonicalConditioningReference[] {
	const deduped: CanonicalConditioningReference[] = [];
	const seen = new Set<string>();
	const reviewById = new Map(input.photoImportReviews.map(review => [review.reference_id, review]));

	const pushReference = (reference: CanonicalConditioningReference) => {
		const trimmed = reference.url.trim();
		if (!trimmed) return;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) return;
		seen.add(key);
		deduped.push(reference);
	};

	if (input.selectedFrontCandidateUri) {
		pushReference({
			url: input.selectedFrontCandidateUri,
			source: "external_url",
			title: "Model Identity approved front anchor",
			weight: "primary",
			similarity_score: 1,
			source_kind: "selected_front_candidate",
			canonical_shot_code: FRONT_CANONICAL_SHOT_CODE,
			view_angle: "frontal",
			framing: "closeup",
			expression: "neutral",
			identity_anchor_score: 1,
			sharpness_score: 0.95
		});
	}

	for (const sourceReference of input.sourceReferences) {
		const review = reviewById.get(sourceReference.id);
		pushReference({
			url: sourceReference.url,
			source: "external_url",
			title: buildUploadedReferenceTitle(sourceReference.fileName, review),
			weight: "secondary",
			similarity_score: clamp01(review?.identity_anchor_score ?? 0.65),
			source_kind: "uploaded_photo",
			view_angle: review?.view_angle ?? "unknown",
			framing: review?.framing ?? "unknown",
			expression: review?.expression ?? "other",
			identity_anchor_score: clamp01(review?.identity_anchor_score ?? 0.65),
			sharpness_score: clamp01(review?.sharpness_score ?? 0.6)
		});
	}

	for (const canonicalReference of input.canonicalReferences) {
		pushReference({
			url: canonicalReference.url,
			source: "external_url",
			title: buildCanonicalReferenceTitle(canonicalReference.shotCode),
			weight: canonicalReference.shotCode === FRONT_CANONICAL_SHOT_CODE ? "primary" : "secondary",
			similarity_score: 0.92,
			source_kind: "canonical_reference",
			canonical_shot_code: canonicalReference.shotCode,
			view_angle: inferViewAngleFromShotCode(canonicalReference.shotCode),
			framing: inferFramingFromShotCode(canonicalReference.shotCode),
			expression: inferExpressionFromShotCode(canonicalReference.shotCode),
			identity_anchor_score: 0.92,
			sharpness_score: 0.9
		});
	}

	return deduped.slice(0, MAX_CANONICAL_CONDITIONING_REFERENCES);
}

function scoreConditioningReferenceForShot(reference: CanonicalConditioningReference, shotCode: CanonicalShotCode, generationMode: CanonicalGenerationMode): number {
	let score = reference.identity_anchor_score ?? (reference.source_kind === "uploaded_photo" ? 0.65 : 0.85);
	score += (reference.sharpness_score ?? 0.6) * 0.12;

	if (reference.source_kind === "selected_front_candidate") {
		score += generationMode === "remaining" ? 0.35 : 0.28;
	}
	if (reference.source_kind === "canonical_reference") {
		score += 0.12;
	}

	score += viewAngleAffinity(reference.view_angle ?? inferViewAngleFromShotCode(reference.canonical_shot_code), shotCode);
	score += framingAffinity(reference.framing ?? inferFramingFromShotCode(reference.canonical_shot_code), shotCode);
	score += expressionAffinity(reference.expression ?? inferExpressionFromShotCode(reference.canonical_shot_code), shotCode);

	return Number(score.toFixed(4));
}

function viewAngleAffinity(viewAngle: PhotoReferenceViewAngle | undefined, shotCode: CanonicalShotCode): number {
	if (!viewAngle || viewAngle === "unknown") return 0;
	if (shotCode === "frontal_closeup" || shotCode === "neutral_head_shoulders" || shotCode === "half_body_front" || shotCode === "full_body_front" || shotCode === "soft_smile_closeup" || shotCode === "serious_closeup") {
		if (viewAngle === "frontal") return 0.24;
		if (viewAngle === "left_45" || viewAngle === "right_45") return 0.08;
		return -0.02;
	}
	if (shotCode === "left45_closeup") {
		if (viewAngle === "left_45") return 0.24;
		if (viewAngle === "frontal") return 0.09;
		if (viewAngle === "left_profile") return 0.05;
		return -0.03;
	}
	if (shotCode === "right45_closeup") {
		if (viewAngle === "right_45") return 0.24;
		if (viewAngle === "frontal") return 0.09;
		if (viewAngle === "right_profile") return 0.05;
		return -0.03;
	}
	return 0;
}

function framingAffinity(framing: PhotoReferenceFraming | undefined, shotCode: CanonicalShotCode): number {
	if (!framing || framing === "unknown") return 0;
	if (shotCode === "full_body_front") {
		if (framing === "full_body") return 0.22;
		if (framing === "half_body") return 0.09;
		return -0.05;
	}
	if (shotCode === "half_body_front") {
		if (framing === "half_body") return 0.22;
		if (framing === "full_body") return 0.1;
		if (framing === "head_shoulders") return -0.02;
		return -0.05;
	}
	if (shotCode === "neutral_head_shoulders") {
		if (framing === "head_shoulders") return 0.18;
		if (framing === "closeup") return 0.08;
		return -0.03;
	}
	if (framing === "closeup") return 0.16;
	if (framing === "head_shoulders") return 0.1;
	return -0.04;
}

function expressionAffinity(expression: PhotoReferenceExpression | undefined, shotCode: CanonicalShotCode): number {
	if (!expression) return 0;
	if (shotCode === "soft_smile_closeup") {
		if (expression === "soft_smile") return 0.08;
		if (expression === "neutral") return 0.03;
		return 0;
	}
	if (shotCode === "serious_closeup") {
		if (expression === "serious") return 0.08;
		if (expression === "neutral") return 0.03;
		return 0;
	}
	if (expression === "neutral") return 0.02;
	return 0;
}

function buildConditioningReferenceTitle(reference: CanonicalConditioningReference): string {
	const parts = ["Model Identity"];

	if (reference.source_kind === "selected_front_candidate") {
		parts.push("approved front anchor");
	} else if (reference.source_kind === "canonical_reference") {
		parts.push("canonical");
		if (reference.canonical_shot_code) {
			parts.push(reference.canonical_shot_code);
		}
	} else {
		parts.push("uploaded");
	}

	if (reference.view_angle && reference.view_angle !== "unknown") {
		parts.push(reference.view_angle);
	}
	if (reference.framing && reference.framing !== "unknown") {
		parts.push(reference.framing);
	}
	if (reference.expression && reference.expression !== "other") {
		parts.push(reference.expression);
	}

	return parts.join(" ");
}

function buildUploadedReferenceTitle(fileName: string | null | undefined, review?: PhotoImportImageReview): string {
	const parts = ["Model Identity uploaded"];
	if (review?.view_angle && review.view_angle !== "unknown") parts.push(review.view_angle);
	if (review?.framing && review.framing !== "unknown") parts.push(review.framing);
	if (review?.expression && review.expression !== "other") parts.push(review.expression);
	if (fileName && fileName.trim().length > 0) parts.push(fileName.trim());
	return parts.join(" ");
}

function buildCanonicalReferenceTitle(shotCode?: CanonicalShotCode): string {
	return `Model Identity canonical ${shotCode ?? "reference"}`;
}

function inferViewAngleFromShotCode(shotCode?: CanonicalShotCode): PhotoReferenceViewAngle {
	if (!shotCode) return "unknown";
	if (shotCode === "left45_closeup") return "left_45";
	if (shotCode === "right45_closeup") return "right_45";
	return "frontal";
}

function inferFramingFromShotCode(shotCode?: CanonicalShotCode): PhotoReferenceFraming {
	if (!shotCode) return "unknown";
	if (shotCode === "full_body_front") return "full_body";
	if (shotCode === "half_body_front") return "half_body";
	if (shotCode === "neutral_head_shoulders") return "head_shoulders";
	return "closeup";
}

function inferExpressionFromShotCode(shotCode?: CanonicalShotCode): PhotoReferenceExpression {
	if (!shotCode) return "other";
	if (shotCode === "soft_smile_closeup") return "soft_smile";
	if (shotCode === "serious_closeup") return "serious";
	return "neutral";
}

function normalizeCanonicalShotCode(value: string): CanonicalShotCode | undefined {
	return REQUIRED_CANONICAL_SHOT_CODES.includes(value as CanonicalShotCode) ? (value as CanonicalShotCode) : undefined;
}

function readPhotoImportImageReviews(onboardingState: Record<string, unknown>): PhotoImportImageReview[] {
	const photoImport = asRecord(onboardingState.photo_import);
	const latestSuggestion = asRecord(photoImport?.latest_suggestion);
	const parsed = photoImportSuggestionSchema.safeParse(latestSuggestion);
	return parsed.success ? parsed.data.image_reviews : [];
}

function asRecord(input: unknown): Record<string, unknown> | null {
	if (!input || typeof input !== "object" || Array.isArray(input)) return null;
	return input as Record<string, unknown>;
}

function asRecordArray(input: unknown): Array<Record<string, unknown>> | null {
	if (!Array.isArray(input)) return null;
	return input.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function validateSelectionShape(selections: Array<{ shot_code: string; candidate_id: string }>) {
	if (selections.length !== REQUIRED_CANONICAL_SHOT_CODES.length) {
		throw new ApiError(400, "VALIDATION_ERROR", `You must choose all ${REQUIRED_CANONICAL_SHOT_CODES.length} required angles before approval. Select one option per angle and try again.`);
	}

	const uniqueShots = new Set(selections.map(item => item.shot_code));
	if (uniqueShots.size !== REQUIRED_CANONICAL_SHOT_CODES.length) {
		throw new ApiError(400, "VALIDATION_ERROR", "Each required angle must be selected exactly once. Review your selections and try again.");
	}

	for (const shot of REQUIRED_CANONICAL_SHOT_CODES) {
		if (!uniqueShots.has(shot)) {
			throw new ApiError(400, "VALIDATION_ERROR", `One required angle is missing from your selections (${shot}). Select all required angles and try again.`);
		}
	}
}

async function resolveCandidatePreviewUrl(uri: string): Promise<string | null> {
	const value = uri.trim();
	if (!value) return null;

	if (value.startsWith("data:image/")) {
		return value;
	}

	if (value.startsWith("http://") || value.startsWith("https://")) {
		return value;
	}

	if (!value.startsWith("gs://")) {
		return null;
	}

	try {
		return await createSignedReadUrlForGcsUri(value, 3600);
	} catch {
		return null;
	}
}

async function mapWithConcurrency<TInput, TOutput>(items: TInput[], maxConcurrency: number, mapper: (item: TInput, index: number) => Promise<TOutput>): Promise<TOutput[]> {
	if (items.length === 0) return [];

	const concurrency = Math.max(1, Math.min(maxConcurrency, items.length));
	const results = new Array<TOutput>(items.length);
	let cursor = 0;

	async function worker(): Promise<void> {
		while (cursor < items.length) {
			const index = cursor;
			cursor += 1;

			const item = items[index];
			if (item === undefined) continue;
			results[index] = await mapper(item, index);
		}
	}

	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	return results;
}

