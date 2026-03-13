/* eslint-disable @next/next/no-img-element */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestMock = vi.fn();
const apiFormRequestMock = vi.fn();
const setSegmentTitleMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-1111-1111-111111111111" }),
  usePathname: () => "/campaigns/11111111-1111-1111-1111-111111111111",
}));

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; unoptimized?: boolean }) => {
    const sanitized = { ...props };
    delete sanitized.fill;
    delete sanitized.unoptimized;
    return <img {...sanitized} alt={sanitized.alt ?? ""} />;
  },
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

vi.mock("@/components/providers/breadcrumb-provider", () => ({
  useBreadcrumb: () => ({ segmentTitles: [], setSegmentTitle: setSegmentTitleMock }),
}));

vi.mock("@/lib/client-api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
  apiFormRequest: (...args: unknown[]) => apiFormRequestMock(...args),
}));

import CampaignDetailPage from "@/app/(app)/campaigns/[id]/page";

describe("campaign detail anchor-first generation flow", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    setSegmentTitleMock.mockReset();
    apiRequestMock.mockReset();
    apiFormRequestMock.mockReset();

    let campaign = createCampaign({
      anchor_asset_id: null,
      image_model_provider: "openai",
      batch_size: 5,
    });

    apiRequestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111") {
        return campaign;
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/anchor") {
        const body = JSON.parse(String(init?.body ?? "{}")) as { asset_id?: string };
        campaign = { ...campaign, anchor_asset_id: body.asset_id ?? null };
        return {
          campaign_id: campaign.id,
          anchor_asset_id: campaign.anchor_asset_id,
        };
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/generate") {
        return { job_id: "job-1", campaign_status: "GENERATING" };
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/creative-controls") {
        return campaign;
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/references") {
        return campaign;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    apiFormRequestMock.mockResolvedValue({});
  });

  it("disables campaign shots button until anchor exists", async () => {
    render(<CampaignDetailPage />);

    const [batchButton] = await screen.findAllByRole("button", { name: /Generate Campaign Shots/ });
    expect(batchButton).toBeDisabled();
  }, 10_000);

  it("sets anchor and enables campaign shots button", async () => {
    render(<CampaignDetailPage />);

    const [setAnchorButton] = await screen.findAllByRole("button", { name: "Set as Anchor" });
    if (!setAnchorButton) throw new Error("Missing Set as Anchor button");
    fireEvent.click(setAnchorButton);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/api/campaigns/11111111-1111-1111-1111-111111111111/anchor",
        expect.objectContaining({ method: "PATCH" }),
      );
    });

    const [batchButton] = await screen.findAllByRole("button", { name: /Generate Campaign Shots/ });
    await waitFor(() => {
      expect(batchButton).toBeEnabled();
    });
  }, 15_000);

  it("sends correct generation payloads for anchor and batch actions", async () => {
    apiRequestMock.mockReset();

    const campaign = createCampaign({
      anchor_asset_id: "asset-1",
      image_model_provider: "openai",
      batch_size: 5,
    });

    apiRequestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111") {
        return campaign;
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/generate") {
        return { job_id: "job-1", campaign_status: "GENERATING", payload: init?.body };
      }

      if (url === "/api/campaigns/11111111-1111-1111-1111-111111111111/creative-controls") {
        return campaign;
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CampaignDetailPage />);

    const [anchorButton] = await screen.findAllByRole("button", { name: "Generate Anchor Shot" });
    if (!anchorButton) throw new Error("Missing Generate Anchor Shot button");
    fireEvent.click(anchorButton);

    await waitFor(() => {
      expect(apiRequestMock).toHaveBeenCalledWith(
        "/api/campaigns/11111111-1111-1111-1111-111111111111/generate",
        expect.objectContaining({ method: "POST" }),
      );
    });

    const callsAfterAnchor = apiRequestMock.mock.calls.filter(call => call[0] === "/api/campaigns/11111111-1111-1111-1111-111111111111/generate");
    const anchorPayload = JSON.parse(String(callsAfterAnchor[0]?.[1]?.body ?? "{}"));
    expect(anchorPayload.generation_mode).toBe("anchor");

    const [batchButton] = await screen.findAllByRole("button", { name: /Generate Campaign Shots/ });
    if (!batchButton) throw new Error("Missing Generate Campaign Shots button");
    fireEvent.click(batchButton);

    await waitFor(() => {
      const generateCalls = apiRequestMock.mock.calls.filter(call => call[0] === "/api/campaigns/11111111-1111-1111-1111-111111111111/generate");
      expect(generateCalls.length).toBeGreaterThanOrEqual(2);
    });

    const generateCalls = apiRequestMock.mock.calls.filter(call => call[0] === "/api/campaigns/11111111-1111-1111-1111-111111111111/generate");
    const batchPayload = JSON.parse(String(generateCalls[1]?.[1]?.body ?? "{}"));
    expect(batchPayload.generation_mode).toBe("batch");
    expect(batchPayload.anchor_asset_id).toBe("asset-1");
  }, 15_000);

  it("opens the asset preview as a dialog and closes it with Escape", async () => {
    render(<CampaignDetailPage />);

    const [openPreviewButton] = await screen.findAllByRole("button", {
      name: "Open asset 1",
    });
    if (!openPreviewButton) throw new Error("Missing asset preview button");
    fireEvent.click(openPreviewButton);

    expect(
      screen.getByRole("dialog", { name: /Asset 1 preview/i }),
    ).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /Asset 1 preview/i }),
      ).toBeNull();
    });
    expect(document.body.style.overflow).toBe("");
  }, 15_000);
});

type CampaignFixture = {
  id: string;
  name: string;
  status: string;
  anchor_asset_id: string | null;
  prompt_text: string;
  image_model_provider: "gpu" | "openai" | "nano_banana_2" | "zai_glm";
  image_model_id: string;
  creative_controls: Record<string, unknown>;
  assets: Array<Record<string, unknown>>;
  generation_jobs: Array<Record<string, unknown>>;
  batch_size: number;
  resolution_width: number;
  resolution_height: number;
} & Record<string, unknown>;

function createCampaign(overrides?: Partial<CampaignFixture>): CampaignFixture {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Campaign",
    status: "REVIEW",
    anchor_asset_id: null,
    prompt_text: "Editorial campaign prompt",
    image_model_provider: "openai",
    image_model_id: "gpt-image-1",
    creative_controls: {
      reference_board: { items: [] },
      pose: {
        preset: "editorial",
        micro_rotation: { shoulder_angle: 0, hip_shift: 0, chin_tilt: 0 },
      },
      expression: { preset: "neutral", smile_intensity: 0.2 },
      outfit: { micro_adjustment: { hem_length: 0 } },
    },
    assets: [
      {
        id: "asset-1",
        status: "PENDING",
        seed: 42,
        sequence_number: 1,
        quality_score: null,
        artifacts_flagged: false,
        identity_drift_score: 0.1,
        raw_gcs_uri: "https://cdn.example.com/asset-1.png",
      },
    ],
    generation_jobs: [],
    batch_size: 5,
    resolution_width: 1024,
    resolution_height: 1024,
    ...overrides,
  };
}
