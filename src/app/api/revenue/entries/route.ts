import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { revenueEntryCreateSchema } from "@/server/schemas/api";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    if (isDemoMode()) {
      return ok(demoStore.listRevenueEntries());
    }

    const entries = await prisma.revenueEntry.findMany({
      include: {
        contract: {
          include: {
            client: true,
          },
        },
      },
      orderBy: { reference_month: "desc" },
    });

    return ok(entries);
  });
}

export async function POST(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const body = validateOrThrow(revenueEntryCreateSchema, await request.json());

    if (isDemoMode()) {
      return ok(
        demoStore.createRevenueEntry({
          contract_id: body.contract_id,
          type: body.type,
          amount_usd: body.amount_usd,
          reference_month: body.reference_month,
          notes: body.notes,
        }),
        201,
      );
    }

    const entry = await prisma.revenueEntry.create({
      data: {
        contract_id: body.contract_id,
        type: body.type,
        amount_usd: body.amount_usd,
        reference_month: new Date(body.reference_month),
        notes: body.notes,
      },
    });

    return ok(entry, 201);
  });
}

