import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { startInstagramOAuth } from "@/server/services/instagram-profiles.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      return ok({
        authorization_url: `https://facebook.example.test/oauth?profile_id=${id}`,
        state: `demo:${id}`,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        profile_label: "Demo profile",
      });
    }

    return ok(await startInstagramOAuth(id));
  });
}
