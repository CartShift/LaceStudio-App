import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";
import { demoStore } from "@/server/demo/store";
import { ACTIVE_PUBLISHING_QUEUE_STATUSES, resolvePublishingAssetPreviewUrl } from "@/server/services/publishing-assets";

const querySchema = z.object({
  model_id: z.uuid().optional(),
  profile_id: z.uuid().optional(),
});

export async function GET(request: Request) {
  return withRouteErrorHandling(request, async () => {
    const session = await getSessionContext();
    assertRole(session.role, ["admin", "operator"]);

    const query = validateOrThrow(
      querySchema,
      Object.fromEntries(new URL(request.url).searchParams.entries()),
    );
    const profileModelId =
      query.profile_id && !isDemoMode()
        ? (
            await prisma.instagramProfile.findUnique({
              where: { id: query.profile_id },
              select: { model_id: true },
            })
          )?.model_id
        : query.profile_id;
    const resolvedModelId = query.model_id ?? profileModelId;

    if (isDemoMode()) {
      const queue = demoStore.listPublishingQueue({
        start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const data = await Promise.all(
        demoStore
          .listApprovedAssets()
          .filter((asset) => !resolvedModelId || asset.model?.id === resolvedModelId)
          .map(async (asset) => {
            const activeQueueItem =
              queue.find(
                (item) =>
                  item.asset_id === asset.id &&
                  ACTIVE_PUBLISHING_QUEUE_STATUSES.some((status) => status === item.status),
              ) ?? null;

            return {
              ...asset,
              preview_url: await resolvePublishingAssetPreviewUrl(asset.approved_gcs_uri ?? asset.raw_gcs_uri),
              is_available: !activeQueueItem,
              reel_variant_ready: asset.sequence_number % 2 === 0,
              active_queue_item: activeQueueItem
                ? {
                    id: activeQueueItem.id,
                    status: activeQueueItem.status,
                    scheduled_at: activeQueueItem.scheduled_at,
                    profile_id: null,
                    profile: null,
                  }
                : null,
            };
          }),
      );
      return ok({ data });
    }

    const data = await prisma.asset.findMany({
      where: {
        status: "APPROVED",
        ...(resolvedModelId
          ? {
              campaign: {
                model_id: resolvedModelId,
              },
            }
          : {}),
      },
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
        variants: {
          select: {
            id: true,
            format_type: true,
            media_kind: true,
            gcs_uri: true,
            preview_image_gcs_uri: true,
            duration_ms: true,
            mime_type: true,
            width: true,
            height: true,
            created_at: true,
          },
        },
        publishing_queue: {
          where: {
            status: {
              in: [...ACTIVE_PUBLISHING_QUEUE_STATUSES],
            },
          },
          orderBy: {
            scheduled_at: "asc",
          },
          take: 1,
          select: {
            id: true,
            status: true,
            scheduled_at: true,
            profile_id: true,
            profile: {
              select: {
                id: true,
                handle: true,
                display_name: true,
              },
            },
          },
        },
      },
      orderBy: {
        reviewed_at: "desc",
      },
    });

    return ok({
      data: await Promise.all(
        data.map(async (asset) => ({
          ...asset,
          preview_url: await resolvePublishingAssetPreviewUrl(asset.approved_gcs_uri ?? asset.raw_gcs_uri),
          is_available: asset.publishing_queue.length === 0,
          reel_variant_ready: asset.variants.some((variant) => variant.format_type === "reel_9x16" && variant.media_kind === "video"),
          active_queue_item: asset.publishing_queue[0] ?? null,
        })),
      ),
    });
  });
}

