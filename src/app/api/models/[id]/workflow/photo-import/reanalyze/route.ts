import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { reanalyzeModelPhotoImport } from "@/server/services/model-photo-import.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

		if (isDemoMode()) {
			throw new ApiError(400, "FORBIDDEN", "Photo analysis retry is unavailable in demo mode. Switch to live mode to continue.");
		}

		const result = await reanalyzeModelPhotoImport({
			modelId: id,
			initiatedBy: session.userId
		});

		return ok(result, 202);
	});
}
