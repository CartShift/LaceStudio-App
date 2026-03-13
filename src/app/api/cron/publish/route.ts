import { ok } from "@/lib/http";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { publishDuePosts } from "@/server/services/publish-scheduled";

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		await assertCronAuthorized(request);
		const count = await publishDuePosts();
		return ok({ published: count });
	});
}

