import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    if (isDemoMode()) {
      const data = demoStore.listUsers().map((user) => ({
        ...user,
        role: user.role.toLowerCase(),
      }));
      return ok({ data });
    }

    const users = await prisma.user.findMany({
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        email: true,
        role: true,
        display_name: true,
        created_at: true,
      },
    });

    return ok({
      data: users.map((user) => ({
        ...user,
        role: user.role.toLowerCase(),
      })),
    });
  });
}

