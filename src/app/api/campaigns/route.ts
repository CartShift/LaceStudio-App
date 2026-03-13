import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getEnv } from "@/lib/env";
import { toPagination } from "@/server/repositories/pagination";
import { campaignCreateSchema } from "@/server/schemas/api";
import type { ImageModelProvider } from "@/server/schemas/creative";
import { resolveRequestedCampaignModelIds } from "@/server/services/campaign-linked-sets";
import { buildPrompt } from "@/server/services/prompt-builder";
import { createDefaultCreativeControls, enrichReferenceBoard, mergeCreativeControls } from "@/server/services/creative-controls";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const querySchema = z.object({
	model_id: z.uuid().optional(),
	status: z.enum(["DRAFT", "GENERATING", "REVIEW", "APPROVED", "REJECTED", "SCHEDULED", "PUBLISHED", "FAILED"]).optional(),
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().optional(),
	sort_by: z.enum(["created_at", "updated_at"]).optional()
});

export async function GET(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const query = validateOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));

		const { skip, take, page, limit } = toPagination(query);

		if (isDemoMode()) {
			const data = demoStore.listCampaigns({
				model_id: query.model_id,
				status: query.status
			});

			return ok({
				data: data.slice(skip, skip + take),
				pagination: { page, limit, total: data.length }
			});
		}

		const where = {
			...(query.model_id ? { model_id: query.model_id } : {}),
			...(query.status ? { status: query.status } : {})
		};

		const [data, total] = await prisma.$transaction([
			prisma.campaign.findMany({
				where,
				skip,
				take,
				orderBy: {
					[query.sort_by ?? "created_at"]: "desc"
				},
				include: {
					model: { select: { id: true, name: true } },
					assets: true,
					generation_jobs: { orderBy: { dispatched_at: "desc" } }
				}
			}),
			prisma.campaign.count({ where })
		]);

		const groupIds = [...new Set(data.flatMap(item => (item.campaign_group_id ? [item.campaign_group_id] : [])))];
		const linkedCounts = groupIds.length
			? await prisma.campaign.groupBy({
					by: ["campaign_group_id"],
					where: {
						campaign_group_id: {
							in: groupIds
						}
					},
					_count: {
						_all: true
					}
				})
			: [];
		const linkedCountByGroup = new Map(
			linkedCounts.flatMap(item => (item.campaign_group_id ? [[item.campaign_group_id, item._count._all]] : []))
		);

		return ok({
			data: data.map(item => ({
				...item,
				linked_campaign_count: item.campaign_group_id ? linkedCountByGroup.get(item.campaign_group_id) ?? 1 : 1
			})),
			pagination: { page, limit, total }
		});
	});
}

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const env = getEnv();
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);
		withRateLimit(session.userId, { maxRequests: 30 });
		const body = validateOrThrow(campaignCreateSchema, await request.json());
		const requestedModelIds = resolveRequestedCampaignModelIds(body);
		const imageModelProvider = body.image_model?.provider ?? env.IMAGE_PROVIDER_DEFAULT;
		const imageModelId = body.image_model?.model_id ?? defaultModelId(imageModelProvider, env);
		const mergedControls = mergeCreativeControls(createDefaultCreativeControls(), body.creative_controls);
		const creativeControls = mergedControls.reference_board.items.length > 0 ? enrichReferenceBoard(mergedControls, { versionOverride: 1, label: "Initial reference board" }) : mergedControls;

		if (isDemoMode()) {
			const models = demoStore.listModels();
			const modelById = new Map(models.map(model => [model.id, model]));
			const targetModels = requestedModelIds.map(modelId => modelById.get(modelId) ?? null);

			if (targetModels.some(model => !model)) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find one or more selected models. Please refresh and try again.");
			}

			if (targetModels.some(model => model?.status !== "ACTIVE")) {
				throw new ApiError(400, "VALIDATION_ERROR", "Campaigns can only be created for active models.");
			}

			if (imageModelProvider === "gpu") {
				for (const model of targetModels) {
					const detail = model ? demoStore.getModel(model.id) : null;
					if (!(detail?.model_versions.some(version => version.is_active) ?? false)) {
						throw new ApiError(400, "VALIDATION_ERROR", "One or more selected models have no active version for GPU image creation. Use another Image Engine or activate a version.");
					}
				}
			}

			const moodTag = demoStore.getDefaultCampaignMoodTag();
			const campaignGroupId = targetModels.length > 1 ? randomUUID() : null;
			const createdCampaigns = targetModels.map(model => {
				if (!model) {
					throw new ApiError(404, "NOT_FOUND", "We couldn't find one or more selected models. Please refresh and try again.");
				}

				const prompt = buildPrompt({
					modelName: model.name,
					moodTag,
					customPromptAdditions: body.custom_prompt_additions,
					negativePrompt: body.negative_prompt,
					creativeControls
				});

				return demoStore.createCampaign({
					name: buildCreatedCampaignName({
						requestedName: body.name,
						modelName: model.name,
						moodTag,
						totalModels: targetModels.length
					}),
					model_id: model.id,
					campaign_group_id: campaignGroupId,
					product_asset_url: body.product_asset_url,
					batch_size: body.batch_size,
					resolution_width: body.resolution_width,
					resolution_height: body.resolution_height,
					upscale: body.upscale,
					custom_prompt_additions: body.custom_prompt_additions,
					negative_prompt: prompt.negativePrompt,
					prompt_text: prompt.promptText,
					image_model_provider: imageModelProvider,
					image_model_id: imageModelId,
					creative_controls: creativeControls,
					userId: session.userId
				});
			});

			return ok(
				{
					id: createdCampaigns[0]?.id,
					primary_campaign_id: createdCampaigns[0]?.id,
					campaign_group_id: campaignGroupId,
					campaigns: createdCampaigns.map(campaign => ({
						id: campaign.id,
						name: campaign.name,
						model_id: campaign.model_id
					}))
				},
				201
			);
		}

		const presetVersion = await getOrCreateSystemPresetVersion(session.userId);
		const models = await prisma.aiModel.findMany({
			where: {
				id: {
					in: requestedModelIds
				}
			},
			include: {
				model_versions: {
					where: { is_active: true },
					take: 1
				}
			}
		});
		const modelById = new Map(models.map(model => [model.id, model]));
		const targetModels = requestedModelIds.map(modelId => modelById.get(modelId) ?? null);

		if (targetModels.some(model => !model)) {
			throw new ApiError(404, "NOT_FOUND", "We couldn't find one or more selected models. Please refresh and try again.");
		}

		if (targetModels.some(model => model?.status !== "ACTIVE")) {
			throw new ApiError(400, "VALIDATION_ERROR", "Campaigns can only be created for active models.");
		}

		if (imageModelProvider === "gpu" && targetModels.some(model => (model?.model_versions.length ?? 0) === 0)) {
			throw new ApiError(400, "VALIDATION_ERROR", "One or more selected models have no active version for GPU image creation. Use another Image Engine or activate a version.");
		}

		const campaignGroupId = targetModels.length > 1 ? randomUUID() : null;
		const createdCampaigns = await prisma.$transaction(async tx => {
			const result = [];

			for (const model of targetModels) {
				if (!model) {
					continue;
				}

				const prompt = buildPrompt({
					modelName: model.name,
					moodTag: presetVersion.preset.mood_tag ?? "editorial luxe",
					customPromptAdditions: body.custom_prompt_additions,
					negativePrompt: body.negative_prompt,
					creativeControls
				});

				result.push(
					await tx.campaign.create({
						data: {
							name: buildCreatedCampaignName({
								requestedName: body.name,
								modelName: model.name,
								moodTag: presetVersion.preset.mood_tag ?? "mood",
								totalModels: targetModels.length
							}),
							model_id: model.id,
							campaign_group_id: campaignGroupId,
							preset_version_id: presetVersion.id,
							image_model_provider: imageModelProvider,
							image_model_id: imageModelId,
							creative_controls: creativeControls,
							product_asset_url: body.product_asset_url,
							batch_size: body.batch_size,
							resolution_width: body.resolution_width,
							resolution_height: body.resolution_height,
							upscale: body.upscale,
							custom_prompt_additions: body.custom_prompt_additions,
							negative_prompt: prompt.negativePrompt,
							prompt_text: prompt.promptText,
							status: "DRAFT",
							created_by: session.userId
						}
					})
				);
			}

			return result;
		});

		return ok(
			{
				id: createdCampaigns[0]?.id,
				primary_campaign_id: createdCampaigns[0]?.id,
				campaign_group_id: campaignGroupId,
				campaigns: createdCampaigns.map(campaign => ({
					id: campaign.id,
					name: campaign.name,
					model_id: campaign.model_id
				}))
			},
			201
		);
	});
}

