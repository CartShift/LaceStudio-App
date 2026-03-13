import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { listReelVariantJobs, listReelVariants } from "@/server/services/video-generation.service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);
    void request;

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      return ok({
        data: {
          variants: [
            {
              id: `demo-reel-variant-${id}`,
              asset_id: id,
              format_type: "reel_9x16",
              media_kind: "video",
              gcs_uri: "https://cdn.example.com/demo-reel.mp4",
              preview_url: "https://cdn.example.com/demo-reel.jpg",
              width: 1080,
              height: 1920,
              duration_ms: 8000,
              mime_type: "video/mp4",
              created_at: new Date().toISOString(),
            },
          ],
          jobs: [
            {
              id: `demo-reel-job-${id}`,
              asset_id: id,
              status: "COMPLETED",
              provider: "mock_video",
              provider_job_id: `mock-${id}`,
              prompt_text: "Demo vertical reel variant",
              duration_ms_target: 8000,
              aspect_ratio: "9:16",
              output_url: "https://cdn.example.com/demo-reel.mp4",
              preview_image_url: "https://cdn.example.com/demo-reel.jpg",
              metadata: null,
              output_variant: {
                id: `demo-reel-variant-${id}`,
                asset_id: id,
                format_type: "reel_9x16",
                media_kind: "video",
                gcs_uri: "https://cdn.example.com/demo-reel.mp4",
                preview_url: "https://cdn.example.com/demo-reel.jpg",
                width: 1080,
                height: 1920,
                duration_ms: 8000,
                mime_type: "video/mp4",
                created_at: new Date().toISOString(),
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            },
          ],
        },
      });
    }

    return ok({
      data: {
        variants: await listReelVariants(id),
        jobs: await listReelVariantJobs(id),
      },
    });
  });
}
