import { assertRole, getSessionContext } from "@/lib/auth";
import { getEnv } from "@/lib/env";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const env = getEnv();
    const userId = env.INSTAGRAM_USER_ID;

    return ok({
      provider_mode: env.INSTAGRAM_PROVIDER_MODE,
      demo_mode: isDemoMode(),
      user_id_configured: Boolean(userId),
      user_id_preview: userId ? maskValue(userId) : null,
      access_token_configured: Boolean(env.INSTAGRAM_ACCESS_TOKEN),
      graph_api_version: "v18.0",
    });
  });
}

function maskValue(value: string): string {
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, value.length - 4))}${value.slice(-4)}`;
}


