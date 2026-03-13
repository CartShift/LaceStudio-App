import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id, versionId } = validateOrThrow(
      z.object({ id: z.uuid(), versionId: z.uuid() }),
      await context.params,
    );

    if (isDemoMode()) {
      const versions = demoStore.activateModelVersion(id, versionId);
      return ok(versions);
    }

    const target = await prisma.modelVersion.findUnique({ where: { id: versionId } });
    if (!target || target.model_id !== id) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this version. Refresh and try again.");
    }

    await prisma.$transaction([
      prisma.modelVersion.updateMany({
        where: { model_id: id },
        data: { is_active: false },
      }),
      prisma.modelVersion.update({
        where: { id: versionId },
        data: { is_active: true },
      }),
      prisma.aiModel.update({
        where: { id },
        data: {
          active_version_id: versionId,
          status: "ACTIVE",
        },
      }),
      prisma.auditLog.create({
        data: {
          user_id: session.userId,
          action: "model.version.activate",
          entity_type: "model_version",
          entity_id: versionId,
          new_value: { model_id: id, version_id: versionId },
        },
      }),
    ]);

    const versions = await prisma.modelVersion.findMany({
      where: { model_id: id },
      orderBy: { version: "desc" },
    });

    return ok(versions);
  });
}

