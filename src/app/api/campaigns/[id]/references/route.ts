import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { campaignReferenceAddSchema } from "@/server/schemas/api";
import { creativeControlsSchema } from "@/server/schemas/creative";
import { createDefaultCreativeControls, enrichReferenceBoard } from "@/server/services/creative-controls";
import { createSignedReadUrlForGcsUri, uploadImageFromUriToModelBucket } from "@/server/services/storage/gcs-storage";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const MAX_REFERENCE_UPLOAD_BYTES = 4 * 1024 * 1024;
const SUPPORTED_REFERENCE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const referenceUploadFormSchema = z.object({
	weight: z.enum(["primary", "secondary"]).default("secondary"),
	title: z.string().max(120).optional(),
	notes: z.string().max(240).optional()
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

		if (isDemoMode()) {
			const campaign = demoStore.getCampaign(id);
			if (!campaign) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
			}
			return ok(campaign.creative_controls.reference_board);
		}

		const campaign = await prisma.campaign.findUnique({
			where: { id },
			select: {
				creative_controls: true,
				reference_board_version: true
			}
		});

		if (!campaign) {
			throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
		}

		const controls = campaign.creative_controls ? creativeControlsSchema.parse(campaign.creative_controls) : createDefaultCreativeControls();
		const boardWithPreviews = await hydrateReferenceBoardPreviews(controls.reference_board);

		return ok({
			...boardWithPreviews,
			version: campaign.reference_board_version
		});
	});
}

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const demoMode = isDemoMode();
		const body = await parseCampaignReferencePayload(request, {
			campaignId: id,
			persistUpload: !demoMode
		});

		if (demoMode) {
			const campaign = demoStore.addCampaignReference(id, body);
			if (!campaign) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
			}
			return ok(campaign.creative_controls.reference_board, 201);
		}

		const campaign = await prisma.campaign.findUnique({
			where: { id },
			select: {
				id: true,
				reference_board_version: true,
				creative_controls: true
			}
		});
		if (!campaign) {
			throw new ApiError(404, "NOT_FOUND", "We couldn't find this campaign. Please refresh and try again.");
		}

		const controls = campaign.creative_controls ? creativeControlsSchema.parse(campaign.creative_controls) : createDefaultCreativeControls();
		const nextVersion = campaign.reference_board_version + 1;

		controls.reference_board.items.unshift({
			id: randomUUID(),
			source: body.source,
			url: body.url,
			thumbnail_url: body.thumbnail_url,
			title: body.title,
			notes: body.notes,
			weight: body.weight,
			version: nextVersion,
			created_at: new Date().toISOString()
		});

		const enriched = enrichReferenceBoard(controls, {
			label: body.title ?? `Reference v${nextVersion}`,
			versionOverride: nextVersion
		});

		const updated = await prisma.$transaction(async tx => {
			await tx.campaignReferenceVersion.create({
				data: {
					campaign_id: campaign.id,
					version: nextVersion,
					label: body.title ?? `Reference v${nextVersion}`,
					references: enriched.reference_board.items,
					created_by: session.userId
				}
			});

			return tx.campaign.update({
				where: { id: campaign.id },
				data: {
					creative_controls: enriched,
					reference_board_version: nextVersion
				}
			});
		});

		const boardWithPreviews = await hydrateReferenceBoardPreviews(enriched.reference_board);
		return ok(
			{
				campaign_id: updated.id,
				reference_board: boardWithPreviews
			},
			201
		);
	});
}

async function parseCampaignReferencePayload(
	request: Request,
	options: { campaignId: string; persistUpload: boolean }
): Promise<z.infer<typeof campaignReferenceAddSchema>> {
	const contentType = request.headers.get("content-type") ?? "";
	if (!contentType.includes("multipart/form-data")) {
		const payload = validateOrThrow(campaignReferenceAddSchema, await request.json());
		if (!options.persistUpload) {
			return payload;
		}

		return normalizeReferencePayloadForStorage(payload, options.campaignId);
	}

	const form = await request.formData();
	const image = form.get("image");
	if (!(image instanceof File)) {
		throw new ApiError(400, "VALIDATION_ERROR", "Missing image file. Send it in the 'image' form field.");
	}

	if (image.size <= 0) {
		throw new ApiError(400, "VALIDATION_ERROR", "Uploaded image file is empty. Please choose another file.");
	}

	if (image.size > MAX_REFERENCE_UPLOAD_BYTES) {
		throw new ApiError(400, "VALIDATION_ERROR", `Reference image is too large. Maximum size is ${Math.floor(MAX_REFERENCE_UPLOAD_BYTES / (1024 * 1024))}MB.`);
	}

	const formPayload = validateOrThrow(referenceUploadFormSchema, {
		weight: getOptionalFormText(form, "weight"),
		title: getOptionalFormText(form, "title"),
		notes: getOptionalFormText(form, "notes")
	});

	const buffer = Buffer.from(await image.arrayBuffer());
	const detectedMime = detectReferenceMimeType(buffer);
	if (!detectedMime || !SUPPORTED_REFERENCE_MIME_TYPES.has(detectedMime)) {
		throw new ApiError(400, "VALIDATION_ERROR", "Unsupported image format. Use JPG, PNG, or WebP.");
	}

	const declaredMime = normalizeMimeType(image.type);
	if (declaredMime && declaredMime !== detectedMime) {
		throw new ApiError(400, "VALIDATION_ERROR", "The uploaded image content does not match its file type. Please re-export and upload again.");
	}

	const dataUrl = `data:${detectedMime};base64,${buffer.toString("base64")}`;
	let sourceUrl = dataUrl;
	let thumbnailUrl = dataUrl;

	if (options.persistUpload) {
		const destinationPath = `campaign-references/${options.campaignId}/${Date.now()}-${randomUUID()}.${mimeTypeToExtension(detectedMime)}`;
		sourceUrl = await uploadImageFromUriToModelBucket({
			sourceUri: dataUrl,
			destinationPath
		});
		thumbnailUrl = sourceUrl;
	}

	return validateOrThrow(campaignReferenceAddSchema, {
		source: "pinterest_upload",
		url: sourceUrl,
		thumbnail_url: thumbnailUrl,
		title: formPayload.title ?? sanitizeUploadTitle(image.name),
		notes: formPayload.notes,
		weight: formPayload.weight
	});
}

