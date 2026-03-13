import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { canonicalPackUploadSchema } from "@/server/schemas/model-workflow";
import { uploadCandidateReference } from "@/server/services/canonical-pack.service";
import { isDemoMode } from "@/server/demo/mode";

export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const body = validateOrThrow(canonicalPackUploadSchema, await request.json());

		if (isDemoMode()) {
			throw new ApiError(400, "FORBIDDEN", "Manual uploads are unavailable in demo mode. Switch to live mode to upload files.");
		}

		const candidate = await uploadCandidateReference({
			modelId: id,
			initiatedBy: session.userId,
			shotCode: body.shot_code,
			imageDataUrl: body.image_data_url,
			candidateId: body.candidate_id,
			candidateIndex: body.candidate_index,
			packVersion: body.pack_version
		});

		return ok({ candidate_id: candidate.id }, 201);
	});
}

