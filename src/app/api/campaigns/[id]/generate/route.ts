import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getEnv } from "@/lib/env";
import { DEFAULT_COST_PER_IMAGE_BASE, estimateImageGenerationCost, type ImageCostProvider } from "@/lib/image-cost";
import { getImageProvider } from "@/server/providers";
import type { ImageGenerationResponse } from "@/server/providers/image/types";
import { generateCampaignSchema } from "@/server/schemas/api";
import { creativeControlsSchema, type ImageModelProvider } from "@/server/schemas/creative";
import { buildCreativePromptFragments, createDefaultCreativeControls, estimateIdentityDriftScore, mergeCreativeControls, shouldAlertIdentityDrift } from "@/server/services/creative-controls";
import { generateDeterministicSeeds } from "@/server/services/prompt-builder";
import { calculateBudgetUsagePercentage, isBudgetExceeded, isBudgetWarning } from "@/server/services/gpu-budget";
import { canTransitionCampaign } from "@/server/services/campaign-state";
import { CampaignGenerationValidationError, resolveCampaignGenerationPlan, type CampaignGenerationMode } from "@/server/services/campaign-generation-plan";
import { createSignedReadUrlForGcsUri } from "@/server/services/storage/gcs-storage";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export const maxDuration = 60;
const MAX_MODEL_IDENTITY_REFERENCES = 4;
const MAX_MODEL_IMPORTED_IDENTITY_REFERENCES = 4;
const MODEL_IDENTITY_REFERENCE_PREFIX = "Model Identity";
const MODEL_IMPORTED_REFERENCE_PREFIX = "Model Imported";
const BUDGET_SETTING_KEY = "gpu_monthly_budget_usd";
const GPU_COST_RATE_SETTING_KEY = "gpu_cost_per_ms";
const COST_PER_1K_SETTING_KEYS: Record<ImageCostProvider, string> = {
	gpu: "image_cost_per_1k_gpu_usd",
	openai: "image_cost_per_1k_openai_usd",
	nano_banana_2: "image_cost_per_1k_nano_banana_2_usd",
	zai_glm: "image_cost_per_1k_zai_glm_usd"
};

type ProviderReferenceInput = {
	url: string;
	source: "pinterest_upload" | "pinterest_url" | "external_url";
	title?: string;
	weight: "primary" | "secondary";
	similarity_score?: number;
};

type CampaignReferenceOrigin = "campaign_board" | "pose" | "aesthetic_lut" | "model_identity" | "model_imported" | "campaign_anchor" | "refinement_base";

