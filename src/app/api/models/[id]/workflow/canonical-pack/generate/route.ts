import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { canonicalPackGenerateSchema } from "@/server/schemas/model-workflow";
import { startCanonicalPackGeneration } from "@/server/services/canonical-pack.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);
		// Canonical pack generation is expensive — limit to 5 per minute per user
		withRateLimit(session.userId, { maxRequests: 5 });
		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const body = validateOrThrow(canonicalPackGenerateSchema, await request.json());

		if (isDemoMode()) {
			const started = demoStore.startCanonicalPackGeneration({
				modelId: id,
				provider: body.provider,
				providerModelId: body.model_id,
				candidatesPerShot: body.candidates_per_shot,
				generationMode: body.generation_mode,
				packVersion: body.pack_version
			});
			if (!started) {
				throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
			}
			return ok(started, 202);
		}

		const started = await startCanonicalPackGeneration({
			modelId: id,
			initiatedBy: session.userId,
			provider: body.provider,
			providerModelId: body.model_id,
			candidatesPerShot: body.candidates_per_shot,
			generationMode: body.generation_mode,
			packVersion: body.pack_version,
			awaitCompletion: false
		});

		return ok(started, 202);
	});
}

