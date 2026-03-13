import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { stopCanonicalPackGeneration } from "@/server/services/canonical-pack.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const stopped = await stopCanonicalPackGeneration({
			modelId: id,
			stoppedBy: session.userId
		});

		return ok(stopped);
	});
}