async function normalizeReferencePayloadForStorage(
	payload: z.infer<typeof campaignReferenceAddSchema>,
	campaignId: string
): Promise<z.infer<typeof campaignReferenceAddSchema>> {
	let sourceUrl = payload.url;
	let thumbnailUrl = payload.thumbnail_url;

	if (sourceUrl.startsWith("data:image/")) {
		sourceUrl = await persistDataUrlReference(sourceUrl, campaignId, "source");
		thumbnailUrl = sourceUrl;
	}

	if (thumbnailUrl && thumbnailUrl.startsWith("data:image/")) {
		thumbnailUrl = await persistDataUrlReference(thumbnailUrl, campaignId, "thumbnail");
	}

	return {
		...payload,
		url: sourceUrl,
		thumbnail_url: thumbnailUrl
	};
}

async function persistDataUrlReference(dataUrl: string, campaignId: string, kind: "source" | "thumbnail"): Promise<string> {
	const mimeType = detectMimeTypeFromDataUrl(dataUrl);
	if (!mimeType || !SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType)) {
		throw new ApiError(400, "VALIDATION_ERROR", "Unsupported data URL image format. Please use JPG, PNG, or WebP data URLs.");
	}

	const destinationPath = `campaign-references/${campaignId}/${Date.now()}-${randomUUID()}-${kind}.${mimeTypeToExtension(mimeType)}`;
	return uploadImageFromUriToModelBucket({
		sourceUri: dataUrl,
		destinationPath
	});
}

function getOptionalFormText(form: FormData, field: string): string | undefined {
	const value = form.get(field);
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function sanitizeUploadTitle(fileName: string): string | undefined {
	const baseName = fileName.trim().replace(/\.[^./\\]+$/, "");
	if (!baseName) return undefined;

	const normalized = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return normalized.length > 0 ? normalized.slice(0, 120) : undefined;
}

function normalizeMimeType(value: string | null | undefined): string | null {
	const normalized = (value ?? "").split(";")[0]?.trim().toLowerCase();
	return normalized || null;
}

function detectReferenceMimeType(bytes: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
	if (bytes.byteLength < 12) return null;

	// JPEG magic bytes FF D8 FF
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}

	// PNG magic bytes 89 50 4E 47 0D 0A 1A 0A
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47 &&
		bytes[4] === 0x0d &&
		bytes[5] === 0x0a &&
		bytes[6] === 0x1a &&
		bytes[7] === 0x0a
	) {
		return "image/png";
	}

	// WEBP starts with RIFF....WEBP
	if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
		return "image/webp";
	}

	return null;
}

function mimeTypeToExtension(mimeType: "image/jpeg" | "image/png" | "image/webp"): string {
	if (mimeType === "image/jpeg") return "jpg";
	if (mimeType === "image/webp") return "webp";
	return "png";
}

function detectMimeTypeFromDataUrl(dataUrl: string): "image/jpeg" | "image/png" | "image/webp" | null {
	const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/i);
	if (!match) return null;
	const mimeType = normalizeMimeType(match[1]);
	if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/webp") {
		return mimeType;
	}
	return null;
}

async function hydrateReferenceBoardPreviews(
	board: z.infer<typeof creativeControlsSchema>["reference_board"]
): Promise<z.infer<typeof creativeControlsSchema>["reference_board"]> {
	const items = await Promise.all(
		board.items.map(async item => {
			const previewSource = item.thumbnail_url ?? item.url;
			if (previewSource.startsWith("gs://")) {
				try {
					return {
						...item,
						thumbnail_url: await createSignedReadUrlForGcsUri(previewSource, 3600)
					};
				} catch {
					return item;
				}
			}

			return item;
		})
	);

	return {
		...board,
		items
	};
}

