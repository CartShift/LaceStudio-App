import { subMinutes } from "date-fns";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const ACTIVE_GENERATION_JOB_STATUSES = ["DISPATCHED", "IN_PROGRESS"] as const;

function isActiveGenerationJobStatus(status: string) {
  return ACTIVE_GENERATION_JOB_STATUSES.includes(
    status as (typeof ACTIVE_GENERATION_JOB_STATUSES)[number],
  );
}

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator", "client"]);

    const staleCutoff = subMinutes(new Date(), 20).toISOString();

    if (isDemoMode()) {
      const campaigns = demoStore.listCampaigns();
      const queue = demoStore.listPublishingQueue({
        start: subMinutes(new Date(), 60 * 24 * 30).toISOString(),
        end: subMinutes(new Date(), -60 * 24 * 30).toISOString(),
      });
      const jobs = campaigns.flatMap((campaign) => campaign.generation_jobs);

      return ok({
        active_jobs: jobs.filter((job) => isActiveGenerationJobStatus(job.status)).length,
        stale_jobs: jobs.filter((job) => isActiveGenerationJobStatus(job.status) && job.dispatched_at < staleCutoff)
          .length,
        campaigns_in_review: campaigns.filter((campaign) => campaign.status === "REVIEW").length,
        publishing_pending_approval: queue.filter((item) => item.status === "PENDING_APPROVAL").length,
        failed_publishing: queue.filter((item) => item.status === "FAILED" || item.status === "REJECTED").length,
        models_total: demoStore.listModels().length,
        campaigns_total: campaigns.length,
      });
    }

    const [
      active_jobs,
      stale_jobs,
      campaigns_in_review,
      publishing_pending_approval,
      failed_publishing,
      models_total,
      campaigns_total,
    ] = await Promise.all([
      prisma.generationJob.count({
        where: {
          status: {
            in: [...ACTIVE_GENERATION_JOB_STATUSES],
          },
        },
      }),
      prisma.generationJob.count({
        where: {
          status: {
            in: [...ACTIVE_GENERATION_JOB_STATUSES],
          },
          dispatched_at: {
            lt: new Date(staleCutoff),
          },
        },
      }),
      prisma.campaign.count({
        where: {
          status: "REVIEW",
        },
      }),
      prisma.publishingQueue.count({
        where: {
          status: "PENDING_APPROVAL",
        },
      }),
      prisma.publishingQueue.count({
        where: {
          status: {
            in: ["FAILED", "REJECTED"],
          },
        },
      }),
      prisma.aiModel.count(),
      prisma.campaign.count(),
    ]);

    return ok({
      active_jobs,
      stale_jobs,
      campaigns_in_review,
      publishing_pending_approval,
      failed_publishing,
      models_total,
      campaigns_total,
    });
  });
}

