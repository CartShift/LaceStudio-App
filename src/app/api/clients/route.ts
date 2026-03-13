import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { clientCreateSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    if (isDemoMode()) {
      return ok(demoStore.listClients());
    }

    const clients = await prisma.client.findMany({
      orderBy: { created_at: "desc" },
      include: {
        brand_profiles: true,
        assignments: true,
      },
    });

    return ok(clients);
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const body = validateOrThrow(clientCreateSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        demoStore.createClient({
          name: body.name,
          notes: body.notes,
          status: body.status,
          userId: session.userId,
        }),
        201,
      );
    }

    const created = await prisma.client.create({
      data: {
        name: body.name,
        notes: body.notes,
        status: body.status,
        created_by: session.userId,
      },
    });

    return ok(created, 201);
  });
}

