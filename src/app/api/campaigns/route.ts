import { randomInt } from "node:crypto";
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

		return ok({
			data,
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
		const imageModelProvider = body.image_model?.provider ?? env.IMAGE_PROVIDER_DEFAULT;
		const imageModelId = body.image_model?.model_id ?? defaultModelId(imageModelProvider, env);
		const mergedControls = mergeCreativeControls(createDefaultCreativeControls(), body.creative_controls);
		const creativeControls = mergedControls.reference_board.items.length > 0 ? enrichReferenceBoard(mergedControls, { versionOverride: 1, label: "Initial reference board" }) : mergedControls;

		if (isDemoMode()) {
			const models = demoStore.listModels();
			const model = models.find(item => item.id === body.model_id);
			const detail = model ? demoStore.getModel(model.id) : null;

			if (!model) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
			}

			if (imageModelProvider === "gpu" && !(detail?.model_versions.some(version => version.is_active) ?? false)) {
				throw new ApiError(400, "VALIDATION_ERROR", "This Model has no active version for GPU image creation. Use another Image Engine or activate a version.");
			}

			const moodTag = demoStore.getDefaultCampaignMoodTag();
			const prompt = buildPrompt({
				modelName: model.name,
				moodTag,
				customPromptAdditions: body.custom_prompt_additions,
				negativePrompt: body.negative_prompt,
				creativeControls
			});

			const generatedName = `${model.name}_${moodTag}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomInt(1000, 9999)}`;

			const campaign = demoStore.createCampaign({
				name: body.name ?? generatedName,
				model_id: body.model_id,
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

			return ok(campaign, 201);
		}

		const model = await prisma.aiModel.findUnique({
			where: { id: body.model_id },
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

		if (imageModelProvider === "gpu" && model.model_versions.length === 0) {
			throw new ApiError(400, "VALIDATION_ERROR", "This Model has no active version for GPU image creation. Use another Image Engine or activate a version.");
		}

		const presetVersion = await getOrCreateSystemPresetVersion(session.userId);
		const prompt = buildPrompt({
			modelName: model.name,
			moodTag: presetVersion.preset.mood_tag ?? "editorial luxe",
			customPromptAdditions: body.custom_prompt_additions,
			negativePrompt: body.negative_prompt,
			creativeControls
		});

		const generatedName = `${model.name}_${presetVersion.preset.mood_tag ?? "mood"}_${new Date().toISOString().slice(0, 10).replaceAll("-", "")}_${randomInt(1000, 9999)}`;

		const campaign = await prisma.campaign.create({
			data: {
				name: body.name ?? generatedName,
				model_id: body.model_id,
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
		});

		return ok(campaign, 201);
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

