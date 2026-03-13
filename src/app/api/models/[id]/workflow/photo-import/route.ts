import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { photoImportStartOptionsSchema } from "@/server/schemas/model-workflow";
import {
	getModelPhotoImportSnapshot,
	startModelPhotoImport,
} from "@/server/services/model-photo-import.service";
import { isDemoMode } from "@/server/demo/mode";

const DEMO_PHOTO_IMPORT_SNAPSHOT = {
	job_id: null,
	status: "IDLE",
	started_at: null,
	completed_at: null,
	error: null,
	counts: {
		pending: 0,
		accepted: 0,
		rejected: 0,
		total: 0,
	},
	options: {
		keep_as_references: true,
		auto_generate_on_apply: false,
		canonical_candidates_per_shot: 1,
	},
	references: [],
	latest_suggestion: null,
} as const;

export const maxDuration = 300;
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

		if (isDemoMode()) {
			return ok(DEMO_PHOTO_IMPORT_SNAPSHOT);
		}

		const snapshot = await getModelPhotoImportSnapshot({ modelId: id });
		return ok(snapshot);
	});
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

		if (isDemoMode()) {
			throw new ApiError(400, "FORBIDDEN", "Photo upload is unavailable in demo mode. Switch to live mode to continue.");
		}

		const contentType = request.headers.get("content-type") ?? "";
		if (!contentType.includes("multipart/form-data")) {
			throw new ApiError(400, "VALIDATION_ERROR", "Photo upload format is invalid. Send files with multipart/form-data in the photos field.");
		}

		const form = await request.formData();
		const rawFiles = form.getAll("photos");
		const files = rawFiles
			.map(entry => toFormFile(entry))
			.filter((entry): entry is File => Boolean(entry));
		if (files.length !== rawFiles.length) {
			throw new ApiError(400, "VALIDATION_ERROR", "Each item in the photos field must be a file. Check your upload and try again.");
		}

		const options = photoImportStartOptionsSchema.parse({
			keep_as_references: parseFormBoolean(form.get("keep_as_references"), true),
			auto_generate_on_apply: parseFormBoolean(form.get("auto_generate_on_apply"), false),
			canonical_provider: parseOptionalFormText(form.get("canonical_provider")),
			canonical_model_id: parseOptionalFormText(form.get("canonical_model_id")),
			canonical_candidates_per_shot:
				parseOptionalFormText(form.get("canonical_candidates_per_shot")) ?? 1,
		});

		const started = await startModelPhotoImport({
			modelId: id,
			initiatedBy: session.userId,
			files,
			options,
		});

		return ok(started, 202);
	});
}

function parseOptionalFormText(value: FormDataEntryValue | null): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseFormBoolean(value: FormDataEntryValue | null, fallback: boolean): boolean {
	if (typeof value !== "string") return fallback;
	const normalized = value.trim().toLowerCase();
	if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
	if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
	return fallback;
}

function toFormFile(value: FormDataEntryValue): File | null {
	if (typeof value === "string") return null;

	const maybeFile = value as File;
	if (typeof maybeFile.arrayBuffer !== "function") return null;
	return maybeFile;
}

