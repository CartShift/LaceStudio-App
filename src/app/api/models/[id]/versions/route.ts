import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ApiError, ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const uploadSchema = z.object({
  notes: z.string().optional(),
  lora_strength: z.coerce.number().min(0.1).max(1).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const { id } = validateOrThrow(z.object({ id: z.uuid() }), await context.params);

    const form = await request.formData();
    const payload = validateOrThrow(
      uploadSchema,
      Object.fromEntries(form.entries()) as Record<string, FormDataEntryValue>,
    );

    if (isDemoMode()) {
      const version = demoStore.createModelVersion({
        modelId: id,
        userId: session.userId,
        notes: payload.notes,
        loraStrength: payload.lora_strength,
      });

      return ok(version, 201);
    }

    const model = await prisma.aiModel.findUnique({ where: { id } });
    if (!model) {
      throw new ApiError(404, "NOT_FOUND", "We couldn't find this model. Please refresh and try again.");
    }

    const latest = await prisma.modelVersion.findFirst({
      where: { model_id: id },
      orderBy: { version: "desc" },
    });

    const nextVersion = (latest?.version ?? 0) + 1;

    const version = await prisma.modelVersion.create({
      data: {
        model_id: id,
        version: nextVersion,
        lora_gcs_uri: `gs://lacestudio-model-weights-private/${id}/v${nextVersion}/weights.safetensors`,
        lora_strength: payload.lora_strength,
        is_active: false,
        notes: payload.notes,
        uploaded_by: session.userId,
      },
    });

    return ok(version, 201);
  });
}

