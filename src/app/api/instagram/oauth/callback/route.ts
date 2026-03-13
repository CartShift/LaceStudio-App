import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { instagramOAuthCallbackSchema } from "@/server/schemas/instagram-publishing";
import { isDemoMode } from "@/server/demo/mode";
import { completeInstagramOAuthCallback } from "@/server/services/instagram-profiles.service";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const query = validateOrThrow(
      instagramOAuthCallbackSchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );

    if (isDemoMode()) {
      return ok({
        success: !query.error,
        state: query.state,
      });
    }

    const profile = await completeInstagramOAuthCallback({
      state: query.state,
      code: query.code,
      error: query.error,
      errorDescription: query.error_description,
    });

    return ok({
      success: true,
      profile_id: profile.id,
      handle: profile.handle,
      display_name: profile.display_name,
    });
  });
}
