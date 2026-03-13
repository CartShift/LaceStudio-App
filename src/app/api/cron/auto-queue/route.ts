import { ok } from "@/lib/http";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { materializeAutoQueueRecommendations } from "@/server/services/auto-queue.service";
import { processPendingVideoGenerationJobs } from "@/server/services/video-generation.service";

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    await assertCronAuthorized(request);
    const completed_video_jobs = await processPendingVideoGenerationJobs();
    const queued = await materializeAutoQueueRecommendations();
    return ok({ completed_video_jobs, queued });
  });
}