function defaultModelId(provider: ImageModelProvider, env: ReturnType<typeof getEnv>): string {
	if (provider === "openai") {
		return env.OPENAI_IMAGE_MODEL;
	}

	if (provider === "nano_banana_2") {
		return env.NANO_BANANA_MODEL;
	}

	if (provider === "zai_glm") {
		return env.ZAI_IMAGE_MODEL;
	}

	return "sdxl-1.0";
}

async function getOrCreateSystemPresetVersion(userId: string) {
	const latest = await prisma.presetVersion.findFirst({
		orderBy: { created_at: "desc" },
		include: { preset: true }
	});

	if (latest) {
		return latest;
	}

	const preset = await prisma.preset.create({
		data: {
			name: "System Default Style",
			mood_tag: "editorial luxe",
			created_by: userId
		}
	});

	const version = await prisma.presetVersion.create({
		data: {
			preset_id: preset.id,
			version: 1,
			lighting_profile: { profile: "neutral editorial" },
			lens_profile: { focal_length_mm: 85 },
			color_palette: { primary_hue: "#9CA3AF" },
			grading_curve: { style: "balanced" },
			camera_simulation: { profile: "default" },
			prompt_fragment: "editorial luxe"
		},
		include: { preset: true }
	});

	await prisma.preset.update({
		where: { id: preset.id },
		data: { current_version_id: version.id }
	});

	return version;
}

function buildCreatedCampaignName(input: {
	requestedName?: string;
	modelName: string;
	moodTag: string;
	totalModels: number;
}) {
	const trimmedName = input.requestedName?.trim();
	if (trimmedName) {
		return input.totalModels > 1 ? `${trimmedName} · ${input.modelName}` : trimmedName;
	}

	return `${input.modelName}_${input.moodTag}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomInt(1000, 9999)}`;
}

