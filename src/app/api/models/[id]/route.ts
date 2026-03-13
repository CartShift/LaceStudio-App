import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { modelUpdateSchema } from "@/server/schemas/api";
import { deriveModelStatusForWorkflow } from "@/server/services/model-workflow.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      const model = demoStore.getModel(id);
      if (!model) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }

      return ok(model);
    }

    const model = await prisma.aiModel.findUnique({
      where: { id },
      include: {
        model_versions: { orderBy: { version: "desc" } },
        canonical_references: { orderBy: [{ pack_version: "desc" }, { sort_order: "asc" }] },
      },
    });

    if (!model) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
    }

    return ok(model);
  });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(modelUpdateSchema, await request.json());

    if (isDemoMode()) {
      const updated = demoStore.updateModel(id, {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
        ...(body.body_profile ? { body_profile: body.body_profile } : {}),
        ...(body.face_profile ? { face_profile: body.face_profile } : {}),
        ...(body.imperfection_fingerprint
          ? { imperfection_fingerprint: body.imperfection_fingerprint }
          : {}),
        ...(body.personality_profile ? { personality_profile: body.personality_profile } : {}),
        ...(body.social_tracks_profile ? { social_tracks_profile: body.social_tracks_profile } : {}),
        ...(body.onboarding_state ? { onboarding_state: body.onboarding_state } : {}),
      });

      if (!updated) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }

      return ok(updated);
    }

    const existing = await prisma.aiModel.findUnique({ where: { id } });
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
    }

    const canonicalCount =
      existing.active_canonical_pack_version > 0
        ? await prisma.canonicalReference.count({
            where: {
              model_id: id,
              pack_version: existing.active_canonical_pack_version,
            },
          })
        : 0;
    const acceptedImportedReferenceCount = await prisma.modelSourceReference.count({
      where: {
        model_id: id,
        status: "ACCEPTED",
      },
    });

    const status = deriveModelStatusForWorkflow(
      {
        status: existing.status,
        body_profile: (body.body_profile ?? existing.body_profile) as Prisma.JsonValue,
        face_profile: (body.face_profile ?? existing.face_profile) as Prisma.JsonValue,
        canonical_pack_status: existing.canonical_pack_status,
        active_canonical_pack_version: existing.active_canonical_pack_version,
      },
      canonicalCount,
      acceptedImportedReferenceCount,
    );

    const payload: Prisma.AiModelUpdateInput = {
      status,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description.trim() || null } : {}),
      ...(body.body_profile
        ? { body_profile: toInputJson(body.body_profile) }
        : {}),
      ...(body.face_profile
        ? { face_profile: toInputJson(body.face_profile) }
        : {}),
      ...(body.imperfection_fingerprint
        ? {
            imperfection_fingerprint: toInputJson(body.imperfection_fingerprint),
          }
        : {}),
      ...(body.personality_profile
        ? { personality_profile: toInputJson(body.personality_profile) }
        : {}),
      ...(body.social_tracks_profile
        ? { social_tracks_profile: toInputJson(body.social_tracks_profile) }
        : {}),
      ...(body.onboarding_state
        ? { onboarding_state: toInputJson(body.onboarding_state) }
        : {}),
    };

    const updated = await prisma.aiModel.update({
      where: { id },
      data: payload,
    });

    await prisma.auditLog.create({
      data: {
        user_id: session.userId,
        action: "model.update",
        entity_type: "ai_model",
        entity_id: id,
        old_value: existing,
        new_value: updated,
      },
    });

    return ok(updated);
  });
}

