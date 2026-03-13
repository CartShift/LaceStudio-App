import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const BOOLEAN_SETTING_KEYS = ["require_publishing_approval"] as const;
const NUMERIC_SETTING_KEYS = [
  "gpu_monthly_budget_usd",
  "gpu_cost_per_ms",
  "image_cost_per_1k_gpu_usd",
  "image_cost_per_1k_openai_usd",
  "image_cost_per_1k_nano_banana_2_usd",
  "image_cost_per_1k_zai_glm_usd",
] as const;

const updateSettingSchema = z.discriminatedUnion("key", [
  z.object({
    key: z.enum(BOOLEAN_SETTING_KEYS),
    value: z.boolean(),
  }),
  z.object({
    key: z.enum(NUMERIC_SETTING_KEYS),
    value: z.number().positive(),
  }),
]);

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    if (isDemoMode()) {
      return ok({ data: demoStore.listSettings() });
    }

    const data = await prisma.systemSetting.findMany({
      orderBy: { key: "asc" },
    });

    return ok({ data });
  });
}

export async function PATCH(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const body = validateOrThrow(updateSettingSchema, await request.json());

    if (isDemoMode()) {
      return ok(demoStore.setSettingValue(body.key, body.value));
    }

    const updated = await prisma.systemSetting.upsert({
      where: { key: body.key },
      update: {
        value: body.value,
        updated_by: session.userId,
      },
      create: {
        key: body.key,
        value: body.value,
        updated_by: session.userId,
      },
    });

    return ok(updated);
  });
}