type CampaignGenerationReference = ProviderReferenceInput & {
	origin: CampaignReferenceOrigin;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const env = getEnv();
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);
		// Image generation is expensive — limit to 20 per minute per user
		withRateLimit(session.userId, { maxRequests: 20 });

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const body = validateOrThrow(generateCampaignSchema, await request.json());
		const selectiveRegeneration = Boolean(body.regenerate_asset_id);
		const generationMode = body.generation_mode;

		if (isDemoMode()) {
			const campaign = demoStore.getCampaign(id);
			if (!campaign) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
			}

			if (!selectiveRegeneration && !canTransitionCampaign(campaign.status, "GENERATING")) {
				throw new ApiError(409, "CONFLICT", "This campaign can't move to that step right now. Please refresh and try again.");
			}

			const controls = mergeCreativeControls(campaign.creative_controls ? creativeControlsSchema.parse(campaign.creative_controls) : createDefaultCreativeControls(), body.creative_controls_override);
			let promptText = mergePromptWithCreativeControls(body.prompt_text, controls);
			const plan = resolveGenerationPlanOrThrow({
				generationMode,
				isSelectiveRegeneration: selectiveRegeneration,
				batchSize: campaign.batch_size,
				provider: campaign.image_model_provider,
				persistedAnchorAssetId: campaign.anchor_asset_id,
				requestedAnchorAssetId: body.anchor_asset_id
			});

			let effectiveAnchorAssetId = plan.anchorAssetId;
			if (plan.requiresAnchorValidation && effectiveAnchorAssetId) {
				const anchorAsset = campaign.assets.find(asset => asset.id === effectiveAnchorAssetId);
				if (!anchorAsset) {
					throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected anchor asset. Please choose another one.");
				}
				effectiveAnchorAssetId = anchorAsset.id;
			}

			if (!selectiveRegeneration && plan.generationMode === "batch") {
				promptText = prependSceneLockPrompt(promptText);
			}

			if (plan.shouldPersistAnchor && effectiveAnchorAssetId) {
				const persisted = demoStore.setCampaignAnchor(id, effectiveAnchorAssetId);
				if (!persisted) {
					throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected anchor asset. Please choose another one.");
				}
			}

			const generated = demoStore.generateCampaign(id, promptText, body.creative_controls_override, body.regenerate_asset_id, plan.generationMode, effectiveAnchorAssetId);
			if (!generated) {
				throw new ApiError(400, "VALIDATION_ERROR", "Generation request details are invalid. Please review your input and try again.");
			}

			return ok(
				{
					job_id: generated.job_id,
					campaign_status: generated.campaign_status,
					generation_mode: plan.generationMode,
					anchor_asset_id: generated.anchor_asset_id ?? effectiveAnchorAssetId ?? null,
					budget_warning: false,
					identity_drift_alert: generated.identity_drift_alert
				},
				202
			);
		}

		const campaign = await prisma.campaign.findUnique({
			where: { id },
			include: {
				assets: { orderBy: { sequence_number: "desc" }, take: 1 },
				model: {
					include: {
						model_versions: {
							where: { is_active: true },
							take: 1
						},
						canonical_references: {
							select: {
								pack_version: true,
								sort_order: true,
								shot_code: true,
								reference_image_url: true
							},
							orderBy: [{ pack_version: "desc" }, { sort_order: "asc" }]
						},
						source_references: {
							where: { status: "ACCEPTED" },
							select: {
								sort_order: true,
								image_gcs_uri: true
							},
							orderBy: [{ sort_order: "asc" }, { created_at: "asc" }]
						}
					}
				}
			}
		});

		if (!campaign) {
			throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
		}

		if (!selectiveRegeneration && !canTransitionCampaign(campaign.status, "GENERATING")) {
			throw new ApiError(409, "CONFLICT", "This campaign can't move to that step right now. Please refresh and try again.");
		}

		const plan = resolveGenerationPlanOrThrow({
			generationMode,
			isSelectiveRegeneration: selectiveRegeneration,
			batchSize: campaign.batch_size,
			provider: campaign.image_model_provider,
			persistedAnchorAssetId: campaign.anchor_asset_id,
			requestedAnchorAssetId: body.anchor_asset_id
		});

		let previousAssetUrl: string | undefined;
		let anchorAssetUrl: string | undefined;
		const effectiveAnchorAssetId = plan.anchorAssetId;

		if (body.regenerate_asset_id) {
			const asset = await prisma.asset.findUnique({ where: { id: body.regenerate_asset_id } });
			if (!asset || asset.campaign_id !== campaign.id) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected image to regenerate. Refresh and try again.");
			}
			previousAssetUrl = asset.raw_gcs_uri;
		}

		if (plan.requiresAnchorValidation && effectiveAnchorAssetId) {
			const anchorAsset = await prisma.asset.findUnique({ where: { id: effectiveAnchorAssetId } });
			if (!anchorAsset || anchorAsset.campaign_id !== campaign.id) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find the selected anchor asset. Please choose another one.");
			}
			anchorAssetUrl = anchorAsset.raw_gcs_uri;
		}

		const settings = await prisma.systemSetting.findMany({
			where: {
				key: {
					in: [BUDGET_SETTING_KEY, GPU_COST_RATE_SETTING_KEY, ...Object.values(COST_PER_1K_SETTING_KEYS)]
				}
			}
		});

		const cap = readNumericSetting(settings, BUDGET_SETTING_KEY, 500);
		const costPerMs = readNumericSetting(settings, GPU_COST_RATE_SETTING_KEY, 0.0000005);
		const providerBaseCosts = resolveProviderBaseCosts(settings);

		const monthStart = new Date();
		monthStart.setUTCDate(1);
		monthStart.setUTCHours(0, 0, 0, 0);

		const monthlyAggregate = await prisma.generationJob.aggregate({
			where: {
				dispatched_at: {
					gte: monthStart
				}
			},
			_sum: { estimated_cost_usd: true }
		});

		const spend = Number(monthlyAggregate._sum.estimated_cost_usd ?? 0);
		if (isBudgetExceeded(spend, cap)) {
			throw new ApiError(403, "GPU_BUDGET_EXCEEDED", "Monthly GPU budget is reached. Please wait or raise the budget.");
		}

		const controls = mergeCreativeControls(campaign.creative_controls ? creativeControlsSchema.parse(campaign.creative_controls) : createDefaultCreativeControls(), body.creative_controls_override);
		let promptText = mergePromptWithCreativeControls(body.prompt_text, controls);
		if (!selectiveRegeneration && plan.generationMode === "batch") {
			promptText = prependSceneLockPrompt(promptText);
		}

		const baseSeed = randomInt(10_000, 900_000);
		const seeds = generateDeterministicSeeds(baseSeed, plan.generationBatchSize);
		const activeVersion = campaign.model.model_versions[0];
		const provider = campaign.image_model_provider;

		if (provider === "gpu" && !activeVersion) {
			throw new ApiError(400, "VALIDATION_ERROR", "This model has no active version. Activate one version and try again.");
		}

		const jobId = randomUUID();
		const references: CampaignGenerationReference[] = controls.reference_board.items.map(item => ({
			url: item.url,
			source: item.source,
			title: item.title,
			weight: item.weight,
			similarity_score: item.similarity_score,
			origin: "campaign_board"
		}));
		references.unshift(...buildModelIdentityReferences(campaign.model.active_canonical_pack_version, campaign.model.canonical_references, campaign.model.source_references));
		if (!selectiveRegeneration && plan.generationMode === "batch" && anchorAssetUrl) {
			references.unshift({
				url: anchorAssetUrl,
				source: "external_url",
				title: "Campaign Anchor Scene",
				weight: "primary",
				similarity_score: 1.0,
				origin: "campaign_anchor"
			});
		}

		if (controls.pose.pose_reference_url) {
			references.push({
				url: controls.pose.pose_reference_url,
				source: "external_url",
				title: "Target Pose Execution",
				weight: "secondary",
				origin: "pose"
			});
		}

		if (controls.aesthetic.color_grading_lut_url) {
			references.push({
				url: controls.aesthetic.color_grading_lut_url,
				source: "external_url",
				title: "Color Grading LUT Reference",
				weight: "secondary",
				origin: "aesthetic_lut"
			});
		}

		if (previousAssetUrl) {
			references.unshift({
				url: previousAssetUrl,
				source: "external_url",
				title: "Base Image for Refinement / Inpainting",
				weight: "primary",
				similarity_score: 1.0,
				origin: "refinement_base"
			});
			promptText = `Using the provided base image, apply the following refinements. Preserve the original composition, identity, and style unless explicitly requested otherwise. Refinement instructions: ${promptText}`;
		}
		const resolvedReferences = await normalizeReferencesForGeneration(references);
		const providerReferences: ProviderReferenceInput[] = resolvedReferences.map(toProviderReference);
		const referenceStats = summarizeReferenceOrigins(resolvedReferences);
		const providerOrder = resolveProviderOrder(provider);
		const projectedCostByProvider = providerOrder.reduce<Partial<Record<ImageModelProvider, number>>>((accumulator, candidateProvider) => {
			accumulator[candidateProvider] = estimateProjectedProviderCost({
				provider: candidateProvider,
				batchSize: plan.generationBatchSize,
				width: campaign.resolution_width,
				height: campaign.resolution_height,
				referenceCount: providerReferences.length,
				promptLength: promptText.length,
				providerBaseCosts,
				gpuRatePerMs: costPerMs
			});
			return accumulator;
		}, {});
		const conservativeProjectedCost = Number(Math.max(...providerOrder.map(candidateProvider => projectedCostByProvider[candidateProvider] ?? 0)).toFixed(4));
		const spendAfterProjected = Number((spend + conservativeProjectedCost).toFixed(4));
		const projectedUsagePercentage = calculateBudgetUsagePercentage(spendAfterProjected, cap);

		if (isBudgetExceeded(spendAfterProjected, cap)) {
			throw new ApiError(403, "GPU_BUDGET_EXCEEDED", "This request would exceed the monthly generation budget. Reduce scope and try again.", {
				spend_usd: Number(spend.toFixed(4)),
				cap_usd: cap,
				projected_cost_usd: conservativeProjectedCost,
				projected_usage_percentage: projectedUsagePercentage
			});
		}

		const warning = isBudgetWarning(spendAfterProjected, cap);

		const generated = await generateCampaignWithReliability({
			preferredProvider: provider,
			preferredModelId: campaign.image_model_id ?? undefined,
			jobId,
			promptText,
			negativePrompt: campaign.negative_prompt ?? "",
			width: campaign.resolution_width,
			height: campaign.resolution_height,
			batchSize: plan.generationBatchSize,
			seeds,
			upscale: campaign.upscale,
			outputPathPrefix: `${campaign.model_id}/${campaign.id}/`,
			callbackUrl: `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/gpu-complete`,
			callbackSecret: env.GPU_WEBHOOK_SECRET,
			loraUrl: activeVersion ? `${activeVersion.lora_gcs_uri}?signed=true&expires=1800` : undefined,
			loraStrength: activeVersion ? Number(activeVersion.lora_strength) : undefined,
			creativeControls: controls,
			references: providerReferences,
			env
		});
		const response = generated.response;
		const providerUsed = generated.provider;
		const estimatedTimeMs = response.estimated_time_ms ?? plan.generationBatchSize * 70_000;
		const estimatedCost =
			providerUsed === "gpu"
				? Number((estimatedTimeMs * costPerMs).toFixed(4))
				: estimateImageGenerationCost({
						provider: providerUsed as ImageCostProvider,
						batchSize: response.assets?.length ?? plan.generationBatchSize,
						width: campaign.resolution_width,
						height: campaign.resolution_height,
						referenceCount: providerReferences.length,
						promptLength: promptText.length,
						providerBaseCosts
					}).totalUsd;
		const providerPayload = {
			...(response.provider_payload ?? {}),
			provider_requested: provider,
			provider_used: providerUsed,
			model_id_used: generated.modelId,
			generation_mode: plan.generationMode,
			anchor_asset_id: effectiveAnchorAssetId ?? null,
			projected_cost_usd: conservativeProjectedCost,
			projected_cost_by_provider_usd: projectedCostByProvider,
			budget_cap_usd: cap,
			budget_spend_before_usd: Number(spend.toFixed(4)),
			budget_spend_after_projected_usd: spendAfterProjected,
			budget_usage_after_projected_pct: projectedUsagePercentage,
			estimated_cost_usd: estimatedCost,
			reference_images_requested: references.length,
			reference_images_resolved: resolvedReferences.length,
			reference_images_skipped: references.length - resolvedReferences.length,
			reference_images_model_identity: referenceStats.model_identity,
			reference_images_model_imported: referenceStats.model_imported,
			reference_images_campaign_board: referenceStats.campaign_board,
			reference_images_campaign_anchor: referenceStats.campaign_anchor,
			reference_images_refinement_base: referenceStats.refinement_base,
			reference_images_pose: referenceStats.pose,
			reference_images_aesthetic_lut: referenceStats.aesthetic_lut
		};

		const driftScore = estimateIdentityDriftScore(controls);
		const driftAlert = shouldAlertIdentityDrift(controls, driftScore);
		const sequenceStart = (campaign.assets[0]?.sequence_number ?? 0) + 1;
		const completed = response.status === "completed" && response.assets && response.assets.length > 0;

		await prisma.$transaction(async tx => {
			await tx.campaign.update({
				where: { id: campaign.id },
				data: {
					status: completed ? "REVIEW" : "GENERATING",
					prompt_text: promptText,
					base_seed: baseSeed,
					error_message: null,
					creative_controls: controls,
					anchor_asset_id: plan.shouldPersistAnchor ? effectiveAnchorAssetId : undefined
				}
			});

			await tx.generationJob.create({
				data: {
					id: jobId,
					campaign_id: campaign.id,
					status: completed ? "COMPLETED" : "DISPATCHED",
					gpu_provider: providerUsed,
					payload: toInputJson(providerPayload),
					response_payload: toInputJson(providerPayload),
					generation_time_ms: completed ? response.assets?.reduce((sum, asset) => sum + asset.generation_time_ms, 0) : null,
					estimated_cost_usd: estimatedCost,
					retry_count: 0,
					completed_at: completed ? new Date() : null
				}
			});

			if (completed) {
				const assets = response.assets ?? [];

				if (assets.length > 0) {
					await tx.asset.createMany({
						data: assets.map((asset, index) => ({
							campaign_id: campaign.id,
							job_id: jobId,
							status: "PENDING",
							raw_gcs_uri: asset.uri,
							seed: asset.seed,
							width: asset.width,
							height: asset.height,
							prompt_text: promptText,
							generation_time_ms: asset.generation_time_ms,
							sequence_number: sequenceStart + index,
							identity_drift_score: driftScore,
							refinement_index: body.regenerate_asset_id ? 1 : 0
						}))
					});
				}

				if (body.regenerate_asset_id) {
					const stateCount = await tx.assetRefinementState.count({
						where: { asset_id: body.regenerate_asset_id }
					});

					await tx.assetRefinementState.create({
						data: {
							campaign_id: campaign.id,
							asset_id: body.regenerate_asset_id,
							state_index: stateCount + 1,
							label: `Regeneration ${stateCount + 1}`,
							controls_patch: body.creative_controls_override ?? {},
							prompt_override: promptText,
							created_by: session.userId
						}
					});
				}
			}
		});

		return ok(
			{
				job_id: response.job_id,
				campaign_status: completed ? "REVIEW" : "GENERATING",
				provider_used: providerUsed,
				generation_mode: plan.generationMode,
				anchor_asset_id: effectiveAnchorAssetId ?? campaign.anchor_asset_id ?? null,
				budget_warning: warning,
				identity_drift_alert: driftAlert.alert,
				identity_drift_score: driftScore,
				identity_drift_threshold: driftAlert.threshold
			},
			202
		);
	});
}

