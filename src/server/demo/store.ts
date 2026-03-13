import { randomUUID } from "node:crypto";
import type { CreativeControls, CreativeIssueTag, ImageModelProvider } from "@/server/schemas/creative";
import { buildDuplicateCampaignName, adaptPromptTextForTargetModel } from "@/server/services/campaign-linked-sets";
import { createDefaultCreativeControls, estimateIdentityDriftScore, mergeCreativeControls, shouldAlertIdentityDrift } from "@/server/services/creative-controls";
import { buildPrompt } from "@/server/services/prompt-builder";

type ModelStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";
type CanonicalPackStatus = "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
type CampaignStatus = "DRAFT" | "GENERATING" | "REVIEW" | "APPROVED" | "REJECTED" | "SCHEDULED" | "PUBLISHED" | "FAILED";
type CampaignGenerationMode = "anchor" | "batch";

type DemoModel = {
	id: string;
	name: string;
	description: string | null;
	status: ModelStatus;
	body_profile: Record<string, unknown> | null;
	face_profile: Record<string, unknown> | null;
	imperfection_fingerprint: Array<Record<string, unknown>> | null;
	personality_profile: Record<string, unknown> | null;
	social_tracks_profile: Record<string, unknown> | null;
	onboarding_state: Record<string, unknown> | null;
	canonical_pack_status: CanonicalPackStatus;
	active_canonical_pack_version: number;
	active_version_id: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoModelVersion = {
	id: string;
	model_id: string;
	version: number;
	lora_gcs_uri: string;
	lora_strength: number;
	is_active: boolean;
	notes: string | null;
	uploaded_by: string;
	created_at: string;
};

type DemoCanonicalReference = {
	id: string;
	model_id: string;
	pack_version: number;
	shot_code: string;
	source_candidate_id: string | null;
	seed: number;
	prompt_text: string;
	reference_image_url: string;
	notes: string | null;
	sort_order: number;
	created_at: string;
};

type DemoModelReferenceCandidate = {
	id: string;
	model_id: string;
	pack_version: number;
	shot_code: string;
	candidate_index: number;
	seed: number;
	prompt_text: string;
	image_gcs_uri: string;
	provider: ImageModelProvider;
	provider_model_id: string | null;
	realism_score: number;
	clarity_score: number;
	consistency_score: number;
	composite_score: number;
	qa_notes: string | null;
	status: "CANDIDATE" | "SELECTED" | "REJECTED";
	created_at: string;
};

type DemoPreset = {
	id: string;
	name: string;
	mood_tag: string;
	current_version_id: string;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoPresetVersion = {
	id: string;
	preset_id: string;
	version: number;
	lighting_profile: Record<string, unknown>;
	lens_profile: Record<string, unknown>;
	color_palette: Record<string, unknown>;
	grading_curve: Record<string, unknown>;
	camera_simulation: Record<string, unknown> | null;
	prompt_fragment: string;
	created_at: string;
};

type DemoCampaign = {
	id: string;
	name: string;
	model_id: string;
	campaign_group_id: string | null;
	source_campaign_id: string | null;
	preset_version_id: string;
	pose_pack_id: string | null;
	image_model_provider: ImageModelProvider;
	image_model_id: string | null;
	creative_controls: CreativeControls;
	reference_board_version: number;
	anchor_asset_id: string | null;
	product_asset_url: string | null;
	status: CampaignStatus;
	batch_size: number;
	resolution_width: number;
	resolution_height: number;
	upscale: boolean;
	prompt_text: string | null;
	negative_prompt: string | null;
	custom_prompt_additions: string | null;
	base_seed: number | null;
	error_message: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoGenerationJob = {
	id: string;
	campaign_id: string;
	status: "DISPATCHED" | "COMPLETED" | "FAILED";
	gpu_provider: string;
	payload: Record<string, unknown>;
	response_payload: Record<string, unknown> | null;
	generation_time_ms: number | null;
	estimated_cost_usd: number | null;
	retry_count: number;
	error_message: string | null;
	dispatched_at: string;
	completed_at: string | null;
};

type DemoAsset = {
	id: string;
	campaign_id: string;
	job_id: string;
	status: "PENDING" | "APPROVED" | "REJECTED";
	raw_gcs_uri: string;
	approved_gcs_uri: string | null;
	seed: number;
	width: number;
	height: number;
	prompt_text: string;
	generation_time_ms: number;
	sequence_number: number;
	is_favorite: boolean;
	quality_score: number | null;
	moderation_notes: string | null;
	issue_tags: CreativeIssueTag[];
	artifacts_flagged: boolean;
	identity_drift_score: number | null;
	refinement_index: number;
	refinement_history: Array<Record<string, unknown>>;
	created_at: string;
	reviewed_at: string | null;
};

type DemoAssetRefinementState = {
	id: string;
	campaign_id: string;
	asset_id: string;
	state_index: number;
	label: string | null;
	controls_patch: Record<string, unknown>;
	prompt_override: string | null;
	created_by: string;
	created_at: string;
};

type DemoPublishingStatus = "PENDING_APPROVAL" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "RETRY" | "FAILED" | "REJECTED" | "CANCELLED";

type DemoPublishingQueue = {
	id: string;
	asset_id: string;
	variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
	post_type: "feed" | "story" | "reel";
	caption: string;
	hashtag_preset_id: string | null;
	status: DemoPublishingStatus;
	scheduled_at: string;
	published_at: string | null;
	ig_media_id: string | null;
	ig_container_id: string | null;
	retry_count: number;
	retry_after: string | null;
	rejection_reason: string | null;
	error_message: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoSystemSetting = {
	key: string;
	value: unknown;
};

type DemoUser = {
	id: string;
	email: string;
	role: "ADMIN" | "OPERATOR" | "CLIENT";
	display_name: string;
};

type DemoPosePack = {
	id: string;
	name: string;
	description: string | null;
	compatibility: string;
	manifest: {
		poses: Array<{
			name: string;
			category: string;
			notes?: string;
		}>;
	};
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoClient = {
	id: string;
	name: string;
	status: string;
	notes: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoBrandProfile = {
	id: string;
	client_id: string;
	name: string;
	visual_direction: Record<string, unknown> | null;
	voice_notes: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoClientModelAssignment = {
	id: string;
	client_id: string;
	model_id: string;
	starts_at: string;
	ends_at: string | null;
	created_at: string;
};

type DemoRevenueContract = {
	id: string;
	client_id: string;
	contract_type: "RETAINER" | "RETAINER_PLUS_BONUS";
	monthly_retainer_usd: number;
	starts_at: string;
	ends_at: string | null;
	created_by: string;
	created_at: string;
	updated_at: string;
};

type DemoRevenueEntry = {
	id: string;
	contract_id: string;
	type: "RETAINER" | "BONUS" | "ADJUSTMENT";
	amount_usd: number;
	reference_month: string;
	notes: string | null;
	created_at: string;
};

type DemoStore = {
	users: DemoUser[];
	models: DemoModel[];
	modelVersions: DemoModelVersion[];
	canonicalReferences: DemoCanonicalReference[];
	modelReferenceCandidates: DemoModelReferenceCandidate[];
	presets: DemoPreset[];
	presetVersions: DemoPresetVersion[];
	posePacks: DemoPosePack[];
	clients: DemoClient[];
	brandProfiles: DemoBrandProfile[];
	clientAssignments: DemoClientModelAssignment[];
	revenueContracts: DemoRevenueContract[];
	revenueEntries: DemoRevenueEntry[];
	campaigns: DemoCampaign[];
	generationJobs: DemoGenerationJob[];
	assets: DemoAsset[];
	assetRefinementStates: DemoAssetRefinementState[];
	publishingQueue: DemoPublishingQueue[];
	settings: DemoSystemSetting[];
	audit: Array<{
		id: string;
		action: string;
		entity_type: string;
		entity_id: string;
		created_at: string;
	}>;
};

declare global {
	var laceStudioDemoStore: DemoStore | undefined;
}

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const CANONICAL_SHOTS = ["frontal_closeup", "left45_closeup", "right45_closeup", "neutral_head_shoulders", "half_body_front", "full_body_front", "soft_smile_closeup", "serious_closeup"] as const;
const FRONT_CANONICAL_SHOT = CANONICAL_SHOTS[0];
type DemoCanonicalGenerationMode = "front_only" | "remaining" | "full";

function now() {
	return new Date().toISOString();
}

function createSeedStore(): DemoStore {
	const modelId = randomUUID();
	const modelVersionId = randomUUID();
	const canonicalPackVersion = 1;
	const presetId = randomUUID();
	const presetVersionId = randomUUID();
	const posePackId = randomUUID();
	const clientId = randomUUID();
	const brandId = randomUUID();
	const assignmentId = randomUUID();
	const contractId = randomUUID();
	const entryId = randomUUID();

	return {
		users: [
			{
				id: ADMIN_ID,
				email: "admin@lacestudio.internal",
				role: "ADMIN",
				display_name: "LaceStudio Admin"
			},
			{
				id: "00000000-0000-0000-0000-000000000002",
				email: "operator@lacestudio.internal",
				role: "OPERATOR",
				display_name: "LaceStudio Operator"
			},
			{
				id: "00000000-0000-0000-0000-000000000003",
				email: "client@lacestudio.internal",
				role: "CLIENT",
				display_name: "LaceStudio Client"
			}
		],
		models: [
			{
				id: modelId,
				name: "Ava Prime",
				description: "Launch model",
				status: "ACTIVE",
				body_profile: { height: "172cm", build: "athletic" },
				face_profile: { face_shape: "oval", jawline: "defined" },
				imperfection_fingerprint: [{ type: "mole", location: "left cheek", intensity: "subtle" }],
				personality_profile: {
					social_voice: "warm",
					temperament: "confident",
					interests: ["fashion", "travel"]
				},
				social_tracks_profile: {
					reality_like_daily: { target_ratio_percent: 60 },
					fashion_editorial: { target_ratio_percent: 40 }
				},
				onboarding_state: {
					current_step: "social_strategy",
					completed_steps: ["character_design", "personality", "social_strategy"],
					last_saved_at: now()
				},
				canonical_pack_status: "APPROVED",
				active_canonical_pack_version: canonicalPackVersion,
				active_version_id: modelVersionId,
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		modelVersions: [
			{
				id: modelVersionId,
				model_id: modelId,
				version: 1,
				lora_gcs_uri: `gs://lacestudio-model-weights-private/${modelId}/v1/weights.safetensors`,
				lora_strength: 0.8,
				is_active: true,
				notes: "Initial identity",
				uploaded_by: ADMIN_ID,
				created_at: now()
			}
		],
		canonicalReferences: CANONICAL_SHOTS.map((shot, index) => ({
			id: randomUUID(),
			model_id: modelId,
			pack_version: canonicalPackVersion,
			shot_code: shot,
			source_candidate_id: null,
			seed: 1000 + index * 7,
			prompt_text: `Seed canonical shot ${shot}`,
			reference_image_url: `gs://lacestudio-model-weights-private/${modelId}/canonical/v${canonicalPackVersion}/${shot}/selected.png`,
			notes: null,
			sort_order: index,
			created_at: now()
		})),
		modelReferenceCandidates: [],
		presets: [
			{
				id: presetId,
				name: "Editorial Violet Luxe",
				mood_tag: "editorial violet",
				current_version_id: presetVersionId,
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		presetVersions: [
			{
				id: presetVersionId,
				preset_id: presetId,
				version: 1,
				lighting_profile: { key_light_direction: "45-left", ambient_type: "studio" },
				lens_profile: { focal_length_mm: 85, aperture: "f/2.8" },
				color_palette: { primary_hue: "#7F6BC4", secondary_hue: "#A18CE1", accent_hue: "#D8C8FF" },
				grading_curve: { shadows: "neutral", midtones: "cool", highlights: "cool" },
				camera_simulation: { camera_body: "Hasselblad X2D", film_stock: "Kodak Portra 400" },
				prompt_fragment: "editorial violet",
				created_at: now()
			}
		],
		posePacks: [
			{
				id: posePackId,
				name: "Editorial Motion Core",
				description: "Foundational premium editorial movement set.",
				compatibility: "all",
				manifest: {
					poses: [
						{
							name: "Power Step",
							category: "full-body",
							notes: "Forward stride with shoulder-leading confidence."
						},
						{
							name: "Soft Quarter Turn",
							category: "portrait",
							notes: "Subtle jawline emphasis with relaxed gaze."
						},
						{
							name: "Hands Detail",
							category: "product-focus",
							notes: "Elegant hand framing for accessory campaigns."
						}
					]
				},
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		clients: [
			{
				id: clientId,
				name: "Luna Atelier",
				status: "active",
				notes: "Premium fashion retainer account.",
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		brandProfiles: [
			{
				id: brandId,
				client_id: clientId,
				name: "Luna Core",
				visual_direction: {
					tone: "editorial luxe",
					palette: ["#7F6BC4", "#D8C8FF", "#A18CE1"]
				},
				voice_notes: "Playful authority with minimal copy.",
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		clientAssignments: [
			{
				id: assignmentId,
				client_id: clientId,
				model_id: modelId,
				starts_at: now(),
				ends_at: null,
				created_at: now()
			}
		],
		revenueContracts: [
			{
				id: contractId,
				client_id: clientId,
				contract_type: "RETAINER_PLUS_BONUS",
				monthly_retainer_usd: 5500,
				starts_at: now(),
				ends_at: null,
				created_by: ADMIN_ID,
				created_at: now(),
				updated_at: now()
			}
		],
		revenueEntries: [
			{
				id: entryId,
				contract_id: contractId,
				type: "RETAINER",
				amount_usd: 5500,
				reference_month: now(),
				notes: "Initial monthly retainer",
				created_at: now()
			}
		],
		campaigns: [],
		generationJobs: [],
		assets: [],
		assetRefinementStates: [],
		publishingQueue: [],
		settings: [
			{ key: "require_publishing_approval", value: true },
			{ key: "gpu_monthly_budget_usd", value: 900 },
			{ key: "gpu_cost_per_ms", value: 0.0000005 },
			{ key: "image_cost_per_1k_gpu_usd", value: 0.035 },
			{ key: "image_cost_per_1k_openai_usd", value: 0.17 },
			{ key: "image_cost_per_1k_nano_banana_2_usd", value: 0.03 },
			{ key: "image_cost_per_1k_zai_glm_usd", value: 0.08 },
			{ key: "instagram_rate_limit_per_hour", value: 25 }
		],
		audit: []
	};
}

function getStore(): DemoStore {
	if (!global.laceStudioDemoStore) {
		global.laceStudioDemoStore = createSeedStore();
	}

	const seed = createSeedStore();
	for (const key of Object.keys(seed) as (keyof DemoStore)[]) {
		if (!(key in global.laceStudioDemoStore)) {
			(global.laceStudioDemoStore as Record<string, unknown>)[key] = seed[key];
		}
	}

	return global.laceStudioDemoStore;
}

function logAudit(store: DemoStore, action: string, entityType: string, entityId: string) {
	store.audit.unshift({
		id: randomUUID(),
		action,
		entity_type: entityType,
		entity_id: entityId,
		created_at: now()
	});
}

export const demoStore = {
	listModels(status?: ModelStatus) {
		const store = getStore();
		const data = status ? store.models.filter(model => model.status === status) : store.models;
		return data.map(model => ({
			...model,
			model_versions: store.modelVersions
				.filter(version => version.model_id === model.id)
				.sort((a, b) => b.version - a.version)
				.slice(0, 1)
		}));
	},

	createModel(input: { name: string; description?: string; userId: string }) {
		const store = getStore();
		const modelId = randomUUID();

		const model: DemoModel = {
			id: modelId,
			name: input.name,
			description: input.description ?? null,
			status: "DRAFT",
			body_profile: null,
			face_profile: null,
			imperfection_fingerprint: null,
			personality_profile: null,
			social_tracks_profile: null,
			onboarding_state: {
				current_step: "character_design",
				completed_steps: [],
				last_saved_at: now()
			},
			canonical_pack_status: "NOT_STARTED",
			active_canonical_pack_version: 0,
			active_version_id: null,
			created_by: input.userId,
			created_at: now(),
			updated_at: now()
		};

		store.models.unshift(model);

		return model;
	},

	getModel(id: string) {
		const store = getStore();
		const model = store.models.find(item => item.id === id);
		if (!model) return null;

		return {
			...model,
			model_versions: store.modelVersions.filter(version => version.model_id === id).sort((a, b) => b.version - a.version),
			canonical_references: store.canonicalReferences.filter(reference => reference.model_id === id).sort((a, b) => a.sort_order - b.sort_order)
		};
	},

	updateModel(id: string, updates: Partial<DemoModel>) {
		const store = getStore();
		const model = store.models.find(item => item.id === id);
		if (!model) return null;

		Object.assign(model, updates, { updated_at: now() });

		const canonicalCount = store.canonicalReferences.filter(reference => reference.model_id === id && reference.pack_version === model.active_canonical_pack_version).length;

		if (model.body_profile && model.face_profile && model.canonical_pack_status === "APPROVED" && canonicalCount >= 8) {
			model.status = "ACTIVE";
		} else if (model.status !== "ARCHIVED") {
			model.status = "DRAFT";
		}

		return model;
	},

	getModelWorkflow(id: string) {
		const store = getStore();
		const model = store.models.find(item => item.id === id);
		if (!model) return null;

		const canonicalCount = store.canonicalReferences.filter(reference => reference.model_id === id && reference.pack_version === model.active_canonical_pack_version).length;
		const hasActiveLora = store.modelVersions.some(version => version.model_id === id && version.is_active);

		return {
			model_id: model.id,
			model_name: model.name,
			status: model.status,
			canonical_pack_status: model.canonical_pack_status,
			active_canonical_pack_version: model.active_canonical_pack_version,
			workflow_state: model.onboarding_state ?? {
				current_step: "character_design",
				completed_steps: [],
				last_saved_at: now()
			},
			completeness: {
				has_character_design: Boolean(model.body_profile && model.face_profile),
				has_personality: Boolean(model.personality_profile),
				has_social_strategy: Boolean(model.social_tracks_profile),
				has_canonical_pack: model.canonical_pack_status === "APPROVED" && canonicalCount >= 8,
				can_finalize: Boolean(model.body_profile && model.face_profile) && model.canonical_pack_status === "APPROVED" && canonicalCount >= 8
			},
			draft: {
				character_design:
					model.body_profile && model.face_profile
						? {
								body_profile: model.body_profile,
								face_profile: model.face_profile,
								imperfection_fingerprint: model.imperfection_fingerprint ?? []
							}
						: null,
				personality: model.personality_profile,
				social_strategy: model.social_tracks_profile
			},
			capabilities: {
				gpu_available: hasActiveLora,
				openai_available: true,
				nano_available: true
			}
		};
	},

	saveModelWorkflowStep(input: { id: string; step: "character_design" | "personality" | "social_strategy"; payload: Record<string, unknown> }) {
		const store = getStore();
		const model = store.models.find(item => item.id === input.id);
		if (!model) return null;

		if (input.step === "character_design") {
			model.body_profile = (input.payload.body_profile as Record<string, unknown> | undefined) ?? null;
			model.face_profile = (input.payload.face_profile as Record<string, unknown> | undefined) ?? null;
			model.imperfection_fingerprint = (input.payload.imperfection_fingerprint as Array<Record<string, unknown>> | undefined) ?? [];
		} else if (input.step === "personality") {
			model.personality_profile = input.payload;
		} else {
			model.social_tracks_profile = input.payload;
		}

		const completed = new Set<string>(Array.isArray(model.onboarding_state?.completed_steps) ? (model.onboarding_state?.completed_steps as string[]) : []);
		completed.add(input.step);
		model.onboarding_state = {
			current_step: input.step === "character_design" ? "personality" : input.step === "personality" ? "social_strategy" : "social_strategy",
			completed_steps: Array.from(completed),
			last_saved_at: now()
		};
		model.updated_at = now();

		const canonicalCount = store.canonicalReferences.filter(reference => reference.model_id === model.id && reference.pack_version === model.active_canonical_pack_version).length;
		if (model.body_profile && model.face_profile && model.canonical_pack_status === "APPROVED" && canonicalCount >= 8) {
			model.status = "ACTIVE";
		} else if (model.status !== "ARCHIVED") {
			model.status = "DRAFT";
		}

		return {
			model_id: model.id,
			status: model.status,
			workflow_state: model.onboarding_state
		};
	},

	startCanonicalPackGeneration(input: {
		modelId: string;
		provider: ImageModelProvider;
		providerModelId?: string;
		candidatesPerShot: number;
		generationMode?: DemoCanonicalGenerationMode;
		packVersion?: number;
	}) {
		const store = getStore();
		const model = store.models.find(item => item.id === input.modelId);
		if (!model) return null;

		const generationMode = input.generationMode ?? "front_only";
		const shotCodes =
			generationMode === "front_only"
				? [FRONT_CANONICAL_SHOT]
				: generationMode === "remaining"
					? CANONICAL_SHOTS.filter(shot => shot !== FRONT_CANONICAL_SHOT)
					: [...CANONICAL_SHOTS];

		const maxPack = Math.max(
			model.active_canonical_pack_version,
			...store.modelReferenceCandidates.filter(candidate => candidate.model_id === input.modelId).map(candidate => candidate.pack_version),
			0
		);
		let packVersion = maxPack + 1;
		if (generationMode === "remaining") {
			packVersion = input.packVersion ?? 0;
			if (packVersion <= 0) return null;
			const hasSelectedFront = store.modelReferenceCandidates.some(
				candidate =>
					candidate.model_id === input.modelId &&
					candidate.pack_version === packVersion &&
					candidate.shot_code === FRONT_CANONICAL_SHOT &&
					candidate.status === "SELECTED",
			);
			if (!hasSelectedFront) return null;
		}

		const jobId = randomUUID();
		model.canonical_pack_status = "GENERATING";
		model.updated_at = now();

		for (const shotCode of shotCodes) {
			for (let index = 1; index <= input.candidatesPerShot; index += 1) {
				const realism = Number((0.72 + Math.random() * 0.24).toFixed(4));
				const clarity = Number((0.7 + Math.random() * 0.25).toFixed(4));
				const consistency = Number((0.68 + Math.random() * 0.26).toFixed(4));
				const composite = Number((realism * 0.45 + clarity * 0.3 + consistency * 0.25).toFixed(4));
				store.modelReferenceCandidates.unshift({
					id: randomUUID(),
					model_id: input.modelId,
					pack_version: packVersion,
					shot_code: shotCode,
					candidate_index: index,
					seed: 10_000 + index * 13,
					prompt_text: `Demo canonical prompt for ${shotCode}`,
					image_gcs_uri: `gs://lacestudio-model-weights-private/${input.modelId}/canonical/v${packVersion}/${shotCode}/candidate-${index}.png`,
					provider: input.provider,
					provider_model_id: input.providerModelId ?? null,
					realism_score: realism,
					clarity_score: clarity,
					consistency_score: consistency,
					composite_score: composite,
					qa_notes: "Demo scored candidate",
					status: "CANDIDATE",
					created_at: now()
				});
			}
		}

		model.canonical_pack_status = "READY";
		model.updated_at = now();
		return {
			job_id: jobId,
			pack_version: packVersion
		};
	},

	getCanonicalPackSummary(input: { modelId: string; packVersion?: number }) {
		const store = getStore();
		const model = store.models.find(item => item.id === input.modelId);
		if (!model) return null;

		const packVersion = input.packVersion ?? model.active_canonical_pack_version;
		const candidates = store.modelReferenceCandidates.filter(candidate => candidate.model_id === input.modelId && candidate.pack_version === packVersion);
		const shots = CANONICAL_SHOTS.map(shotCode => {
			const shotCandidates = candidates
				.filter(candidate => candidate.shot_code === shotCode)
				.sort((a, b) => b.composite_score - a.composite_score)
				.map(candidate => ({
					...candidate,
					preview_image_url: null
				}));
			return {
				shot_code: shotCode,
				recommended_candidate_id: shotCandidates[0]?.id,
				candidates: shotCandidates
			};
		});
		const completedShots = shots.filter(shot => shot.candidates.length > 0).length;

		return {
			pack_version: packVersion,
			status: model.canonical_pack_status,
			error: (model.onboarding_state?.canonical_pack_error as string | undefined) ?? null,
			progress: {
				completed_shots: completedShots,
				total_shots: CANONICAL_SHOTS.length,
				generated_candidates: candidates.length
			},
			shots
		};
	},

	approveCanonicalPack(input: { modelId: string; packVersion: number; selections: Array<{ shot_code: string; candidate_id: string }> }) {
		const store = getStore();
		const model = store.models.find(item => item.id === input.modelId);
		if (!model) return null;

		store.modelReferenceCandidates
			.filter(candidate => candidate.model_id === input.modelId && candidate.pack_version === input.packVersion)
			.forEach(candidate => {
				candidate.status = "REJECTED";
			});

		const selectedIds = new Set(input.selections.map(item => item.candidate_id));
		store.modelReferenceCandidates
			.filter(candidate => selectedIds.has(candidate.id))
			.forEach(candidate => {
				candidate.status = "SELECTED";
			});

		store.canonicalReferences = store.canonicalReferences.filter(reference => !(reference.model_id === input.modelId && reference.pack_version === input.packVersion));

		for (const [index, selection] of input.selections.entries()) {
			const candidate = store.modelReferenceCandidates.find(item => item.id === selection.candidate_id);
			if (!candidate) continue;

			store.canonicalReferences.unshift({
				id: randomUUID(),
				model_id: input.modelId,
				pack_version: input.packVersion,
				shot_code: selection.shot_code,
				source_candidate_id: candidate.id,
				seed: candidate.seed,
				prompt_text: candidate.prompt_text,
				reference_image_url: candidate.image_gcs_uri,
				notes: candidate.qa_notes,
				sort_order: index,
				created_at: now()
			});
		}

		model.canonical_pack_status = "APPROVED";
		model.active_canonical_pack_version = input.packVersion;
		model.updated_at = now();

		const canonicalCount = store.canonicalReferences.filter(reference => reference.model_id === model.id && reference.pack_version === model.active_canonical_pack_version).length;
		if (model.body_profile && model.face_profile && canonicalCount >= 8) {
			model.status = "ACTIVE";
		} else if (model.status !== "ARCHIVED") {
			model.status = "DRAFT";
		}

		return { approved: true };
	},

	approveCanonicalFrontCandidate(input: { modelId: string; packVersion: number; candidateId: string }) {
		const store = getStore();
		const model = store.models.find(item => item.id === input.modelId);
		if (!model) return null;

		const selected = store.modelReferenceCandidates.find(
			candidate =>
				candidate.id === input.candidateId &&
				candidate.model_id === input.modelId &&
				candidate.pack_version === input.packVersion,
		);
		if (!selected || selected.shot_code !== FRONT_CANONICAL_SHOT) {
			return null;
		}

		store.modelReferenceCandidates
			.filter(
				candidate =>
					candidate.model_id === input.modelId &&
					candidate.pack_version === input.packVersion &&
					candidate.shot_code === FRONT_CANONICAL_SHOT,
			)
			.forEach(candidate => {
				candidate.status = "REJECTED";
			});
		selected.status = "SELECTED";

		store.canonicalReferences = store.canonicalReferences.filter(
			reference =>
				!(
					reference.model_id === input.modelId &&
					reference.pack_version === input.packVersion &&
					reference.shot_code === FRONT_CANONICAL_SHOT
				),
		);
		store.canonicalReferences.unshift({
			id: randomUUID(),
			model_id: input.modelId,
			pack_version: input.packVersion,
			shot_code: FRONT_CANONICAL_SHOT,
			source_candidate_id: selected.id,
			seed: selected.seed,
			prompt_text: selected.prompt_text,
			reference_image_url: selected.image_gcs_uri,
			notes: selected.qa_notes,
			sort_order: 0,
			created_at: now()
		});

		model.canonical_pack_status = "READY";
		model.updated_at = now();
		return { approved: true };
	},

	finalizeWorkflowModel(modelId: string) {
		const store = getStore();
		const model = store.models.find(item => item.id === modelId);
		if (!model) return null;

		const canonicalCount = store.canonicalReferences.filter(reference => reference.model_id === model.id && reference.pack_version === model.active_canonical_pack_version).length;
		if (model.body_profile && model.face_profile && model.canonical_pack_status === "APPROVED" && canonicalCount >= 8) {
			model.status = "ACTIVE";
		} else if (model.status !== "ARCHIVED") {
			model.status = "DRAFT";
		}

		const hasActiveLora = store.modelVersions.some(version => version.model_id === modelId && version.is_active);
		model.updated_at = now();

		return {
			model_id: model.id,
			status: model.status,
			canonical_pack_status: model.canonical_pack_status,
			capabilities: {
				gpu_available: hasActiveLora,
				openai_available: true,
				nano_available: true
			}
		};
	},

	createModelVersion(input: { modelId: string; userId: string; notes?: string; loraStrength?: number }) {
		const store = getStore();
		const latest = store.modelVersions.filter(version => version.model_id === input.modelId).sort((a, b) => b.version - a.version)[0];

		const version: DemoModelVersion = {
			id: randomUUID(),
			model_id: input.modelId,
			version: (latest?.version ?? 0) + 1,
			lora_gcs_uri: `gs://lacestudio-model-weights-private/${input.modelId}/v${(latest?.version ?? 0) + 1}/weights.safetensors`,
			lora_strength: input.loraStrength ?? 0.8,
			is_active: false,
			notes: input.notes ?? null,
			uploaded_by: input.userId,
			created_at: now()
		};

		store.modelVersions.unshift(version);
		return version;
	},

	activateModelVersion(modelId: string, versionId: string) {
		const store = getStore();

		for (const version of store.modelVersions) {
			if (version.model_id === modelId) {
				version.is_active = version.id === versionId;
			}
		}

		const model = store.models.find(item => item.id === modelId);
		if (model) {
			model.active_version_id = versionId;
			model.status = "ACTIVE";
			model.updated_at = now();
		}

		return store.modelVersions.filter(version => version.model_id === modelId).sort((a, b) => b.version - a.version);
	},

	listCampaigns(filters?: { model_id?: string; status?: CampaignStatus }) {
		const store = getStore();
		const linkedCountByGroup = new Map<string, number>();

		for (const campaign of store.campaigns) {
			if (!campaign.campaign_group_id) continue;
			linkedCountByGroup.set(campaign.campaign_group_id, (linkedCountByGroup.get(campaign.campaign_group_id) ?? 0) + 1);
		}

		return store.campaigns
			.filter(campaign => !filters?.model_id || campaign.model_id === filters.model_id)
			.filter(campaign => !filters?.status || campaign.status === filters.status)
			.map(campaign => ({
				...campaign,
				linked_campaign_count: campaign.campaign_group_id ? linkedCountByGroup.get(campaign.campaign_group_id) ?? 1 : 1,
				model: store.models.find(model => model.id === campaign.model_id) ?? null,
				assets: store.assets.filter(asset => asset.campaign_id === campaign.id),
				generation_jobs: store.generationJobs.filter(job => job.campaign_id === campaign.id)
			}))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	},

	getDefaultCampaignMoodTag() {
		const store = getStore();
		return store.presets[0]?.mood_tag ?? "editorial luxe";
	},

	createCampaign(input: {
		name: string;
		model_id: string;
		campaign_group_id?: string | null;
		source_campaign_id?: string | null;
		product_asset_url?: string;
		batch_size: number;
		resolution_width: number;
		resolution_height: number;
		upscale: boolean;
		negative_prompt?: string;
		custom_prompt_additions?: string;
		prompt_text: string;
		image_model_provider: ImageModelProvider;
		image_model_id?: string;
		creative_controls: CreativeControls;
		userId: string;
	}) {
		const store = getStore();
		let presetVersionId = store.presetVersions[0]?.id;

		if (!presetVersionId) {
			const presetId = randomUUID();
			presetVersionId = randomUUID();
			const fallbackMood = "editorial luxe";

			store.presets.unshift({
				id: presetId,
				name: "System Default Style",
				mood_tag: fallbackMood,
				current_version_id: presetVersionId,
				created_by: input.userId,
				created_at: now(),
				updated_at: now()
			});

			store.presetVersions.unshift({
				id: presetVersionId,
				preset_id: presetId,
				version: 1,
				lighting_profile: { profile: "neutral editorial" },
				lens_profile: { focal_length_mm: 85 },
				color_palette: { primary_hue: "#9CA3AF" },
				grading_curve: { style: "balanced" },
				camera_simulation: { profile: "default" },
				prompt_fragment: fallbackMood,
				created_at: now()
			});
		}

		const campaign: DemoCampaign = {
			id: randomUUID(),
			name: input.name,
			model_id: input.model_id,
			campaign_group_id: input.campaign_group_id ?? null,
			source_campaign_id: input.source_campaign_id ?? null,
			preset_version_id: presetVersionId,
			pose_pack_id: null,
			image_model_provider: input.image_model_provider,
			image_model_id: input.image_model_id ?? null,
			creative_controls: input.creative_controls ?? createDefaultCreativeControls(),
			reference_board_version: input.creative_controls?.reference_board.active_version ?? 1,
			anchor_asset_id: null,
			product_asset_url: input.product_asset_url ?? null,
			status: "DRAFT",
			batch_size: input.batch_size,
			resolution_width: input.resolution_width,
			resolution_height: input.resolution_height,
			upscale: input.upscale,
			prompt_text: input.prompt_text,
			negative_prompt: input.negative_prompt ?? null,
			custom_prompt_additions: input.custom_prompt_additions ?? null,
			base_seed: 42,
			error_message: null,
			created_by: input.userId,
			created_at: now(),
			updated_at: now()
		};

		store.campaigns.unshift(campaign);
		return campaign;
	},

	getCampaign(id: string) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === id);
		if (!campaign) return null;

		const linkedCampaigns = campaign.campaign_group_id
			? store.campaigns
					.filter(item => item.campaign_group_id === campaign.campaign_group_id)
					.map(item => ({
						id: item.id,
						name: item.name,
						status: item.status,
						source_campaign_id: item.source_campaign_id,
						model: store.models.find(model => model.id === item.model_id) ?? null
					}))
					.sort((left, right) => left.name.localeCompare(right.name))
			: [];

		return {
			...campaign,
			assets: store.assets.filter(asset => asset.campaign_id === id).sort((a, b) => a.sequence_number - b.sequence_number),
			generation_jobs: store.generationJobs.filter(job => job.campaign_id === id).sort((a, b) => new Date(b.dispatched_at).getTime() - new Date(a.dispatched_at).getTime()),
			refinement_states: store.assetRefinementStates.filter(state => state.campaign_id === id).sort((a, b) => b.state_index - a.state_index),
			linked_campaigns: linkedCampaigns,
			model: store.models.find(model => model.id === campaign.model_id) ?? null,
			preset_version: store.presetVersions.find(version => version.id === campaign.preset_version_id) ?? null
		};
	},

	duplicateCampaigns(input: {
		sourceCampaignId: string;
		modelIds: string[];
		name?: string;
		userId: string;
	}) {
		const store = getStore();
		const sourceCampaign = store.campaigns.find(item => item.id === input.sourceCampaignId);
		if (!sourceCampaign) return null;

		const sourceModel = store.models.find(model => model.id === sourceCampaign.model_id) ?? null;
		const targetModels = input.modelIds
			.map(modelId => store.models.find(model => model.id === modelId) ?? null)
			.filter((model): model is DemoModel => Boolean(model));

		if (targetModels.length !== input.modelIds.length) {
			return null;
		}

		const campaignGroupId = sourceCampaign.campaign_group_id ?? sourceCampaign.id;
		sourceCampaign.campaign_group_id = campaignGroupId;
		sourceCampaign.updated_at = now();

		const sourcePresetVersion = store.presetVersions.find(version => version.id === sourceCampaign.preset_version_id) ?? null;
		const sourcePreset = sourcePresetVersion ? store.presets.find(preset => preset.id === sourcePresetVersion.preset_id) ?? null : null;
		const moodTag = sourcePreset?.mood_tag ?? this.getDefaultCampaignMoodTag();
		const creativeControls = sourceCampaign.creative_controls ?? createDefaultCreativeControls();

		const createdCampaigns = targetModels.map(targetModel => {
			const fallbackPrompt = buildPrompt({
				modelName: targetModel.name,
				moodTag,
				customPromptAdditions: sourceCampaign.custom_prompt_additions ?? undefined,
				negativePrompt: sourceCampaign.negative_prompt ?? undefined,
				creativeControls,
			});

			return this.createCampaign({
				name: buildDuplicateCampaignName({
					sourceName: sourceCampaign.name,
					sourceModelName: sourceModel?.name,
					targetModelName: targetModel.name,
					targetCount: targetModels.length,
					overrideName: input.name,
				}),
				model_id: targetModel.id,
				campaign_group_id: campaignGroupId,
				source_campaign_id: sourceCampaign.id,
				product_asset_url: sourceCampaign.product_asset_url ?? undefined,
				batch_size: sourceCampaign.batch_size,
				resolution_width: sourceCampaign.resolution_width,
				resolution_height: sourceCampaign.resolution_height,
				upscale: sourceCampaign.upscale,
				negative_prompt: sourceCampaign.negative_prompt ?? fallbackPrompt.negativePrompt,
				custom_prompt_additions: sourceCampaign.custom_prompt_additions ?? undefined,
				prompt_text: adaptPromptTextForTargetModel({
					sourcePromptText: sourceCampaign.prompt_text,
					sourceModelName: sourceModel?.name,
					targetModelName: targetModel.name,
					fallbackPromptText: fallbackPrompt.promptText,
				}),
				image_model_provider: sourceCampaign.image_model_provider,
				image_model_id: sourceCampaign.image_model_id ?? undefined,
				creative_controls: creativeControls,
				userId: input.userId,
			});
		});

		return {
			primary_campaign_id: createdCampaigns[0]?.id ?? null,
			campaign_group_id: campaignGroupId,
			campaigns: createdCampaigns,
		};
	},

	setCampaignAnchor(campaignId: string, assetId: string) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		const asset = store.assets.find(item => item.id === assetId && item.campaign_id === campaignId);
		if (!asset) return null;

		campaign.anchor_asset_id = asset.id;
		campaign.updated_at = now();
		logAudit(store, "campaigns.anchor.set", "campaign", campaign.id);

		return {
			campaign_id: campaign.id,
			anchor_asset_id: campaign.anchor_asset_id
		};
	},

	generateCampaign(
		campaignId: string,
		promptText: string,
		controlsOverride?: Partial<CreativeControls>,
		regenerateAssetId?: string,
		generationMode: CampaignGenerationMode = "batch",
		anchorAssetId?: string
	) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;
		if (generationMode === "anchor" && regenerateAssetId) return null;

		let selectedAnchorAssetId = anchorAssetId ?? campaign.anchor_asset_id;
		if (anchorAssetId) {
			const requestedAnchor = store.assets.find(item => item.id === anchorAssetId && item.campaign_id === campaignId);
			if (!requestedAnchor) return null;
			selectedAnchorAssetId = requestedAnchor.id;
		}

		const isSelectiveRegeneration = Boolean(regenerateAssetId);
		if (!isSelectiveRegeneration && generationMode === "batch") {
			if (!selectedAnchorAssetId) return null;
			if (campaign.image_model_provider === "gpu") return null;
			campaign.anchor_asset_id = selectedAnchorAssetId;
		}

		const mergedControls = mergeCreativeControls(campaign.creative_controls, controlsOverride);
		campaign.creative_controls = mergedControls;
		campaign.status = "GENERATING";
		campaign.prompt_text = promptText;
		campaign.updated_at = now();

		const identityDriftScore = estimateIdentityDriftScore(mergedControls);
		const drift = shouldAlertIdentityDrift(mergedControls, identityDriftScore);

		const jobId = randomUUID();
		const job: DemoGenerationJob = {
			id: jobId,
			campaign_id: campaignId,
			status: "DISPATCHED",
			gpu_provider: campaign.image_model_provider,
			payload: {
				prompt_text: promptText,
				model_provider: campaign.image_model_provider,
				model_id: campaign.image_model_id,
				generation_mode: generationMode,
				anchor_asset_id: selectedAnchorAssetId
			},
			response_payload: null,
			generation_time_ms: null,
			estimated_cost_usd: null,
			retry_count: 0,
			error_message: null,
			dispatched_at: now(),
			completed_at: null
		};

		store.generationJobs.unshift(job);

		const assets: DemoAsset[] = [];
		const highestSequence = store.assets.filter(asset => asset.campaign_id === campaignId).reduce((max, asset) => Math.max(max, asset.sequence_number), 0);
		const generationCount = isSelectiveRegeneration ? campaign.batch_size : generationMode === "anchor" ? 1 : Math.max(1, campaign.batch_size - 1);

		for (let i = 1; i <= generationCount; i += 1) {
			assets.push({
				id: randomUUID(),
				campaign_id: campaignId,
				job_id: jobId,
				status: "PENDING",
				raw_gcs_uri: `gs://lacestudio-campaign-raw-private/${campaign.model_id}/${campaignId}/asset_${i}.webp`,
				approved_gcs_uri: null,
				seed: 42 + i * 7,
				width: campaign.resolution_width,
				height: campaign.resolution_height,
				prompt_text: promptText,
				generation_time_ms: 12000,
				sequence_number: highestSequence + i,
				is_favorite: false,
				quality_score: null,
				moderation_notes: null,
				issue_tags: [],
				artifacts_flagged: false,
				identity_drift_score: identityDriftScore,
				refinement_index: regenerateAssetId ? 1 : 0,
				refinement_history: [],
				created_at: now(),
				reviewed_at: null
			});
		}

		store.assets.push(...assets);

		job.status = "COMPLETED";
		job.response_payload = {
			asset_count: assets.length,
			generation_mode: generationMode,
			anchor_asset_id: selectedAnchorAssetId
		};
		job.generation_time_ms = assets.length * 12000;
		job.estimated_cost_usd = Number((job.generation_time_ms * 0.0000005).toFixed(4));
		job.completed_at = now();

		campaign.status = "REVIEW";
		campaign.updated_at = now();

		if (regenerateAssetId) {
			const stateIndex = store.assetRefinementStates.filter(state => state.asset_id === regenerateAssetId).reduce((max, state) => Math.max(max, state.state_index), 0) + 1;

			store.assetRefinementStates.unshift({
				id: randomUUID(),
				campaign_id: campaignId,
				asset_id: regenerateAssetId,
				state_index: stateIndex,
				label: `Regeneration ${stateIndex}`,
				controls_patch: (controlsOverride ?? {}) as Record<string, unknown>,
				prompt_override: promptText,
				created_by: campaign.created_by,
				created_at: now()
			});
		}

		return {
			job_id: jobId,
			campaign_status: campaign.status,
			generation_mode: generationMode,
			anchor_asset_id: campaign.anchor_asset_id,
			identity_drift_alert: drift.alert
		};
	},

	reviewAsset(
		campaignId: string,
		assetId: string,
		action: "approve" | "reject" | "flag",
		moderation?: {
			quality_score?: number;
			notes?: string;
			issue_tags?: CreativeIssueTag[];
			flag_artifacts?: boolean;
		}
	) {
		const store = getStore();
		const asset = store.assets.find(item => item.id === assetId && item.campaign_id === campaignId);
		if (!asset) return null;

		asset.status = action === "approve" ? "APPROVED" : action === "reject" ? "REJECTED" : "PENDING";
		asset.quality_score = moderation?.quality_score ?? asset.quality_score;
		asset.moderation_notes = moderation?.notes ?? asset.moderation_notes;
		asset.issue_tags = moderation?.issue_tags?.length ? moderation.issue_tags : asset.issue_tags;
		asset.artifacts_flagged = moderation?.flag_artifacts ?? asset.artifacts_flagged;
		asset.reviewed_at = now();
		asset.approved_gcs_uri = action === "approve" ? asset.raw_gcs_uri.replace("raw-private", "approved-public") : null;

		return asset;
	},

	updateCampaignCreativeControls(campaignId: string, patch: Partial<CreativeControls>) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		campaign.creative_controls = mergeCreativeControls(campaign.creative_controls, patch);
		campaign.updated_at = now();
		logAudit(store, "campaigns.creative.update", "campaign", campaign.id);
		return campaign;
	},

	updateCampaignSettings(
		campaignId: string,
		patch: {
			prompt_text?: string | null;
			image_model_provider?: ImageModelProvider;
			image_model_id?: string | null;
			batch_size?: number;
			resolution_width?: number;
			resolution_height?: number;
		}
	) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		if (patch.prompt_text !== undefined) campaign.prompt_text = patch.prompt_text;
		if (patch.image_model_provider !== undefined) campaign.image_model_provider = patch.image_model_provider;
		if (patch.image_model_id !== undefined) campaign.image_model_id = patch.image_model_id;
		if (patch.batch_size !== undefined) campaign.batch_size = patch.batch_size;
		if (patch.resolution_width !== undefined) campaign.resolution_width = patch.resolution_width;
		if (patch.resolution_height !== undefined) campaign.resolution_height = patch.resolution_height;

		campaign.updated_at = now();
		logAudit(store, "campaigns.settings.update", "campaign", campaign.id);
		return campaign;
	},

	addCampaignReference(
		campaignId: string,
		reference: {
			source: "pinterest_upload" | "pinterest_url" | "external_url";
			url: string;
			thumbnail_url?: string;
			title?: string;
			notes?: string;
			weight?: "primary" | "secondary";
		}
	) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		const board = campaign.creative_controls.reference_board;
		board.items.unshift({
			id: randomUUID(),
			source: reference.source,
			url: reference.url,
			thumbnail_url: reference.thumbnail_url,
			title: reference.title,
			notes: reference.notes,
			weight: reference.weight ?? "secondary",
			version: board.active_version + 1,
			created_at: now()
		});
		board.active_version += 1;
		board.history.unshift({
			version: board.active_version,
			label: reference.title ?? `Reference v${board.active_version}`,
			created_at: now(),
			reference_ids: board.items.slice(0, 8).flatMap(item => (item.id ? [item.id] : []))
		});

		campaign.updated_at = now();
		logAudit(store, "campaigns.reference.add", "campaign", campaign.id);
		return campaign;
	},

	refineAsset(
		campaignId: string,
		assetId: string,
		input: {
			reason?: string;
			prompt_text?: string;
			outfit_micro_adjustment?: {
				hem_length?: number;
				sleeve_roll?: number;
				collar_opening?: number;
			};
			pose_micro_rotation?: {
				shoulder_angle?: number;
				hip_shift?: number;
				chin_tilt?: number;
			};
			expression_micro_adjustment?: {
				smile_intensity?: number;
				brow_tension?: number;
				lip_tension?: number;
			};
			realism_tuning?: {
				skin_texture_realism?: number;
				shadow_accuracy?: number;
				depth_of_field?: number;
			};
		}
	) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		const asset = store.assets.find(item => item.id === assetId && item.campaign_id === campaignId);
		if (!asset) return null;

		const patch: Partial<CreativeControls> = {};
		if (input.outfit_micro_adjustment) {
			patch.outfit = {
				...campaign.creative_controls.outfit,
				micro_adjustment: {
					...campaign.creative_controls.outfit.micro_adjustment,
					...input.outfit_micro_adjustment
				}
			};
		}

		if (input.pose_micro_rotation) {
			patch.pose = {
				...campaign.creative_controls.pose,
				micro_rotation: {
					...campaign.creative_controls.pose.micro_rotation,
					...input.pose_micro_rotation
				}
			};
		}

		if (input.expression_micro_adjustment) {
			patch.expression = {
				...campaign.creative_controls.expression,
				...input.expression_micro_adjustment
			};
		}

		if (input.realism_tuning) {
			patch.realism = {
				...campaign.creative_controls.realism,
				...input.realism_tuning
			};
		}

		const stateIndex = store.assetRefinementStates.filter(state => state.asset_id === assetId).reduce((max, state) => Math.max(max, state.state_index), 0) + 1;

		store.assetRefinementStates.unshift({
			id: randomUUID(),
			campaign_id: campaignId,
			asset_id: assetId,
			state_index: stateIndex,
			label: input.reason ?? `Micro-refine ${stateIndex}`,
			controls_patch: patch as Record<string, unknown>,
			prompt_override: input.prompt_text ?? null,
			created_by: campaign.created_by,
			created_at: now()
		});

		campaign.creative_controls = mergeCreativeControls(campaign.creative_controls, patch);
		campaign.updated_at = now();

		asset.refinement_history.unshift({
			at: now(),
			reason: input.reason ?? "Micro refinement",
			state_index: stateIndex
		});
		asset.refinement_index = stateIndex;

		return {
			asset,
			state_index: stateIndex,
			creative_controls: campaign.creative_controls
		};
	},

	finalizeCampaign(campaignId: string) {
		const store = getStore();
		const campaign = store.campaigns.find(item => item.id === campaignId);
		if (!campaign) return null;

		const assets = store.assets.filter(asset => asset.campaign_id === campaignId);
		const approvedCount = assets.filter(asset => asset.status === "APPROVED").length;
		const rejectedCount = assets.filter(asset => asset.status === "REJECTED").length;

		campaign.status = approvedCount > 0 ? "APPROVED" : "REJECTED";
		campaign.updated_at = now();

		return {
			campaign_status: campaign.status,
			approved_count: approvedCount,
			rejected_count: rejectedCount
		};
	},

	analyticsDashboard() {
		const store = getStore();
		const published = store.campaigns.filter(campaign => campaign.status === "PUBLISHED").length;

		return {
			kpis: {
				total_views: 286000,
				total_reach: 125000,
				avg_engagement_rate: 4.8,
				avg_share_rate: 1.7,
				avg_save_rate: 1.4,
				total_posts: Math.max(1, published),
				top_post: {
					id: "demo-top-post",
					views: 42800,
					engagement_rate: 7.2
				}
			},
			model_breakdown: store.models.map(model => ({
				model_id: model.id,
				views: 64000,
				reach: 42000,
				engagement_rate: 4.6,
				share_rate: 1.6,
				save_rate: 1.3,
				post_count: 5
			})),
			trend_data: [
				{ date: "2026-02-20", views: 38400, engagement_rate: 4.1 },
				{ date: "2026-02-24", views: 51600, engagement_rate: 4.7 },
				{ date: "2026-02-28", views: 60200, engagement_rate: 5.2 }
			]
		};
	},

	analyticsPosts() {
		const store = getStore();
		const data = store.publishingQueue
			.filter(item => item.status === "PUBLISHED")
			.map(item => ({
				publishing_queue_id: item.id,
				ig_media_id: item.ig_media_id ?? `demo-${item.id.slice(0, 8)}`,
				impressions: 12000 + Math.floor(Math.random() * 4000),
				reach: 10000 + Math.floor(Math.random() * 5000),
				views: 18000 + Math.floor(Math.random() * 12000),
				engagement_rate: 3.5 + Math.random() * 2.5,
				share_rate: 1 + Math.random() * 1.4,
				save_rate: 0.8 + Math.random() * 1.2,
				likes_count: 900 + Math.floor(Math.random() * 250),
				comments_count: 45 + Math.floor(Math.random() * 20),
				saves_count: 140 + Math.floor(Math.random() * 60),
				shares_count: 180 + Math.floor(Math.random() * 75),
				replies_count: item.post_type === "story" ? 12 + Math.floor(Math.random() * 8) : 0,
				avg_watch_time_ms: item.post_type === "reel" ? 5200 + Math.floor(Math.random() * 1400) : null,
				post_type: item.post_type,
				profile_handle: store.models.find(model => model.id === store.campaigns.find(campaign => campaign.id === store.assets.find(a => a.id === item.asset_id)?.campaign_id)?.model_id)?.name ?? "Profile",
				fetched_at: item.published_at ?? item.updated_at,
				scheduled_at: item.scheduled_at,
				published_at: item.published_at ?? item.updated_at,
				queue: {
					asset: {
						campaign: store.campaigns.find(campaign => campaign.id === store.assets.find(a => a.id === item.asset_id)?.campaign_id)
					}
				}
			}));

		return {
			data,
			pagination: {
				page: 1,
				limit: 20,
				total: data.length
			}
		};
	},

	listApprovedAssets() {
		const store = getStore();

		return store.assets
			.filter(asset => asset.status === "APPROVED")
			.map(asset => {
				const campaign = store.campaigns.find(item => item.id === asset.campaign_id);
				const model = store.models.find(item => item.id === campaign?.model_id);
				return {
					...asset,
					campaign: campaign
						? {
								id: campaign.id,
								name: campaign.name,
								status: campaign.status
							}
						: null,
					model: model
						? {
								id: model.id,
								name: model.name
							}
						: null
				};
			});
	},

	getSettingBoolean(key: string, fallback: boolean) {
		const store = getStore();
		const entry = store.settings.find(item => item.key === key);
		return typeof entry?.value === "boolean" ? entry.value : fallback;
	},

	setSettingBoolean(key: string, value: boolean) {
		return this.setSettingValue(key, value);
	},

	setSettingValue(key: string, value: unknown) {
		const store = getStore();
		const existing = store.settings.find(item => item.key === key);
		if (existing) {
			existing.value = value;
		} else {
			store.settings.push({ key, value });
		}

		logAudit(store, "settings.update", "system_setting", key);

		return {
			key,
			value
		};
	},

	listSettings() {
		const store = getStore();
		return store.settings;
	},

	listUsers() {
		const store = getStore();
		return store.users;
	},

	listAudit() {
		const store = getStore();
		return store.audit;
	},

	listClients() {
		const store = getStore();
		return store.clients
			.map(client => ({
				...client,
				brand_profiles: store.brandProfiles.filter(brand => brand.client_id === client.id),
				assignments: store.clientAssignments.filter(assignment => assignment.client_id === client.id)
			}))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	},

	createClient(input: { name: string; notes?: string; status?: string; userId: string }) {
		const store = getStore();
		const client: DemoClient = {
			id: randomUUID(),
			name: input.name,
			status: input.status ?? "active",
			notes: input.notes ?? null,
			created_by: input.userId,
			created_at: now(),
			updated_at: now()
		};

		store.clients.unshift(client);
		logAudit(store, "clients.create", "client", client.id);
		return client;
	},

	listBrands() {
		const store = getStore();
		return store.brandProfiles
			.map(brand => ({
				...brand,
				client: store.clients.find(client => client.id === brand.client_id) ?? null
			}))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	},

	createBrand(input: { client_id: string; name: string; visual_direction?: Record<string, unknown>; voice_notes?: string; userId: string }) {
		const store = getStore();
		const brand: DemoBrandProfile = {
			id: randomUUID(),
			client_id: input.client_id,
			name: input.name,
			visual_direction: input.visual_direction ?? null,
			voice_notes: input.voice_notes ?? null,
			created_by: input.userId,
			created_at: now(),
			updated_at: now()
		};

		store.brandProfiles.unshift(brand);
		logAudit(store, "brands.create", "brand_profile", brand.id);
		return brand;
	},

	listRevenueContracts() {
		const store = getStore();
		return store.revenueContracts
			.map(contract => ({
				...contract,
				client: store.clients.find(client => client.id === contract.client_id) ?? null,
				entries: store.revenueEntries.filter(entry => entry.contract_id === contract.id),
				bonus_rules: []
			}))
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	},

	createRevenueContract(input: { client_id: string; contract_type: "RETAINER" | "RETAINER_PLUS_BONUS"; monthly_retainer_usd: number; starts_at: string; ends_at?: string; userId: string }) {
		const store = getStore();
		const contract: DemoRevenueContract = {
			id: randomUUID(),
			client_id: input.client_id,
			contract_type: input.contract_type,
			monthly_retainer_usd: input.monthly_retainer_usd,
			starts_at: input.starts_at,
			ends_at: input.ends_at ?? null,
			created_by: input.userId,
			created_at: now(),
			updated_at: now()
		};

		store.revenueContracts.unshift(contract);
		logAudit(store, "revenue.contract.create", "revenue_contract", contract.id);
		return contract;
	},

	listRevenueEntries() {
		const store = getStore();
		return store.revenueEntries
			.map(entry => {
				const contract = store.revenueContracts.find(row => row.id === entry.contract_id) ?? null;
				const client = contract ? (store.clients.find(row => row.id === contract.client_id) ?? null) : null;
				return {
					...entry,
					contract: contract
						? {
								...contract,
								client
							}
						: null
				};
			})
			.sort((a, b) => new Date(b.reference_month).getTime() - new Date(a.reference_month).getTime());
	},

	createRevenueEntry(input: { contract_id: string; type: "RETAINER" | "BONUS" | "ADJUSTMENT"; amount_usd: number; reference_month: string; notes?: string }) {
		const store = getStore();
		const entry: DemoRevenueEntry = {
			id: randomUUID(),
			contract_id: input.contract_id,
			type: input.type,
			amount_usd: input.amount_usd,
			reference_month: input.reference_month,
			notes: input.notes ?? null,
			created_at: now()
		};

		store.revenueEntries.unshift(entry);
		logAudit(store, "revenue.entry.create", "revenue_entry", entry.id);
		return entry;
	},

	clientDashboard() {
		const store = getStore();
		return {
			clients: store.clients.map(client => ({
				...client,
				assignments: store.clientAssignments
					.filter(assignment => assignment.client_id === client.id)
					.map(assignment => ({
						...assignment,
						model: store.models.find(model => model.id === assignment.model_id) ?? null
					})),
				revenue_contracts: store.revenueContracts
					.filter(contract => contract.client_id === client.id)
					.map(contract => ({
						...contract,
						entries: store.revenueEntries.filter(entry => entry.contract_id === contract.id)
					}))
			}))
		};
	},

	schedulePost(input: {
		asset_id: string;
		variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
		post_type: "feed" | "story" | "reel";
		caption: string;
		hashtag_preset_id?: string;
		scheduled_at: string;
		created_by: string;
	}) {
		const store = getStore();
		const requiresApproval = this.getSettingBoolean("require_publishing_approval", true);

		const record: DemoPublishingQueue = {
			id: randomUUID(),
			asset_id: input.asset_id,
			variant_type: input.variant_type,
			post_type: input.post_type,
			caption: input.caption,
			hashtag_preset_id: input.hashtag_preset_id ?? null,
			status: requiresApproval ? "PENDING_APPROVAL" : "SCHEDULED",
			scheduled_at: input.scheduled_at,
			published_at: null,
			ig_media_id: null,
			ig_container_id: null,
			retry_count: 0,
			retry_after: null,
			rejection_reason: null,
			error_message: null,
			created_by: input.created_by,
			created_at: now(),
			updated_at: now()
		};

		store.publishingQueue.unshift(record);
		logAudit(store, "publishing.schedule", "publishing_queue", record.id);

		return record;
	},

	listPublishingQueue(filters: { start: string; end: string; model_id?: string }) {
		const store = getStore();
		const startTs = new Date(filters.start).getTime();
		const endTs = new Date(filters.end).getTime();

		return store.publishingQueue
			.filter(item => {
				const ts = new Date(item.scheduled_at).getTime();
				if (ts < startTs || ts > endTs) return false;

				if (!filters.model_id) return true;
				const asset = store.assets.find(a => a.id === item.asset_id);
				const campaign = store.campaigns.find(c => c.id === asset?.campaign_id);
				return campaign?.model_id === filters.model_id;
			})
			.map(item => {
				const asset = store.assets.find(a => a.id === item.asset_id) ?? null;
				const campaign = asset ? (store.campaigns.find(c => c.id === asset.campaign_id) ?? null) : null;
				return {
					...item,
					asset: asset
						? {
								...asset,
								campaign
							}
						: null
				};
			})
			.sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
	},

	approvePost(id: string) {
		const store = getStore();
		const item = store.publishingQueue.find(entry => entry.id === id);
		if (!item) return null;
		if (item.status !== "PENDING_APPROVAL") return null;

		item.status = "SCHEDULED";
		item.rejection_reason = null;
		item.error_message = null;
		item.updated_at = now();
		logAudit(store, "publishing.approve", "publishing_queue", id);
		return item;
	},

	rejectPost(id: string, reason: string) {
		const store = getStore();
		const item = store.publishingQueue.find(entry => entry.id === id);
		if (!item) return null;
		if (item.status !== "PENDING_APPROVAL") return null;

		item.status = "REJECTED";
		item.rejection_reason = reason;
		item.error_message = null;
		item.retry_after = null;
		item.updated_at = now();
		logAudit(store, "publishing.reject", "publishing_queue", id);
		return item;
	},

};
