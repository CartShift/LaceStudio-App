import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { rejectPublishingSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(rejectPublishingSchema, await request.json());

    if (isDemoMode()) {
      const updated = demoStore.rejectPost(id, body.reason);
      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this queue item. Please refresh and try again.");
      }

      return ok(updated);
    }

    const item = await prisma.publishingQueue.findUnique({ where: { id } });
    if (!item) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this queue item. Please refresh and try again.");
    }
    if (item.status !== "PENDING_APPROVAL") {
      throw new ApiError(409, "CONFLICT", "Only posts waiting for Review can be rejected. Refresh and try again.");
    }

    const updated = await prisma.$transaction(async (tx) => {
      const record = await tx.publishingQueue.update({
        where: { id },
        data: {
          status: "REJECTED",
          rejection_reason: body.reason,
          error_message: null,
          retry_after: null,
        },
      });

      if (record.plan_item_id) {
        await tx.postingPlanItem.update({
          where: { id: record.plan_item_id },
          data: {
            status: "SKIPPED",
            decided_at: new Date(),
            autopilot_metadata: toInputJson({
              decision: "approval_rejected",
              reason: body.reason,
            }),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          user_id: session.userId,
          action: "publishing.reject",
          entity_type: "publishing_queue",
          entity_id: id,
          old_value: item,
          new_value: record,
        },
      });

      return record;
    });

    return ok(updated);
  });
}