function mergePromptWithCreativeControls(promptText: string, controls: z.infer<typeof creativeControlsSchema>): string {
	const additions = buildCreativePromptFragments(controls).filter(fragment => !promptText.includes(fragment));
	if (additions.length === 0) {
		return promptText;
	}

	return `${promptText}, ${additions.join(", ")}`;
}

function prependSceneLockPrompt(promptText: string): string {
	const sceneLockInstruction =
		"Use the attached campaign anchor image as the scene lock. Keep the same environment, location, background design, lighting direction/intensity, and styling continuity. " +
		"Create a different shot from the same campaign with variation only in pose, camera angle, framing, and perspective while preserving identity and realism.";

	if (promptText.includes(sceneLockInstruction)) {
		return promptText;
	}

	return `${sceneLockInstruction} ${promptText}`;
}

function resolveGenerationPlanOrThrow(input: {
	generationMode: CampaignGenerationMode;
	isSelectiveRegeneration: boolean;
	batchSize: number;
	provider: ImageModelProvider;
	persistedAnchorAssetId?: string | null;
	requestedAnchorAssetId?: string;
}) {
	try {
		return resolveCampaignGenerationPlan(input);
	} catch (error) {
		if (error instanceof CampaignGenerationValidationError) {
			throw new ApiError(400, "VALIDATION_ERROR", error.message, { code: error.code });
		}
		throw error;
	}
}

