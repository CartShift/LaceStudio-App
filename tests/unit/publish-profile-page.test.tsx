/* eslint-disable @next/next/no-img-element */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestMock = vi.fn();
const notifyMock = vi.fn();
const refetchMock = vi.fn(async () => undefined);
const useQueryMock = vi.fn();

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "11111111-1111-4111-8111-111111111111" }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: (input: unknown) => useQueryMock(input),
}));

vi.mock("@/components/providers/notice-provider", () => ({
  useNotice: () => ({ notify: notifyMock }),
}));

vi.mock("@/components/layout/page-header", () => ({
  PageHeader: ({
    title,
    description,
    action,
  }: {
    title: React.ReactNode;
    description?: React.ReactNode;
    action?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  ),
}));

vi.mock("@/components/workspace/form-field", () => ({
  FormField: ({
    label,
    children,
    hint,
    description,
  }: {
    label: React.ReactNode;
    children: React.ReactNode;
    hint?: React.ReactNode;
    description?: React.ReactNode;
  }) => (
    <label>
      <span>{label}</span>
      {children}
      {hint ? <span>{hint}</span> : null}
      {description ? <span>{description}</span> : null}
    </label>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  SelectField: ({
    children,
    onChange,
    value,
    ...props
  }: React.SelectHTMLAttributes<HTMLSelectElement>) => (
    <select value={value} onChange={onChange} {...props}>
      {children}
    </select>
  ),
}));

vi.mock("@/components/ui/tabs", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const TabsContext = ReactModule.createContext<{ value: string; onValueChange?: (value: string) => void } | null>(null);

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
    }: {
      value: string;
      onValueChange?: (value: string) => void;
      children: React.ReactNode;
    }) => <TabsContext.Provider value={{ value, onValueChange }}>{children}</TabsContext.Provider>,
    TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    TabsTrigger: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = ReactModule.useContext(TabsContext);
      return (
        <button type="button" onClick={() => context?.onValueChange?.(value)}>
          {children}
        </button>
      );
    },
    TabsContent: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const context = ReactModule.useContext(TabsContext);
      return context?.value === value ? <div>{children}</div> : null;
    },
  };
});

vi.mock("@/lib/client-api", () => ({
  apiRequest: (...args: unknown[]) => apiRequestMock(...args),
}));

import PublishProfilePage from "@/app/(app)/publish/profiles/[id]/page";

