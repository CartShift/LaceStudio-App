import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { revenueContractCreateSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    if (isDemoMode()) {
      return ok(demoStore.listRevenueContracts());
    }

    const contracts = await prisma.revenueContract.findMany({
      include: {
        client: true,
        entries: true,
        bonus_rules: true,
      },
      orderBy: { created_at: "desc" },
    });

    return ok(contracts);
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const body = validateOrThrow(revenueContractCreateSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        demoStore.createRevenueContract({
          client_id: body.client_id,
          contract_type: body.contract_type,
          monthly_retainer_usd: body.monthly_retainer_usd,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          userId: session.userId,
        }),
        201,
      );
    }

    const contract = await prisma.revenueContract.create({
      data: {
        client_id: body.client_id,
        contract_type: body.contract_type,
        monthly_retainer_usd: body.monthly_retainer_usd,
        starts_at: new Date(body.starts_at),
        ends_at: body.ends_at ? new Date(body.ends_at) : null,
        created_by: session.userId,
      },
    });

    return ok(contract, 201);
  });
}