async function generateCampaignWithReliability(input: {
	preferredProvider: ImageModelProvider;
	preferredModelId?: string;
	jobId: string;
	promptText: string;
	negativePrompt: string;
	width: number;
	height: number;
	batchSize: number;
	seeds: number[];
	upscale: boolean;
	outputPathPrefix: string;
	callbackUrl: string;
	callbackSecret: string;
	loraUrl?: string;
	loraStrength?: number;
	controlnet?: {
		model: string;
		images: string[];
		strength: number;
	};
	creativeControls: z.infer<typeof creativeControlsSchema>;
	references: ProviderReferenceInput[];
	env: ReturnType<typeof getEnv>;
}): Promise<{ provider: ImageModelProvider; modelId: string; response: ImageGenerationResponse }> {
	const providerOrder = resolveProviderOrder(input.preferredProvider);
	let lastError: unknown;

	for (const provider of providerOrder) {
		const modelId = resolveModelIdForProvider({
			provider,
			preferredProvider: input.preferredProvider,
			preferredModelId: input.preferredModelId,
			env: input.env
		});

		try {
			const response = await getImageProvider(provider).generate({
				job_id: input.jobId,
				model_provider: provider,
				model_id: modelId,
				prompt_text: input.promptText,
				negative_prompt: input.negativePrompt,
				width: input.width,
				height: input.height,
				batch_size: input.batchSize,
				seeds: input.seeds,
				upscale: input.upscale,
				output_path_prefix: input.outputPathPrefix,
				callback: {
					url: input.callbackUrl,
					secret: input.callbackSecret
				},
				model_config: {
					base_model: modelId,
					lora_url: provider === "gpu" ? input.loraUrl : undefined,
					lora_strength: provider === "gpu" ? input.loraStrength : undefined
				},
				controlnet: input.controlnet,
				creative_controls: input.creativeControls,
				references: input.references
			});

			if (response.status === "completed" && (!response.assets || response.assets.length === 0)) {
				throw new ApiError(502, "INTERNAL_ERROR", `The Image Engine completed the request but returned no images. Try again or switch Image Engines.`);
			}

			return { provider, modelId, response };
		} catch (error) {
			lastError = error;
		}
	}

	if (lastError instanceof Error) {
		throw lastError;
	}
	throw new ApiError(502, "INTERNAL_ERROR", "Image generation failed across all configured image engines. Please check settings and retry.");
}

