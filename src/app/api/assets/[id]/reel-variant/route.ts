import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { createReelVariantSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { createReelVariantJob } from "@/server/services/video-generation.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(createReelVariantSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        {
          id: `demo-reel-job-${id}`,
          asset_id: id,
          status: "COMPLETED",
          provider: "mock_video",
          duration_ms_target: body.duration_seconds * 1000,
          aspect_ratio: "9:16",
          output_variant: {
            id: `demo-reel-variant-${id}`,
            asset_id: id,
            format_type: "reel_9x16",
            media_kind: "video",
            gcs_uri: "https://cdn.example.com/demo-reel.mp4",
            preview_url: "https://cdn.example.com/demo-reel.jpg",
            width: 1080,
            height: 1920,
            duration_ms: body.duration_seconds * 1000,
            mime_type: "video/mp4",
            created_at: new Date().toISOString(),
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        },
        201,
      );
    }

    return ok(
      await createReelVariantJob({
        assetId: id,
        userId: session.userId,
        promptText: body.prompt_text,
        durationSeconds: body.duration_seconds,
        sourceVariantId: body.variant_id,
      }),
      201,
    );
  });
}
