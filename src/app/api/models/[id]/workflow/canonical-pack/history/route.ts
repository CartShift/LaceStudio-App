import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { listCanonicalPackHistory } from "@/server/services/canonical-pack.service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
		const history = await listCanonicalPackHistory({
			modelId: id
		});

		return ok({ packs: history });
	});
}