function resolveProviderOrder(preferred: ImageModelProvider): ImageModelProvider[] {
	if (preferred === "openai") return ["openai", "nano_banana_2"];
	if (preferred === "zai_glm") return ["zai_glm", "nano_banana_2"];
	if (preferred === "nano_banana_2") return ["nano_banana_2"];
	return ["gpu"];
}

function resolveModelIdForProvider(input: { provider: ImageModelProvider; preferredProvider: ImageModelProvider; preferredModelId?: string; env: ReturnType<typeof getEnv> }): string {
	if (input.provider === input.preferredProvider && input.preferredModelId?.trim()) {
		return input.preferredModelId.trim();
	}

	if (input.provider === "openai") return input.env.OPENAI_IMAGE_MODEL;
	if (input.provider === "nano_banana_2") return input.env.NANO_BANANA_MODEL;
	if (input.provider === "zai_glm") return input.env.ZAI_IMAGE_MODEL;
	return input.preferredModelId?.trim() || "sdxl-1.0";
}

export function buildModelIdentityReferences(
	activePackVersion: number,
	references: Array<{ pack_version: number; sort_order: number; shot_code: string; reference_image_url: string }>,
	importedReferences: Array<{ sort_order: number; image_gcs_uri: string }>
): CampaignGenerationReference[] {
	const canonical: CampaignGenerationReference[] = [];

	if (references.length > 0) {
		const activePackReferences = activePackVersion > 0 ? references.filter(item => item.pack_version === activePackVersion) : [];
		const source = activePackReferences.length > 0 ? activePackReferences : references.filter(item => item.pack_version === references[0]?.pack_version);

		canonical.push(
			...source.slice(0, MAX_MODEL_IDENTITY_REFERENCES).map((item, index) => ({
				url: item.reference_image_url,
				source: "external_url" as const,
				title: `${MODEL_IDENTITY_REFERENCE_PREFIX} ${item.shot_code}`,
				weight: index === 0 ? ("primary" as const) : ("secondary" as const),
				similarity_score: Number((1 - index * 0.01).toFixed(2)),
				origin: "model_identity" as const
			}))
		);
	}

	const imported = importedReferences.slice(0, MAX_MODEL_IMPORTED_IDENTITY_REFERENCES).map((item, index) => ({
		url: item.image_gcs_uri,
		source: "external_url" as const,
		title: `${MODEL_IMPORTED_REFERENCE_PREFIX} ${item.sort_order + 1}`,
		weight: canonical.length === 0 && index === 0 ? ("primary" as const) : ("secondary" as const),
		similarity_score: Number((0.95 - index * 0.01).toFixed(2)),
		origin: "model_imported" as const
	}));

	return [...canonical, ...imported];
}

