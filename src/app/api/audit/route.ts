import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { toPagination } from "@/server/repositories/pagination";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const querySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  entity_type: z.string().optional(),
  action: z.string().optional(),
  entity_ids: z.preprocess(
    (value) => {
      if (typeof value !== "string") return undefined;
      const ids = value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return ids.length > 0 ? ids : undefined;
    },
    z.array(z.string().uuid()).optional(),
  ),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin"]);

    const query = validateOrThrow(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const { skip, take, page, limit } = toPagination(query);

    if (isDemoMode()) {
      const filtered = demoStore
        .listAudit()
        .filter((entry) => !query.entity_type || entry.entity_type === query.entity_type)
        .filter((entry) => !query.entity_ids || query.entity_ids.includes(entry.entity_id))
        .filter((entry) => !query.action || entry.action.includes(query.action));

      return ok({
        data: filtered.slice(skip, skip + take),
        pagination: {
          page,
          limit,
          total: filtered.length,
        },
      });
    }

    const where = {
      ...(query.entity_type ? { entity_type: query.entity_type } : {}),
      ...(query.entity_ids
        ? {
            entity_id: {
              in: query.entity_ids,
            },
          }
        : {}),
      ...(query.action
        ? {
            action: {
              contains: query.action,
              mode: "insensitive" as const,
            },
          }
        : {}),
    };

    const [data, total] = await prisma.$transaction([
      prisma.auditLog.findMany({
        where,
        skip,
        take,
        orderBy: { created_at: "desc" },
        include: {
          actor: {
            select: {
              id: true,
              email: true,
              display_name: true,
            },
          },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    return ok({
      data,
      pagination: {
        page,
        limit,
        total,
      },
    });
  });
}