describe("publish profile smart copy composer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let smartCopyCall = 0;
    const profile = createProfile();
    const strategy = createStrategy();
    const recommendations = { data: [createRecommendation()] };
    const queue = { data: [], pagination: { page: 1, limit: 50, total: 0 } };
    const assets = { data: createAssets() };
    const reelVariants = { data: { variants: [], jobs: [] } };
    const analyticsDashboard = {
      kpis: {
        total_views: 1200,
        total_reach: 900,
        avg_engagement_rate: 6.4,
        avg_share_rate: 2.1,
        avg_save_rate: 1.8,
        total_posts: 12,
        top_post: null,
      },
      trend_data: [],
      model_breakdown: [],
    };
    const analyticsStrategy = {
      profile_breakdown: [],
      pillar_breakdown: [],
      daypart_breakdown: [],
      best_time_windows: [],
      schedule_adherence: { on_slot_percent: 100, avg_publish_delay_minutes: 0 },
      best_patterns: [],
      experiment_win_rate: 0,
      reel_readiness: {
        ready_variants: 0,
        pending_jobs: 0,
        scheduled_reels: 0,
        published_reels: 0,
      },
    };

    useQueryMock.mockImplementation(({ queryKey }: { queryKey: [string, string?] }) => {
      const [key] = queryKey;
      if (key === "instagram-profile") {
        return buildQueryResult(profile);
      }
      if (key === "instagram-strategy") {
        return buildQueryResult(strategy);
      }
      if (key === "publishing-recommendations") {
        return buildQueryResult(recommendations);
      }
      if (key === "publishing-queue") {
        return buildQueryResult(queue);
      }
      if (key === "publishing-assets") {
        return buildQueryResult(assets);
      }
      if (key === "reel-variants") {
        return buildQueryResult(reelVariants);
      }
      if (key === "analytics-dashboard") {
        return buildQueryResult(analyticsDashboard);
      }
      if (key === "analytics-strategy") {
        return buildQueryResult(analyticsStrategy);
      }

      throw new Error(`Unhandled query key: ${key}`);
    });

    apiRequestMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/publishing/copy/generate") {
        smartCopyCall += 1;
        const body = JSON.parse(String(init?.body ?? "{}")) as { asset_id?: string };
        if (body.asset_id === "asset-2" && smartCopyCall >= 3) {
          return createSmartCopy("Manual smart copy for asset 2", "vision_refined");
        }
        if (body.asset_id === "asset-2") {
          return createSmartCopy("Auto smart copy for asset 2", "vision_refined");
        }
        return createSmartCopy("Auto smart copy for asset 1", "metadata_draft");
      }

      if (url === "/api/publishing/schedule") {
        return { id: "queue-1" };
      }

      throw new Error(`Unexpected request: ${url}`);
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("auto-fills smart copy, preserves manual edits on later auto refresh, and exposes apply state", async () => {
    render(<PublishProfilePage />);

    const caption = await screen.findByRole("textbox");

    await waitFor(() => {
      expect(caption).toHaveValue("Auto smart copy for asset 1");
    });

    fireEvent.change(caption, { target: { value: "Manual override caption" } });
    fireEvent.change(screen.getAllByRole("combobox")[1] as HTMLSelectElement, { target: { value: "asset-2" } });

    await waitFor(() => {
      expect(caption).toHaveValue("Manual override caption");
      expect(screen.getByText("smart copy ready to apply")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Apply smart copy" })).toBeInTheDocument();
    });
  });

  it("lets manual regenerate replace the caption and queues the final edited text", async () => {
    render(<PublishProfilePage />);

    const caption = await screen.findByRole("textbox");
    await waitFor(() => {
      expect(caption).toHaveValue("Auto smart copy for asset 1");
    });

    fireEvent.change(caption, { target: { value: "Operator custom draft" } });
    fireEvent.change(screen.getAllByRole("combobox")[1] as HTMLSelectElement, { target: { value: "asset-2" } });

    await waitFor(() => {
      expect(screen.getByText("smart copy ready to apply")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Regenerate smart copy" }));

    await waitFor(() => {
      expect(caption).toHaveValue("Manual smart copy for asset 2");
    });

    fireEvent.change(caption, { target: { value: "Final queued caption" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue post" }));

    await waitFor(() => {
      const scheduleCall = apiRequestMock.mock.calls.find((call) => call[0] === "/api/publishing/schedule");
      expect(scheduleCall).toBeTruthy();
      const body = JSON.parse(String(scheduleCall?.[1]?.body ?? "{}")) as { caption?: string };
      expect(body.caption).toBe("Final queued caption");
    });
  });
});

function buildQueryResult<T>(data: T) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    refetch: refetchMock,
  };
}

function createSmartCopy(caption: string, source: "metadata_draft" | "vision_refined") {
  return {
    caption,
    source,
    caption_package: {
      caption,
      primary_keyword: "ava editorial",
      hook: caption,
      opening_hook: caption,
      body: "Supporting smart copy body.",
      call_to_action: "Save this for later.",
      hashtags: ["#AvaStyle", "#EditorialIdentity", "#Moodboard", "#StyledFeed", "#ContentStrategy"],
      rationale: "Smart copy rationale.",
      strategy_alignment: "Smart copy alignment.",
      compliance_summary: "Smart copy compliance.",
      source,
    },
  };
}

function createProfile() {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    model_id: "model-1",
    model_name: "Ava Stone",
    handle: "ava_stone",
    display_name: "Ava Stone",
    timezone: "Europe/Berlin",
    connection_status: "CONNECTED",
    graph_user_id_preview: "1234",
    publish_enabled: true,
    token_expires_at: null,
    last_analytics_sync_at: null,
    strategy: {
      primary_goal: "balanced_growth",
      weekly_post_target: 7,
      weekly_feed_target: 3,
      weekly_reel_target: 2,
      weekly_story_target: 2,
      cooldown_hours: 16,
      min_ready_assets: 2,
      active_pillars: 3,
      slot_count: 7,
      experimentation_rate_percent: 20,
      auto_queue_enabled: true,
      auto_queue_min_confidence: 0.72,
    },
    health: {
      cadence_score: 90,
      approved_assets_ready: 2,
      scheduled_count: 0,
      pending_approval_count: 0,
      failed_count: 0,
      recommendation_count: 1,
      stale_analytics: false,
      warnings: [],
    },
    last_post: null,
    next_posts: [],
  };
}

function createStrategy() {
  return {
    id: "strategy-1",
    profile_id: "11111111-1111-4111-8111-111111111111",
    primary_goal: "balanced_growth",
    timezone: "Europe/Berlin",
    weekly_post_target: 7,
    weekly_feed_target: 3,
    weekly_reel_target: 2,
    weekly_story_target: 2,
    cooldown_hours: 16,
    min_ready_assets: 2,
    auto_queue_enabled: true,
    experimentation_rate_percent: 20,
    auto_queue_min_confidence: 0.72,
    best_time_windows: [
      {
        weekday: 5,
        local_time: "18:00",
        daypart: "evening",
        score: 0.9,
        source: "learned",
      },
    ],
    notes: "Stay premium and strategic.",
    pillars: [
      {
        id: "pillar-1",
        key: "editorial_identity",
        name: "Editorial Identity",
        description: "Premium editorial frames.",
        target_share_percent: 100,
        active: true,
        priority: 0,
        supported_post_types: ["feed", "reel"],
      },
    ],
    slot_templates: [
      {
        id: "slot-1",
        pillar_key: "editorial_identity",
        label: "Friday Feature",
        weekday: 5,
        local_time: "18:00",
        daypart: "evening",
        post_type: "feed",
        variant_type: "feed_4x5",
        priority: 0,
        active: true,
      },
    ],
  };
}

function createRecommendation() {
  return {
    id: "rec-1",
    profile_id: "11111111-1111-4111-8111-111111111111",
    strategy_id: "strategy-1",
    pillar_id: "pillar-1",
    pillar_key: "editorial_identity",
    asset_id: "asset-1",
    status: "RECOMMENDED",
    slot_start: "2026-03-13T17:00:00.000Z",
    slot_end: "2026-03-13T18:00:00.000Z",
    post_type: "feed",
    variant_type: "feed_4x5",
    rationale: "Recommendation rationale.",
    confidence: 0.84,
    caption_suggestion: "Recommendation draft caption",
    caption_package: {
      caption: "Recommendation draft caption",
      primary_keyword: "ava editorial",
      hook: "Recommendation hook",
      opening_hook: "Recommendation hook",
      body: "Recommendation body",
      call_to_action: "Recommendation CTA",
      hashtags: ["#AvaStyle", "#EditorialIdentity", "#Moodboard", "#StyledFeed", "#ContentStrategy"],
      rationale: "Recommendation rationale",
      strategy_alignment: "Recommendation alignment",
      compliance_summary: "Recommendation compliance",
      source: "metadata_draft",
    },
    autopilot_metadata: {
      caption_package: {
        caption: "Recommendation draft caption",
        primary_keyword: "ava editorial",
      },
    },
    decided_at: null,
    asset: {
      id: "asset-1",
      sequence_number: 1,
      campaign: {
        id: "campaign-1",
        name: "Editorial Edit",
      },
    },
  };
}

function createAssets() {
  return [
    {
      id: "asset-1",
      sequence_number: 1,
      preview_url: "https://cdn.example.com/asset-1.jpg",
      is_available: true,
      reel_variant_ready: false,
      active_queue_item: null,
      campaign: {
        id: "campaign-1",
        name: "Editorial Edit",
      },
    },
    {
      id: "asset-2",
      sequence_number: 2,
      preview_url: "https://cdn.example.com/asset-2.jpg",
      is_available: true,
      reel_variant_ready: false,
      active_queue_item: null,
      campaign: {
        id: "campaign-1",
        name: "Editorial Edit",
      },
    },
  ];
}
