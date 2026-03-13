import { ok } from "@/lib/http";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { ingestAnalyticsSnapshots } from "@/server/services/ingest-analytics";

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		await assertCronAuthorized(request);
		const count = await ingestAnalyticsSnapshots();
		return ok({ snapshots: count });
	});
}

