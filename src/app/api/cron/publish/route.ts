import { ok } from "@/lib/http";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { materializeAutoQueueRecommendations } from "@/server/services/auto-queue.service";
import { publishDuePosts } from "@/server/services/publish-scheduled";
import { processPendingVideoGenerationJobs } from "@/server/services/video-generation.service";

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		await assertCronAuthorized(request);
		const completed_video_jobs = await processPendingVideoGenerationJobs();
		const auto_queued = await materializeAutoQueueRecommendations();
		const count = await publishDuePosts();
		return ok({ completed_video_jobs, auto_queued, published: count });
	});
}

