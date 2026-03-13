import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { toPagination } from "@/server/repositories/pagination";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { bootstrapInstagramPublishingState } from "@/server/services/instagram-profiles.service";
import { resolvePublishingAssetPreviewUrl } from "@/server/services/publishing-assets";

const querySchema = z.object({
  start_date: z.coerce.date(),
  end_date: z.coerce.date(),
  model_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
  pillar_key: z.string().trim().min(1).max(80).optional(),
  post_type: z.enum(["feed", "story", "reel"]).optional(),
  status: z
    .enum([
      "PENDING_APPROVAL",
      "SCHEDULED",
      "PUBLISHING",
      "PUBLISHED",
      "RETRY",
      "FAILED",
      "REJECTED",
      "CANCELLED",
    ])
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

type PublishingQueueCalendarRow = Awaited<ReturnType<typeof prisma.publishingQueue.findMany>>[number];
type DemoPublishingQueueCalendarRow = Awaited<ReturnType<typeof demoStore.listPublishingQueue>>[number] & {
  profile_id: string | null;
  pillar_key: string | null;
  slot_start: string | null;
  strategy_snapshot: unknown;
};
type CalendarResponse = {
  data: Array<PublishingQueueCalendarRow | DemoPublishingQueueCalendarRow>;
  pagination: {
    page: number;
    limit: number;
    total: number;
  };
};

async function attachCalendarAssetPreview<T extends { asset?: Record<string, unknown> | null }>(item: T) {
  const asset = item.asset as
    | {
        approved_gcs_uri?: string | null;
        raw_gcs_uri?: string | null;
      }
    | null
    | undefined;

  if (!asset) {
    return item;
  }

  return {
    ...item,
    asset: {
      ...asset,
      preview_url: await resolvePublishingAssetPreviewUrl(asset.approved_gcs_uri ?? asset.raw_gcs_uri),
    },
  };
}

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const usePagination = query.page !== undefined || query.limit !== undefined;

    if (isDemoMode()) {
      const data = demoStore
        .listPublishingQueue({
          start: query.start_date.toISOString(),
          end: query.end_date.toISOString(),
          model_id: query.model_id ?? query.profile_id,
        })
        .map((item) => {
          const modelId = item.asset?.campaign?.model_id ?? null;
          return {
            ...item,
            profile_id: modelId,
            pillar_key: null,
            slot_start: item.scheduled_at,
            strategy_snapshot: null,
          };
        })
        .filter((item) => (query.profile_id ? item.profile_id === query.profile_id : true))
        .filter((item) => (query.status ? item.status === query.status : true))
        .filter((item) => (query.post_type ? item.post_type === query.post_type : true));

      if (!usePagination) {
        return ok(await Promise.all(data.map((item) => attachCalendarAssetPreview(item))));
      }

      const { skip, take, page, limit } = toPagination(query);
      const response: CalendarResponse = {
        data: await Promise.all(data.slice(skip, skip + take).map((item) => attachCalendarAssetPreview(item))),
        pagination: {
          page,
          limit,
          total: data.length,
        },
      };

      return ok(response);
    }

    await bootstrapInstagramPublishingState();

    const where = {
      scheduled_at: {
        gte: query.start_date,
        lte: query.end_date,
      },
      ...(query.model_id
        ? {
            asset: {
              campaign: {
                model_id: query.model_id,
              },
            },
          }
        : {}),
      ...(query.profile_id
        ? {
            profile_id: query.profile_id,
          }
        : {}),
      ...(query.status
        ? {
            status: query.status,
          }
        : {}),
      ...(query.post_type
        ? {
            post_type: query.post_type,
          }
        : {}),
      ...(query.pillar_key
        ? {
            pillar_key: query.pillar_key,
          }
        : {}),
    };

    if (!usePagination) {
      const data = await prisma.publishingQueue.findMany({
        where,
        include: {
          asset: {
            include: {
              campaign: {
                include: {
                  model: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          profile: {
            select: {
              id: true,
              handle: true,
              display_name: true,
            },
          },
          plan_item: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: {
          scheduled_at: "asc",
        },
      });

      return ok(await Promise.all(data.map((item) => attachCalendarAssetPreview(item))));
    }

    const { skip, take, page, limit } = toPagination(query);

    const [data, total] = await prisma.$transaction([
      prisma.publishingQueue.findMany({
        where,
        skip,
        take,
        include: {
          asset: {
            include: {
              campaign: {
                include: {
                  model: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
          profile: {
            select: {
              id: true,
              handle: true,
              display_name: true,
            },
          },
          plan_item: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: {
          scheduled_at: "asc",
        },
      }),
      prisma.publishingQueue.count({ where }),
    ]);

    const response: CalendarResponse = {
      data: await Promise.all(data.map((item) => attachCalendarAssetPreview(item))),
      pagination: {
        page,
        limit,
        total,
      },
    };

    return ok(response);
  });
}
