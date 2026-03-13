import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { postingStrategyInputSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { buildDefaultStrategyFromLegacy, getPostingStrategyForProfile, savePostingStrategy } from "@/server/services/posting-strategy.service";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      const model = demoStore.getModel(id);
      if (!model) {
        return ok(
          buildDefaultStrategyFromLegacy({
            profileId: id,
            timezone: "UTC",
            socialTracksProfile: null,
          }),
        );
      }

      return ok(
        buildDefaultStrategyFromLegacy({
          profileId: id,
          timezone: "UTC",
          socialTracksProfile: model.social_tracks_profile,
        }),
      );
    }

    return ok(await getPostingStrategyForProfile(id));
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(postingStrategyInputSchema, await request.json());

    if (isDemoMode()) {
      return ok({
        id: `demo-strategy-${id}`,
        profile_id: id,
        ...body,
      });
    }

    return ok(
      await savePostingStrategy(id, session.userId, {
        profile_id: id,
        ...body,
      }),
    );
  });
}
