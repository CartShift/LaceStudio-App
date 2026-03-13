import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { toInputJson } from "@/lib/prisma-json";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { brandCreateSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    if (isDemoMode()) {
      return ok(demoStore.listBrands());
    }

    const brands = await prisma.brandProfile.findMany({
      include: {
        client: true,
      },
      orderBy: { created_at: "desc" },
    });

    return ok(brands);
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const body = validateOrThrow(brandCreateSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        demoStore.createBrand({
          client_id: body.client_id,
          name: body.name,
          visual_direction: body.visual_direction,
          voice_notes: body.voice_notes,
          userId: session.userId,
        }),
        201,
      );
    }

    const created = await prisma.brandProfile.create({
      data: {
        client_id: body.client_id,
        name: body.name,
        ...(body.visual_direction ? { visual_direction: toInputJson(body.visual_direction) } : {}),
        voice_notes: body.voice_notes,
        created_by: session.userId,
      },
    });

    return ok(created, 201);
  });
}

