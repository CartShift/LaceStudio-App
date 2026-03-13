import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { disconnectInstagramProfile } from "@/server/services/instagram-profiles.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      return ok({ id, connection_status: "DISCONNECTED" });
    }

    await disconnectInstagramProfile(id);
    return ok({ id, connection_status: "DISCONNECTED" });
  });
}
