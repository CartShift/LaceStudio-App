import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CampaignAssetLightbox,
  type CampaignAssetLightboxAsset,
} from "@/components/campaigns/campaign-asset-lightbox";

describe("CampaignAssetLightbox", () => {
  afterEach(() => {
    cleanup();
  });

  it("locks scroll and emits navigation requests from the keyboard", () => {
    const onClose = vi.fn();
    const onSelectAsset = vi.fn();
    const assets: CampaignAssetLightboxAsset[] = [
      {
        id: "asset-1",
        status: "PENDING",
        seed: 42,
        sequence_number: 1,
        quality_score: null,
        raw_gcs_uri: "https://cdn.example.com/asset-1.png",
      },
      {
        id: "asset-2",
        status: "APPROVED",
        seed: 43,
        sequence_number: 2,
        quality_score: 88,
        raw_gcs_uri: "https://cdn.example.com/asset-2.png",
      },
    ];

    const { rerender } = render(
      <CampaignAssetLightbox
        assets={assets}
        activeAssetId="asset-1"
        onClose={onClose}
        onSelectAsset={onSelectAsset}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: /Asset 1 preview/i }),
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onSelectAsset).toHaveBeenCalledWith("asset-2");

    rerender(
      <CampaignAssetLightbox
        assets={assets}
        activeAssetId="asset-2"
        onClose={onClose}
        onSelectAsset={onSelectAsset}
      />,
    );

    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(onSelectAsset).toHaveBeenCalledWith("asset-1");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <CampaignAssetLightbox
        assets={assets}
        activeAssetId={null}
        onClose={onClose}
        onSelectAsset={onSelectAsset}
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});
