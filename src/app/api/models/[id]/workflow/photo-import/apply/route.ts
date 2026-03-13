import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { photoImportApplySchema } from "@/server/schemas/model-workflow";
import { applyModelPhotoImportSuggestion } from "@/server/services/model-photo-import.service";
import { isDemoMode } from "@/server/demo/mode";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const body = validateOrThrow(photoImportApplySchema, await request.json().catch(() => ({})));

		if (isDemoMode()) {
			throw new ApiError(400, "FORBIDDEN", "Applying photo suggestions is unavailable in demo mode. Switch to live mode to continue.");
		}

		const result = await applyModelPhotoImportSuggestion({
			modelId: id,
			appliedBy: session.userId,
			sections: body.sections,
			startCanonicalGeneration: body.start_canonical_generation,
			canonicalProvider: body.canonical_provider,
			canonicalModelId: body.canonical_model_id,
			canonicalCandidatesPerShot: body.canonical_candidates_per_shot,
		});

		return ok(result);
	});
}

