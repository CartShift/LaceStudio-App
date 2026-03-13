import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { toInputJson } from "@/lib/prisma-json";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { log } from "@/lib/logger";
import { workflowPatchSchema } from "@/server/schemas/model-workflow";
import {
  buildModelCapabilityFlags,
  defaultWorkflowState,
  deriveModelStatusForWorkflow,
  deriveWorkflowCompleteness,
  mergeWorkflowState,
} from "@/server/services/model-workflow.service";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    if (isDemoMode()) {
      const workflow = demoStore.getModelWorkflow(id);
      if (!workflow) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }
      return ok(workflow);
    }

    const model = await prisma.aiModel.findUnique({
      where: { id },
      include: {
        model_versions: {
          where: { is_active: true },
          take: 1,
        },
      },
    });
    if (!model) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
    }

    const selectedCanonicalCount =
      model.active_canonical_pack_version > 0
        ? await prisma.canonicalReference.count({
            where: {
              model_id: id,
              pack_version: model.active_canonical_pack_version,
            },
          })
        : 0;
    const acceptedImportedReferenceCount = await prisma.modelSourceReference.count({
      where: {
        model_id: id,
        status: "ACCEPTED",
      },
    });

    const workflowState = toWorkflowState(model.onboarding_state);
    const completeness = deriveWorkflowCompleteness(
      model,
      selectedCanonicalCount,
      acceptedImportedReferenceCount,
    );

    return ok({
      model_id: model.id,
      model_name: model.name,
      status: model.status,
      canonical_pack_status: model.canonical_pack_status,
      active_canonical_pack_version: model.active_canonical_pack_version,
      workflow_state: workflowState,
      completeness,
      draft: {
        character_design:
          model.body_profile && model.face_profile
            ? {
                body_profile: model.body_profile,
                face_profile: model.face_profile,
                imperfection_fingerprint: model.imperfection_fingerprint ?? [],
              }
            : null,
        personality: model.personality_profile,
        social_strategy: model.social_tracks_profile,
      },
      capabilities: buildModelCapabilityFlags(model.model_versions.length > 0),
    });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);
    const body = validateOrThrow(workflowPatchSchema, await request.json());

    if (isDemoMode()) {
      const saved = demoStore.saveModelWorkflowStep({
        id,
        step: body.step,
        payload: body.payload as unknown as Record<string, unknown>,
      });
      if (!saved) {
        throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
      }
      return ok(saved);
    }

    const model = await prisma.aiModel.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        body_profile: true,
        face_profile: true,
        canonical_pack_status: true,
        active_canonical_pack_version: true,
        onboarding_state: true,
      },
    });

    if (!model) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
    }

    const selectedCanonicalCount =
      model.active_canonical_pack_version > 0
        ? await prisma.canonicalReference.count({
            where: {
              model_id: id,
              pack_version: model.active_canonical_pack_version,
            },
          })
        : 0;
    const acceptedImportedReferenceCount = await prisma.modelSourceReference.count({
      where: {
        model_id: id,
        status: "ACCEPTED",
      },
    });

    const nextOnboarding = mergeWorkflowState(asRecord(model.onboarding_state), body.step);

    const payload: Prisma.AiModelUpdateInput = {
      onboarding_state: toInputJson(nextOnboarding),
    };

    if (body.step === "character_design") {
      payload.body_profile = toInputJson(body.payload.body_profile);
      payload.face_profile = toInputJson(body.payload.face_profile);
      payload.imperfection_fingerprint = toInputJson(body.payload.imperfection_fingerprint);
    } else if (body.step === "personality") {
      payload.personality_profile = toInputJson(body.payload);
    } else if (body.step === "social_strategy") {
      payload.social_tracks_profile = toInputJson(body.payload);
    }

    const resolvedModelLike = {
      ...model,
      ...(body.step === "character_design"
        ? {
            body_profile: body.payload.body_profile,
            face_profile: body.payload.face_profile,
          }
        : {}),
    };
    payload.status = deriveModelStatusForWorkflow(
      resolvedModelLike,
      selectedCanonicalCount,
      acceptedImportedReferenceCount,
    );

    const updated = await prisma.aiModel.update({
      where: { id },
      data: payload,
    });

    log({
      level: "info",
      service: "api",
      action: "model_workflow_step_saved",
      entity_type: "ai_model",
      entity_id: id,
      user_id: session.userId,
      metadata: {
        step: body.step,
      },
    });

    return ok({
      model_id: updated.id,
      status: updated.status,
      workflow_state: nextOnboarding,
    });
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toWorkflowState(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaultWorkflowState();
  }

  const state = raw as Record<string, unknown>;
  const current =
    state.current_step === "character_design" ||
    state.current_step === "personality" ||
    state.current_step === "social_strategy"
      ? state.current_step
      : "character_design";

  const completed = Array.isArray(state.completed_steps)
    ? state.completed_steps.filter(
        (step): step is "character_design" | "personality" | "social_strategy" =>
          step === "character_design" || step === "personality" || step === "social_strategy",
      )
    : [];

  return {
    current_step: current,
    completed_steps: completed,
    last_saved_at:
      typeof state.last_saved_at === "string" && state.last_saved_at.length > 0
        ? state.last_saved_at
        : new Date().toISOString(),
  };
}

