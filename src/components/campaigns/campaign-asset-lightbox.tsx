"use client";

import { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type CampaignAssetLightboxAsset = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  seed: number;
  sequence_number: number;
  quality_score: number | null;
  raw_gcs_uri?: string;
};

export function CampaignAssetLightbox({
  assets,
  activeAssetId,
  onClose,
  onSelectAsset,
}: {
  assets: CampaignAssetLightboxAsset[];
  activeAssetId: string | null;
  onClose: () => void;
  onSelectAsset: (assetId: string) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const activeIndex = activeAssetId
    ? assets.findIndex((asset) => asset.id === activeAssetId)
    : -1;
  const activeAsset = activeIndex >= 0 ? assets[activeIndex] ?? null : null;
  const canNavigate = assets.length > 1;

  const navigateByOffset = useCallback(
    (offset: number) => {
      if (!canNavigate || activeIndex < 0) return;

      const nextIndex = (activeIndex + offset + assets.length) % assets.length;
      const nextAsset = assets[nextIndex];
      if (nextAsset) {
        onSelectAsset(nextAsset.id);
      }
    },
    [activeIndex, assets, canNavigate, onSelectAsset],
  );

  useEffect(() => {
    if (!activeAsset?.raw_gcs_uri) return;

    dialogRef.current?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        navigateByOffset(-1);
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        navigateByOffset(1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [activeAsset?.raw_gcs_uri, navigateByOffset, onClose]);

  if (!activeAsset?.raw_gcs_uri) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Asset ${activeAsset.sequence_number} preview`}
        tabIndex={-1}
        className="relative flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="z-10 flex items-center justify-between gap-3 border-b border-border bg-card p-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">
                Asset #{activeAsset.sequence_number}
              </h3>
              <Badge tone="neutral">Seed {activeAsset.seed}</Badge>
              <Badge tone={assetStatusTone(activeAsset.status)}>
                {assetStatusLabel(activeAsset.status)}
              </Badge>
              {activeAsset.quality_score != null ? (
                <Badge tone="neutral">Q {activeAsset.quality_score}</Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">
              Press Esc to close. Use left and right arrow keys to browse.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigateByOffset(-1)}
              disabled={!canNavigate}
              aria-label="Previous asset"
            >
              Prev
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigateByOffset(1)}
              disabled={!canNavigate}
              aria-label="Next asset"
            >
              Next
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={onClose}
              className="h-8 w-8 rounded-full"
            >
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </Button>
          </div>
        </div>

        <div className="group relative flex min-h-[300px] flex-1 items-center justify-center overflow-hidden bg-muted/50">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={activeAsset.raw_gcs_uri}
            alt={`Seed ${activeAsset.seed}`}
            className="max-h-[75vh] w-auto max-w-full object-contain"
          />
          <div className="absolute inset-y-0 left-0 flex items-center p-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full border-border bg-background/60 opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100"
              onClick={() => navigateByOffset(-1)}
              disabled={!canNavigate}
              aria-label="Previous asset image"
            >
              <ChevronLeft className="h-8 w-8" />
              <span className="sr-only">Previous</span>
            </Button>
          </div>
          <div className="absolute inset-y-0 right-0 flex items-center p-2">
            <Button
              type="button"
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full border-border bg-background/60 opacity-0 shadow-lg backdrop-blur-md transition-opacity group-hover:opacity-100"
              onClick={() => navigateByOffset(1)}
              disabled={!canNavigate}
              aria-label="Next asset image"
            >
              <ChevronRight className="h-8 w-8" />
              <span className="sr-only">Next</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function assetStatusLabel(status: CampaignAssetLightboxAsset["status"]) {
  return status === "PENDING" ? "NEEDS REVIEW" : status;
}

function assetStatusTone(
  status: CampaignAssetLightboxAsset["status"],
): "warning" | "success" | "danger" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  return "warning";
}
