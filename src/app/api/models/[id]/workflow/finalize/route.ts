import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { workflowFinalizeSchema } from "@/server/schemas/model-workflow";
import { finalizeWorkflowModel } from "@/server/services/canonical-pack.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    validateOrThrow(workflowFinalizeSchema, await request.json().catch(() => ({})));

    if (isDemoMode()) {
      const finalized = demoStore.finalizeWorkflowModel(id);
      if (!finalized) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }

      return ok(finalized);
    }

    const finalized = await finalizeWorkflowModel({
      modelId: id,
      finalizedBy: session.userId,
    });

    return ok({
      model_id: finalized.model.id,
      status: finalized.model.status,
      canonical_pack_status: finalized.model.canonical_pack_status,
      capabilities: finalized.capabilities,
    });
  });
}

