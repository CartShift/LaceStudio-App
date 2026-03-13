import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { canonicalPackApproveSchema } from "@/server/schemas/model-workflow";
import { approveCanonicalPack } from "@/server/services/canonical-pack.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(canonicalPackApproveSchema, await request.json());

    if (isDemoMode()) {
      const approved = demoStore.approveCanonicalPack({
        modelId: id,
        packVersion: body.pack_version,
        selections: body.selections,
      });
      if (!approved) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }
      return ok(approved);
    }

    await approveCanonicalPack({
      modelId: id,
      packVersion: body.pack_version,
      selections: body.selections,
      approvedBy: session.userId,
    });

    return ok({ approved: true });
  });
}