async function normalizeReferencesForGeneration(references: CampaignGenerationReference[]): Promise<CampaignGenerationReference[]> {
	const deduped: CampaignGenerationReference[] = [];
	const seen = new Set<string>();

	for (const reference of references) {
		const trimmedUrl = reference.url.trim();
		if (!trimmedUrl) continue;

		const dedupKey = trimmedUrl.toLowerCase();
		if (seen.has(dedupKey)) continue;
		seen.add(dedupKey);

		const resolvedUrl = await resolveReferenceUrl(trimmedUrl);
		if (!resolvedUrl) continue;

		deduped.push({
			...reference,
			url: resolvedUrl
		});
	}

	return deduped;
}

async function resolveReferenceUrl(url: string): Promise<string | null> {
	if (url.startsWith("gs://")) {
		try {
			return await createSignedReadUrlForGcsUri(url, 1800);
		} catch {
			return null;
		}
	}

	if (url.startsWith("data:image/")) {
		return url;
	}

	if (isHttpUrl(url)) {
		return url;
	}

	return null;
}

function isHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function summarizeReferenceOrigins(references: CampaignGenerationReference[]): Record<CampaignReferenceOrigin, number> {
	return references.reduce<Record<CampaignReferenceOrigin, number>>(
		(accumulator, reference) => {
			accumulator[reference.origin] += 1;
			return accumulator;
		},
		{
			campaign_board: 0,
			pose: 0,
			aesthetic_lut: 0,
			model_identity: 0,
			model_imported: 0,
			campaign_anchor: 0,
			refinement_base: 0
		}
	);
}

