import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "client"]);

    if (isDemoMode()) {
      return ok(demoStore.clientDashboard());
    }

    const clients = await prisma.client.findMany({
      include: {
        assignments: {
          include: {
            model: true,
          },
        },
        revenue_contracts: {
          include: {
            entries: true,
          },
        },
      },
    });

    return ok({ clients });
  });
}

