import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { withRateLimit } from "@/lib/rate-limit";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { modelCreateSchema } from "@/server/schemas/api";
import { toPagination } from "@/server/repositories/pagination";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";

const querySchema = z.object({
	status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
	page: z.coerce.number().int().positive().optional(),
	limit: z.coerce.number().int().positive().optional()
});

export async function GET(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const query = validateOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams.entries()));
		const { skip, take, page, limit } = toPagination(query);

		if (isDemoMode()) {
			const models = demoStore.listModels(query.status);
			const paged = models.slice(skip, skip + take);

			return ok({
				data: paged,
				pagination: {
					page,
					limit,
					total: models.length
				}
			});
		}

		const where = query.status ? { status: query.status } : {};

		const [data, total] = await prisma.$transaction([
			prisma.aiModel.findMany({
				where,
				skip,
				take,
				orderBy: { created_at: "desc" },
				include: {
					model_versions: {
						orderBy: { version: "desc" },
						take: 1
					}
				}
			}),
			prisma.aiModel.count({ where })
		]);

		return ok({
			data,
			pagination: {
				page,
				limit,
				total
			}
		});
	});
}

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin"]);
		withRateLimit(session.userId, { maxRequests: 20 });
		const body = validateOrThrow(modelCreateSchema, await request.json());

		if (isDemoMode()) {
			const created = demoStore.createModel({
				name: body.name,
				description: body.description,
				userId: session.userId
			});

			return ok(
				{
					id: created.id,
					name: created.name,
					status: created.status,
					created_at: created.created_at
				},
				201
			);
		}

		const created = await prisma.aiModel.create({
			data: {
				name: body.name,
				description: body.description,
				status: "DRAFT",
				created_by: session.userId
			}
		});

		return ok(
			{
				id: created.id,
				name: created.name,
				status: created.status,
				created_at: created.created_at
			},
			201
		);
	});
}