function toProviderReference(reference: CampaignGenerationReference): ProviderReferenceInput {
	return {
		url: reference.url,
		source: reference.source,
		title: reference.title,
		weight: reference.weight,
		similarity_score: reference.similarity_score
	};
}

function readNumericSetting(settings: Array<{ key: string; value: unknown }>, key: string, fallback: number): number {
	const entry = settings.find(item => item.key === key);
	const numeric = Number(entry?.value);
	if (!Number.isFinite(numeric) || numeric <= 0) {
		return fallback;
	}

	return numeric;
}

function resolveProviderBaseCosts(settings: Array<{ key: string; value: unknown }>): Record<ImageCostProvider, number> {
	return {
		gpu: readNumericSetting(settings, COST_PER_1K_SETTING_KEYS.gpu, DEFAULT_COST_PER_IMAGE_BASE.gpu),
		openai: readNumericSetting(settings, COST_PER_1K_SETTING_KEYS.openai, DEFAULT_COST_PER_IMAGE_BASE.openai),
		nano_banana_2: readNumericSetting(settings, COST_PER_1K_SETTING_KEYS.nano_banana_2, DEFAULT_COST_PER_IMAGE_BASE.nano_banana_2),
		zai_glm: readNumericSetting(settings, COST_PER_1K_SETTING_KEYS.zai_glm, DEFAULT_COST_PER_IMAGE_BASE.zai_glm)
	};
}

function estimateProjectedProviderCost(input: {
	provider: ImageModelProvider;
	batchSize: number;
	width: number;
	height: number;
	referenceCount: number;
	promptLength: number;
	providerBaseCosts: Record<ImageCostProvider, number>;
	gpuRatePerMs: number;
}): number {
	if (input.provider === "gpu") {
		const projectedGenerationTimeMs = input.batchSize * 70_000;
		return Number((projectedGenerationTimeMs * input.gpuRatePerMs).toFixed(4));
	}

	return estimateImageGenerationCost({
		provider: input.provider,
		batchSize: input.batchSize,
		width: input.width,
		height: input.height,
		referenceCount: input.referenceCount,
		promptLength: input.promptLength,
		providerBaseCosts: input.providerBaseCosts
	}).totalUsd;
}

