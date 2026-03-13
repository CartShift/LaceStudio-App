import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { canonicalPackReadSchema } from "@/server/schemas/model-workflow";
import { getCanonicalPackSummary } from "@/server/services/canonical-pack.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const query = validateOrThrow(
      canonicalPackReadSchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (isDemoMode()) {
      const summary = demoStore.getCanonicalPackSummary({
        modelId: id,
        packVersion: query.pack_version,
      });
      if (!summary) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }
      return ok(summary);
    }

    const summary = await getCanonicalPackSummary({
      modelId: id,
      packVersion: query.pack_version,
    });

    return ok(summary);
  });
}

