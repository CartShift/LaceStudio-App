import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { recommendationSkipSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { markPostingPlanItemSkipped } from "@/server/services/posting-strategy.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);
    void session;

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(recommendationSkipSchema, await request.json());

    if (isDemoMode()) {
      return ok({
        id,
        status: "SKIPPED",
        reason: body.reason ?? null,
      });
    }

    return ok(await markPostingPlanItemSkipped(id, body.reason));
  });
}
