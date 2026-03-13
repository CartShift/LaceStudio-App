"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  Clock3,
  Flame,
  ImageIcon,
  Lightbulb,
  Plus,
  RefreshCw,
  Sparkles,
  Target,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { useNotice } from "@/components/providers/notice-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/workspace/form-field";
import { FormShell } from "@/components/workspace/form-shell";
import { apiRequest } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import type {
  InstagramProfileConnectionStatus,
  InstagramProfileSummary,
  PostingPlanItem,
  PostingStrategy,
  PublishingStatus,
  StrategyPillar,
  StrategySlotTemplate,
} from "@/types/domain";

type ProfilesResponse = { data: InstagramProfileSummary[] };
type RecommendationsResponse = { data: PostingPlanItem[] };
type QueueItem = {
  id: string;
  status: PublishingStatus;
  caption: string;
  post_type: "feed" | "story" | "reel";
  variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "master";
  scheduled_at: string;
  published_at?: string | null;
  slot_start?: string | null;
  pillar_key?: string | null;
  asset?: {
    id: string;
    sequence_number: number;
    preview_url?: string | null;
    campaign?: { id: string; name: string } | null;
  } | null;
};
type CalendarResponse = { data: QueueItem[]; pagination: { page: number; limit: number; total: number } | null };
type ApprovedAsset = {
  id: string;
  sequence_number: number;
  preview_url?: string | null;
  is_available?: boolean;
  active_queue_item?: {
    id: string;
    status: PublishingStatus;
    scheduled_at: string;
    profile_id: string | null;
    profile?: { id: string; handle: string | null; display_name: string | null } | null;
  } | null;
  campaign?: { id: string; name: string } | null;
};
type ApprovedAssetsResponse = { data: ApprovedAsset[] };
type AnalyticsDashboardPayload = {
  kpis: { total_reach: number; avg_engagement_rate: number; total_posts: number; top_post: { publishing_queue_id: string; engagement_rate: number } | null };
  trend_data: Array<{ date: string; engagement_rate: number }>;
  model_breakdown: Array<{ model_id: string; reach: number; engagement_rate: number; post_count: number }>;
};
type AnalyticsStrategyPayload = {
  pillar_breakdown: Array<{ pillar_key: string; total_reach: number; avg_engagement_rate: number; published_posts: number }>;
  daypart_breakdown: Array<{ daypart: string; avg_engagement_rate: number; published_posts: number }>;
  schedule_adherence: { on_slot_percent: number; avg_publish_delay_minutes: number };
  best_patterns: Array<{ label: string; engagement_rate: number; published_posts: number }>;
};

type SignalTone = "neutral" | "success" | "warning" | "danger";

const MIN_SCHEDULE_LEAD_MINUTES = 15;
const ACTIVE_QUEUE_STATUSES = new Set<PublishingStatus>(["PENDING_APPROVAL", "SCHEDULED", "PUBLISHING", "RETRY"]);

function toLocalInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatSlot(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateLabel(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function humanizePillar(value: string | null | undefined) {
  return value ? value.replaceAll("_", " ") : "Open slot";
}

function humanizeStatus(value: string) {
  return value.replaceAll("_", " ").toLowerCase();
}

function formatRelativeWindow(iso: string) {
  const target = new Date(iso).getTime();
  const diffMinutes = Math.round((target - Date.now()) / 60_000);
  if (Math.abs(diffMinutes) < 60) {
    return diffMinutes >= 0 ? `in ${diffMinutes}m` : `${Math.abs(diffMinutes)}m ago`;
  }

  const diffHours = Math.round(diffMinutes / 60);
  if (Math.abs(diffHours) < 24) {
    return diffHours >= 0 ? `in ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
  }

  const diffDays = Math.round(diffHours / 24);
  return diffDays >= 0 ? `in ${diffDays}d` : `${Math.abs(diffDays)}d ago`;
}

function toneForQueueStatus(status: PublishingStatus): SignalTone {
  if (status === "FAILED" || status === "REJECTED" || status === "CANCELLED") return "danger";
  if (status === "PENDING_APPROVAL" || status === "RETRY") return "warning";
  if (status === "PUBLISHED" || status === "SCHEDULED" || status === "PUBLISHING") return "success";
  return "neutral";
}

function toneForConnection(status: InstagramProfileConnectionStatus): SignalTone {
  if (status === "CONNECTED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "ERROR" || status === "EXPIRED") return "danger";
  return "neutral";
}

function safeDate(input: string) {
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

function blankPillar(index: number): StrategyPillar {
  return {
    key: `pillar_${index + 1}`,
    name: `Pillar ${index + 1}`,
    description: "",
    target_share_percent: 0,
    active: true,
    priority: index,
    supported_post_types: ["feed"],
  };
}

function blankSlot(index: number, pillarKey?: string): StrategySlotTemplate {
  return {
    pillar_key: pillarKey ?? null,
    label: `Slot ${index + 1}`,
    weekday: index % 7,
    local_time: "18:00",
    daypart: "evening",
    post_type: "feed",
    variant_type: "feed_4x5",
    priority: index,
    active: true,
  };
}

export default function PublishProfilePage() {
  const params = useParams<{ id: string }>();
  const profileId = Array.isArray(params.id) ? params.id[0] : params.id;
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { notify } = useNotice();
  const [activeTab, setActiveTab] = useState("compose");
  const [strategyDraft, setStrategyDraft] = useState<PostingStrategy | null>(null);
  const [savingStrategy, setSavingStrategy] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [selectedRecommendationId, setSelectedRecommendationId] = useState("");
  const [assetId, setAssetId] = useState("");
  const [caption, setCaption] = useState("");
  const [postType, setPostType] = useState<QueueItem["post_type"]>("feed");
  const [variantType, setVariantType] = useState<QueueItem["variant_type"]>("feed_4x5");
  const [scheduledAt, setScheduledAt] = useState(toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));

  const profileQuery = useQuery({
    queryKey: ["instagram-profile", profileId],
    queryFn: async () => (await apiRequest<ProfilesResponse>(`/api/instagram/profiles?profile_id=${profileId}`)).data[0] ?? null,
  });
  const strategyQuery = useQuery({
    queryKey: ["instagram-strategy", profileId],
    queryFn: () => apiRequest<PostingStrategy>(`/api/instagram/profiles/${profileId}/strategy`),
  });
  const recommendationsQuery = useQuery({
    queryKey: ["publishing-recommendations", profileId],
    queryFn: () => apiRequest<RecommendationsResponse>(`/api/publishing/recommendations?profile_id=${profileId}&horizon_days=14`),
  });
  const queueQuery = useQuery({
    queryKey: ["publishing-queue", profileId],
    queryFn: () => {
      const start = new Date();
      start.setDate(start.getDate() - 7);
      const end = new Date();
      end.setDate(end.getDate() + 45);
      return apiRequest<CalendarResponse>(
        `/api/publishing/calendar?profile_id=${profileId}&start_date=${encodeURIComponent(start.toISOString())}&end_date=${encodeURIComponent(end.toISOString())}&page=1&limit=50`,
      );
    },
  });
  const assetsQuery = useQuery({
    queryKey: ["publishing-assets", profileId],
    queryFn: () => apiRequest<ApprovedAssetsResponse>(`/api/publishing/assets?profile_id=${profileId}`),
  });
  const analyticsQuery = useQuery({
    queryKey: ["analytics-dashboard", profileId],
    queryFn: () => apiRequest<AnalyticsDashboardPayload>(`/api/analytics/dashboard?profile_id=${profileId}`),
  });
  const analyticsStrategyQuery = useQuery({
    queryKey: ["analytics-strategy", profileId],
    queryFn: () => apiRequest<AnalyticsStrategyPayload>(`/api/analytics/strategy?profile_id=${profileId}`),
  });

  const profile = profileQuery.data;
  const recommendations = recommendationsQuery.data?.data ?? [];
  const queue = queueQuery.data?.data ?? [];
  const assets = assetsQuery.data?.data ?? [];

  useEffect(() => {
    if (strategyQuery.data) setStrategyDraft(strategyQuery.data);
  }, [strategyQuery.data]);

  useEffect(() => {
    const preferredAsset = assets.find((asset) => asset.is_available !== false) ?? assets[0];
    if (!preferredAsset) return;

    const selectedAssetStillExists = assets.some((asset) => asset.id === assetId);
    const selectedAssetUnavailable = assets.find((asset) => asset.id === assetId)?.is_available === false;

    if (!assetId || !selectedAssetStillExists || selectedAssetUnavailable) {
      setAssetId(preferredAsset.id);
    }
  }, [assetId, assets]);

  useEffect(() => {
    if (!selectedRecommendationId) return;
    const match = recommendations.find((item) => item.id === selectedRecommendationId);
    if (!match) return;

    setScheduledAt(toLocalInputValue(new Date(match.slot_start)));
    setPostType(match.post_type);
    setVariantType(match.variant_type);
    setCaption(match.caption_suggestion ?? "");
    if (match.asset_id) setAssetId(match.asset_id);
  }, [recommendations, selectedRecommendationId]);

  const selectedRecommendation = useMemo(
    () => recommendations.find((item) => item.id === selectedRecommendationId) ?? null,
    [recommendations, selectedRecommendationId],
  );
  const selectedAsset = useMemo(() => assets.find((asset) => asset.id === assetId) ?? null, [assetId, assets]);
  const availableAssets = useMemo(() => assets.filter((asset) => asset.is_available !== false), [assets]);
  const reservedAssets = useMemo(() => assets.filter((asset) => asset.is_available === false), [assets]);
  const activeShareTotal = useMemo(
    () => strategyDraft?.pillars.filter((pillar) => pillar.active).reduce((sum, pillar) => sum + pillar.target_share_percent, 0) ?? 0,
    [strategyDraft],
  );

  const scheduleDate = useMemo(() => safeDate(scheduledAt), [scheduledAt]);
  const captionStats = useMemo(
    () => ({
      length: caption.length,
      hashtagCount: caption.match(/(^|\s)#[A-Za-z0-9_]+/g)?.length ?? 0,
      lineCount: caption.split(/\n+/).filter(Boolean).length,
    }),
    [caption],
  );

  const queueSummary = useMemo(() => {
    const upcoming = queue.filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status)).length;
    const approvals = queue.filter((item) => item.status === "PENDING_APPROVAL").length;
    const published = queue.filter((item) => item.status === "PUBLISHED").length;
    const failures = queue.filter((item) => item.status === "FAILED" || item.status === "REJECTED").length;
    return { upcoming, approvals, published, failures };
  }, [queue]);

  const upcomingQueue = useMemo(
    () =>
      queue
        .filter((item) => ACTIVE_QUEUE_STATUSES.has(item.status))
        .sort((left, right) => new Date(left.scheduled_at).getTime() - new Date(right.scheduled_at).getTime()),
    [queue],
  );
  const recentQueue = useMemo(
    () =>
      queue
        .filter((item) => !ACTIVE_QUEUE_STATUSES.has(item.status))
        .sort((left, right) => {
          const leftTime = new Date(left.published_at ?? left.scheduled_at).getTime();
          const rightTime = new Date(right.published_at ?? right.scheduled_at).getTime();
          return rightTime - leftTime;
        }),
    [queue],
  );

  const composerSignals = useMemo(() => {
    const signals: Array<{ tone: SignalTone; title: string; description: string }> = [];
    const minimumDate = new Date(Date.now() + MIN_SCHEDULE_LEAD_MINUTES * 60 * 1000);

    if (profile?.connection_status !== "CONNECTED") {
      signals.push({
        tone: "warning",
        title: "Connection attention needed",
        description: "Queueing still works, but this profile will not publish cleanly until Instagram is connected and healthy.",
      });
    }

    if (availableAssets.length === 0) {
      signals.push({
        tone: "danger",
        title: "No free approved assets",
        description: "Every approved asset is already committed to another active queue item. Approve more assets or manage the existing queue.",
      });
    }

    if (scheduleDate && scheduleDate.getTime() < minimumDate.getTime()) {
      signals.push({
        tone: "danger",
        title: "Lead time is too short",
        description: `Instagram scheduling requires at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes of lead time from now.`,
      });
    }

    if (selectedAsset?.active_queue_item) {
      signals.push({
        tone: "danger",
        title: "Selected asset is already reserved",
        description: `This asset is attached to a ${humanizeStatus(selectedAsset.active_queue_item.status)} item at ${formatSlot(selectedAsset.active_queue_item.scheduled_at)}.`,
      });
    }

    const cooldownHours = profile?.strategy?.cooldown_hours ?? strategyDraft?.cooldown_hours ?? 0;
    if (scheduleDate && cooldownHours > 0) {
      const cooldownConflict = upcomingQueue.find((item) => {
        const delta = Math.abs(new Date(item.scheduled_at).getTime() - scheduleDate.getTime());
        return delta < cooldownHours * 60 * 60 * 1000;
      });

      if (cooldownConflict) {
        signals.push({
          tone: "warning",
          title: "Cooldown window is crowded",
          description: `Another post is already parked at ${formatSlot(cooldownConflict.scheduled_at)}. Consider spacing this out by at least ${cooldownHours} hours.`,
        });
      }
    }

    if (selectedRecommendation && scheduleDate) {
      const slotDeltaHours = Math.abs(new Date(selectedRecommendation.slot_start).getTime() - scheduleDate.getTime()) / (60 * 60 * 1000);
      if (slotDeltaHours > 2) {
        signals.push({
          tone: "warning",
          title: "Schedule drift from the recommended slot",
          description: "You moved this post away from its recommended timing window. Double-check that the shift still matches the strategy.",
        });
      }
    }

    if ((profile?.health.failed_count ?? 0) > 0) {
      signals.push({
        tone: "warning",
        title: "Failures still need cleanup",
        description: "This profile has failed publishing items. Clear those before you keep stacking new posts into the queue.",
      });
    }

    if (!signals.length) {
      signals.push({
        tone: "success",
        title: "Composer is clear",
        description: "The selected slot, asset, and caption are aligned with the current queue and strategy guardrails.",
      });
    }

    return signals;
  }, [availableAssets.length, profile, scheduleDate, selectedAsset, selectedRecommendation, strategyDraft?.cooldown_hours, upcomingQueue]);

  async function refreshAll() {
    await Promise.all([
      profileQuery.refetch(),
      strategyQuery.refetch(),
      recommendationsQuery.refetch(),
      queueQuery.refetch(),
      assetsQuery.refetch(),
      analyticsQuery.refetch(),
      analyticsStrategyQuery.refetch(),
    ]);
  }

  async function saveStrategy(event: FormEvent) {
    event.preventDefault();
    if (!strategyDraft) return;

    setSavingStrategy(true);
    try {
      await apiRequest(`/api/instagram/profiles/${profileId}/strategy`, {
        method: "PUT",
        body: JSON.stringify({ ...strategyDraft, profile_id: undefined }),
      });
      await Promise.all([strategyQuery.refetch(), recommendationsQuery.refetch(), profileQuery.refetch()]);
      notify({ tone: "success", title: "Strategy saved", description: "Cadence, pillars, and slot templates have been updated." });
    } catch (error) {
      notify({ tone: "error", title: "Strategy save failed", description: error instanceof Error ? error.message : "We couldn't save the posting strategy." });
    } finally {
      setSavingStrategy(false);
    }
  }

  async function schedulePost(event: FormEvent) {
    event.preventDefault();
    setScheduling(true);

    try {
      await apiRequest("/api/publishing/schedule", {
        method: "POST",
        body: JSON.stringify({
          asset_id: assetId,
          profile_id: profileId,
          plan_item_id: selectedRecommendationId || undefined,
          variant_type: variantType,
          post_type: postType,
          caption,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });

      setSelectedRecommendationId("");
      setCaption("");
      setScheduledAt(toLocalInputValue(new Date(Date.now() + 2 * 60 * 60 * 1000)));
      setActiveTab("queue");

      await Promise.all([queueQuery.refetch(), recommendationsQuery.refetch(), profileQuery.refetch(), assetsQuery.refetch()]);
      notify({ tone: "success", title: "Post queued", description: `Scheduled in ${timezone}. Review the queue rail for confirmation.` });
    } catch (error) {
      notify({ tone: "error", title: "Scheduling failed", description: error instanceof Error ? error.message : "We couldn't schedule this post." });
    } finally {
      setScheduling(false);
    }
  }

  async function actOnRecommendation(item: PostingPlanItem, action: "accept" | "skip") {
    setWorkingId(item.id);

    try {
      await apiRequest(`/api/publishing/recommendations/${item.id}/${action}`, {
        method: "POST",
        body: JSON.stringify(
          action === "accept"
            ? {
                profile_id: profileId,
                asset_id: item.asset_id ?? availableAssets[0]?.id,
                caption: item.caption_suggestion ?? undefined,
              }
            : { reason: "Skipped from the publishing workspace." },
        ),
      });

      await Promise.all([recommendationsQuery.refetch(), queueQuery.refetch(), profileQuery.refetch(), assetsQuery.refetch()]);
      setActiveTab(action === "accept" ? "queue" : "compose");
      notify({
        tone: "success",
        title: action === "accept" ? "Recommendation queued" : "Recommendation skipped",
        description: action === "accept" ? "The slot has been sent directly into the publishing queue." : "The slot has been removed from the active planning rail.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: action === "accept" ? "Queueing failed" : "Skip failed",
        description: error instanceof Error ? error.message : "We couldn't update this recommendation.",
      });
    } finally {
      setWorkingId(null);
    }
  }

  if (profileQuery.isLoading || strategyQuery.isLoading) {
    return (
      <PageScaffold>
        <StateBlock title="Loading publishing workspace…" />
      </PageScaffold>
    );
  }

  if (!profile) {
    return (
      <PageScaffold>
        <StateBlock tone="error" title="Profile not found" description="This publishing profile does not exist." />
      </PageScaffold>
    );
  }

  return (
    <PageScaffold className="space-y-6">
      <PageHeader
        title={profile.display_name ?? profile.model_name}
        description={`A profile-specific publishing deck for strategy, next posts, queue health, and Instagram delivery. Local browser timezone: ${timezone}.`}
        action={
          <>
            <Button asChild variant="secondary">
              <Link href="/publish">
                <ChevronLeft className="h-4 w-4" />
                Back to cockpit
              </Link>
            </Button>
            <Button onClick={() => void refreshAll()}>
              <RefreshCw className={`h-4 w-4 ${(profileQuery.isFetching || strategyQuery.isFetching) ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </>
        }
      />

      <EditorialCard className="overflow-hidden rounded-[2rem] border border-border/70 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary),transparent_88%),transparent_34%),linear-gradient(135deg,color-mix(in_oklab,var(--background),white_4%)_0%,color-mix(in_oklab,var(--background),var(--accent)_10%)_48%,color-mix(in_oklab,var(--background),white_2%)_100%)] p-0">
        <div className="grid gap-0 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-5 border-b border-border/60 p-6 xl:border-r xl:border-b-0 xl:p-7">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={toneForConnection(profile.connection_status)}>{profile.connection_status}</Badge>
              <Badge tone={profile.publish_enabled ? "success" : "warning"}>{profile.publish_enabled ? "Publishing enabled" : "Publishing paused"}</Badge>
              <Badge tone="neutral">{profile.handle ? `@${profile.handle.replace(/^@/, "")}` : "Handle pending"}</Badge>
            </div>

            <div className="space-y-3">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <Sparkles className="h-4 w-4" />
                Publishing Flight Deck
              </p>
              <h2 className="max-w-3xl font-display text-[clamp(2.2rem,4.2vw,3.8rem)] font-semibold leading-[0.94] tracking-[-0.06em]">
                Queue the next post with the right asset, the right slot, and fewer avoidable mistakes.
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                Strategy is operator-controlled, recommendations stay editable, and the queue is now easier to reason about before anything reaches approval or publish execution.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <WorkspaceMetric label="Cadence score" value={`${profile.health.cadence_score}%`} hint={`${profile.health.recommendation_count} live recommendations`} />
              <WorkspaceMetric label="Ready assets" value={String(profile.health.approved_assets_ready)} hint={`${profile.strategy?.min_ready_assets ?? 0} minimum target`} />
              <WorkspaceMetric label="Upcoming queue" value={String(queueSummary.upcoming)} hint={`${queueSummary.approvals} pending approval`} />
              <WorkspaceMetric
                label="Last post"
                value={profile.last_post ? `${profile.last_post.engagement_rate.toFixed(2)}%` : "No sync"}
                hint={profile.last_post ? `${profile.last_post.reach.toLocaleString()} reach` : "Waiting for analytics"}
                tone={profile.last_post ? "success" : "neutral"}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setActiveTab("compose")}>
                <WandSparkles className="h-4 w-4" />
                Open composer
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setActiveTab("queue")}>
                <CalendarClock className="h-4 w-4" />
                Review queue
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setActiveTab("strategy")}>
                <Target className="h-4 w-4" />
                Tune strategy
              </Button>
              <Button size="sm" variant="ghost" asChild>
                <Link href="/publish/approvals">
                  Approval queue
                  <ArrowUpRight className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-px bg-border/50 p-px sm:grid-cols-2 xl:grid-cols-1">
            <HeroSignal
              icon={<Lightbulb className="h-5 w-5" />}
              label="Best next move"
              value={selectedRecommendation ? humanizePillar(selectedRecommendation.pillar_key) : recommendations[0] ? humanizePillar(recommendations[0].pillar_key) : "Build the next slot"}
              description={
                selectedRecommendation
                  ? `${formatSlot(selectedRecommendation.slot_start)} · ${selectedRecommendation.post_type} / ${selectedRecommendation.variant_type}`
                  : recommendations[0]
                    ? `${formatSlot(recommendations[0].slot_start)} · ${recommendations[0].post_type} / ${recommendations[0].variant_type}`
                    : "Approve more assets or refine the strategy to seed new recommendations."
              }
            />
            <HeroSignal
              icon={<Flame className="h-5 w-5" />}
              label="Current risk"
              value={composerSignals[0]?.title ?? "No urgent risk"}
              description={composerSignals[0]?.description ?? "Queue, asset readiness, and strategy constraints are aligned."}
              tone={composerSignals[0]?.tone ?? "neutral"}
            />
            <HeroSignal
              icon={<Clock3 className="h-5 w-5" />}
              label="Analytics freshness"
              value={profile.last_analytics_sync_at ? formatSlot(profile.last_analytics_sync_at) : "No sync"}
              description={profile.health.stale_analytics ? "Analytics are stale and should be refreshed before making cadence decisions." : "Recent enough for planning and queue decisions."}
              tone={profile.health.stale_analytics ? "warning" : "success"}
            />
            <HeroSignal
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="Strategy coverage"
              value={`${profile.strategy?.slot_count ?? 0} active slots`}
              description={`${profile.strategy?.active_pillars ?? 0} pillars across ${profile.strategy?.weekly_post_target ?? 0} target posts each week.`}
            />
          </div>
        </div>
      </EditorialCard>

      {profile.health.warnings.length > 0 ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {profile.health.warnings.map((warning) => (
            <SectionCallout key={warning} tone="warning" title="Publishing warning" description={warning} />
          ))}
        </div>
      ) : (
        <SectionCallout
          tone="success"
          title="Workspace is stable"
          description="Connection health, analytics freshness, and asset readiness are currently aligned for this profile."
        />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList variant="line" className="flex-wrap">
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="strategy">Strategy</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="compose" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[0.94fr_1.06fr]">
            <FormShell title="Recommendation rail" description="Strategy-generated opportunities for the next two weeks. Queue them instantly or load one into the composer.">
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <WorkspaceMetric label="Recommendation count" value={String(recommendations.length)} hint="Fresh slots from strategy and readiness checks" />
                  <WorkspaceMetric label="Unclaimed assets" value={String(availableAssets.length)} hint={`${reservedAssets.length} already committed elsewhere`} />
                </div>

                {recommendations.length ? (
                  recommendations.map((item) => (
                    <RecommendationCard
                      key={item.id}
                      item={item}
                      selected={item.id === selectedRecommendationId}
                      working={workingId === item.id}
                      canQueue={Boolean(item.asset_id || availableAssets[0]?.id)}
                      onLoad={() => {
                        setSelectedRecommendationId(item.id);
                        setActiveTab("compose");
                      }}
                      onAccept={() => void actOnRecommendation(item, "accept")}
                      onSkip={() => void actOnRecommendation(item, "skip")}
                    />
                  ))
                ) : (
                  <StateBlock title="No recommendations yet" description="Refine the strategy or approve more assets to populate the next-post rail." />
                )}
              </div>
            </FormShell>

            <FormShell
              title="Compose and queue"
              description="Pair an approved asset with the right slot and caption, then send it into the queue with better visibility into conflicts."
            >
              <form onSubmit={schedulePost} className="space-y-5">
                {selectedRecommendation ? (
                  <SectionCallout
                    tone="success"
                    title="Composer loaded from a strategy slot"
                    description={`${humanizePillar(selectedRecommendation.pillar_key)} · ${formatSlot(selectedRecommendation.slot_start)} · ${selectedRecommendation.post_type} / ${selectedRecommendation.variant_type}`}
                    action={
                      <Button size="sm" variant="ghost" onClick={() => setSelectedRecommendationId("")}>
                        Clear slot
                      </Button>
                    }
                  />
                ) : null}

                <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
                  <div className="rounded-[1.6rem] border border-border/70 bg-background/70 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Selected asset</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {selectedAsset ? `${selectedAsset.campaign?.name ?? "Campaign"} · Asset #${selectedAsset.sequence_number}` : "Select an approved asset"}
                        </p>
                      </div>
                      <Badge tone={selectedAsset?.is_available === false ? "warning" : "success"}>
                        {selectedAsset?.is_available === false ? "Reserved" : "Ready to queue"}
                      </Badge>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-[1.4rem] border border-border/70 bg-muted/20">
                      {selectedAsset?.preview_url ? (
                        <img
                          src={selectedAsset.preview_url}
                          alt={`Asset ${selectedAsset.sequence_number}`}
                          className="aspect-[4/5] w-full object-cover"
                        />
                      ) : (
                        <div className="flex aspect-[4/5] items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--accent),transparent_35%),transparent_58%)] text-center">
                          <div className="space-y-2 px-6">
                            <ImageIcon className="mx-auto h-10 w-10 text-muted-foreground" />
                            <p className="text-sm font-medium">Preview unavailable</p>
                            <p className="text-xs text-muted-foreground">The asset is still selectable, but there is no preview URL available for this environment.</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-3 rounded-[1.6rem] border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Guardrails</p>
                        <p className="mt-1 text-sm text-muted-foreground">Live validation before this post reaches the queue.</p>
                      </div>
                      <ShieldPill tone={composerSignals[0]?.tone ?? "neutral"} label={composerSignals[0]?.title ?? "Stable"} />
                    </div>

                    <div className="space-y-2.5">
                      {composerSignals.map((signal) => (
                        <div key={`${signal.title}-${signal.description}`} className="rounded-[1.2rem] border border-border/65 bg-background/70 p-3">
                          <div className="flex items-start gap-3">
                            <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", signal.tone === "danger" ? "text-destructive" : signal.tone === "warning" ? "text-[var(--status-warning)]" : "text-primary")} />
                            <div className="space-y-1">
                              <p className="text-sm font-medium">{signal.title}</p>
                              <p className="text-xs leading-relaxed text-muted-foreground">{signal.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <WorkspaceMetric label="Caption" value={`${captionStats.length}`} hint={`${captionStats.hashtagCount} hashtags`} compact />
                      <WorkspaceMetric label="Queue now" value={String(queueSummary.upcoming)} hint="Active scheduled volume" compact />
                      <WorkspaceMetric label="Ready assets" value={String(availableAssets.length)} hint="Free approved picks" compact />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Quick picks</p>
                      <p className="mt-1 text-sm text-muted-foreground">Tap a free approved asset to move faster.</p>
                    </div>
                    <Badge tone="neutral">{availableAssets.length} available</Badge>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                    {availableAssets.slice(0, 6).map((asset) => (
                      <AssetChoiceCard key={asset.id} asset={asset} selected={asset.id === assetId} onSelect={() => setAssetId(asset.id)} />
                    ))}
                    {availableAssets.length === 0 ? (
                      <div className="rounded-[1.3rem] border border-dashed border-border/70 bg-background/50 px-4 py-10 text-center">
                        <p className="font-medium">No free approved assets</p>
                        <p className="mt-2 text-sm text-muted-foreground">Approve more assets or clear active queue items before scheduling another post.</p>
                      </div>
                    ) : null}
                  </div>

                  {reservedAssets.length > 0 ? (
                    <div className="rounded-[1.3rem] border border-border/70 bg-background/55 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">Already committed</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {reservedAssets.slice(0, 6).map((asset) => (
                          <Badge key={asset.id} tone="warning">
                            {asset.campaign?.name ?? "Campaign"} · Asset #{asset.sequence_number}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-4 xl:grid-cols-2">
                  <FormField label="Recommendation slot" hint="Optional. Loading a slot keeps the composer aligned with the strategy rail.">
                    <SelectField value={selectedRecommendationId} onChange={(event) => setSelectedRecommendationId(event.target.value)}>
                      <option value="">Manual only</option>
                      {recommendations.map((item) => (
                        <option key={item.id} value={item.id}>
                          {formatSlot(item.slot_start)} · {humanizePillar(item.pillar_key)}
                        </option>
                      ))}
                    </SelectField>
                  </FormField>

                  <FormField label="Approved asset" hint="Only free approved assets can be queued from this composer.">
                    <SelectField value={assetId} onChange={(event) => setAssetId(event.target.value)} required>
                      <option value="" disabled>
                        Select an approved asset
                      </option>
                      {availableAssets.map((asset) => (
                        <option key={asset.id} value={asset.id}>
                          {asset.campaign?.name ?? "Campaign"} · Asset #{asset.sequence_number}
                        </option>
                      ))}
                    </SelectField>
                  </FormField>
                </div>

                <div className="grid gap-4 xl:grid-cols-3">
                  <FormField label="Schedule time" hint={`This browser is in ${timezone}. Server validation still requires at least ${MIN_SCHEDULE_LEAD_MINUTES} minutes of lead time.`}>
                    <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required />
                  </FormField>

                  <FormField label="Post type">
                    <SelectField
                      value={postType}
                      onChange={(event) => {
                        const nextType = event.target.value as QueueItem["post_type"];
                        setPostType(nextType);
                        setVariantType(nextType === "story" ? "story_9x16" : "feed_4x5");
                      }}
                    >
                      <option value="feed">Feed</option>
                      <option value="story">Story</option>
                    </SelectField>
                  </FormField>

                  <FormField label="Variant">
                    <SelectField value={variantType} onChange={(event) => setVariantType(event.target.value as QueueItem["variant_type"])}>
                      {postType === "story" ? <option value="story_9x16">story_9x16</option> : null}
                      {postType === "feed" ? (
                        <>
                          <option value="feed_4x5">feed_4x5</option>
                          <option value="feed_1x1">feed_1x1</option>
                        </>
                      ) : null}
                    </SelectField>
                  </FormField>
                </div>

                <FormField
                  label="Caption"
                  description="Keep this tight and publish-ready. You can load the recommendation caption as a starting point, then make final operator edits."
                >
                  <Textarea rows={5} value={caption} maxLength={2200} onChange={(event) => setCaption(event.target.value)} required />
                </FormField>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-border/70 bg-background/65 px-4 py-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center gap-3">
                    <span>{captionStats.length}/2,200 characters</span>
                    <span>{captionStats.lineCount} blocks</span>
                    <span>{captionStats.hashtagCount} hashtags</span>
                  </div>
                  {selectedRecommendation?.caption_suggestion ? (
                    <Button size="sm" variant="ghost" onClick={() => setCaption(selectedRecommendation.caption_suggestion ?? "")}>
                      Load suggested caption
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="text-sm text-muted-foreground">
                    {scheduleDate ? `This post is headed for ${formatSlot(scheduleDate.toISOString())}.` : "Pick a schedule time to finish the queue item."}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <Link href="/publish/approvals">Open approvals</Link>
                    </Button>
                    <Button type="submit" disabled={scheduling || availableAssets.length === 0}>
                      {scheduling ? "Queueing…" : "Queue post"}
                    </Button>
                  </div>
                </div>
              </form>
            </FormShell>
          </div>
        </TabsContent>

        <TabsContent value="queue" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-4">
            <WorkspaceMetric label="Upcoming" value={String(queueSummary.upcoming)} hint="Pending approval, scheduled, publishing, retry" />
            <WorkspaceMetric label="Needs approval" value={String(queueSummary.approvals)} hint="Items waiting for a human green light" />
            <WorkspaceMetric label="Published" value={String(queueSummary.published)} hint="Completed posts in the current window" />
            <WorkspaceMetric label="Failures" value={String(queueSummary.failures)} hint="Posts needing intervention or cleanup" tone={queueSummary.failures > 0 ? "danger" : "neutral"} />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <FormShell title="Active queue" description="Everything that still needs review, execution, or retry handling.">
              <div className="space-y-3">
                {upcomingQueue.length ? (
                  upcomingQueue.map((item) => <QueueEventCard key={item.id} item={item} />)
                ) : (
                  <StateBlock title="No active items" description="This profile has no pending approvals or scheduled posts in the current queue window." />
                )}
              </div>
            </FormShell>

            <FormShell title="Recent outcomes" description="Published, failed, rejected, and completed queue history for this profile.">
              <div className="space-y-3">
                {recentQueue.length ? (
                  recentQueue.slice(0, 8).map((item) => <QueueEventCard key={item.id} item={item} />)
                ) : (
                  <StateBlock title="No recent outcomes" description="Once posts publish or fail, they will appear here for a quick audit trail." />
                )}
              </div>
            </FormShell>
          </div>
        </TabsContent>

        <TabsContent value="strategy" className="space-y-4">
          {strategyDraft ? (
            <form onSubmit={saveStrategy} className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-4">
                <WorkspaceMetric label="Weekly target" value={String(strategyDraft.weekly_post_target)} hint="Desired post count per week" />
                <WorkspaceMetric label="Cooldown" value={`${strategyDraft.cooldown_hours}h`} hint="Minimum spacing between posts" />
                <WorkspaceMetric label="Ready asset floor" value={String(strategyDraft.min_ready_assets)} hint="Minimum assets before cadence feels safe" />
                <WorkspaceMetric label="Active share total" value={`${activeShareTotal}%`} hint={activeShareTotal === 100 ? "Perfectly balanced" : "Active pillars should total 100%"} tone={activeShareTotal === 100 ? "success" : "warning"} />
              </div>

              <FormShell
                title="Strategy core"
                description="Profile-level cadence, timezone, and notes that shape the recommendation engine."
                footer={<Button type="submit" disabled={savingStrategy}>{savingStrategy ? "Saving…" : "Save strategy"}</Button>}
              >
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                  <FormField label="Timezone">
                    <Input value={strategyDraft.timezone} onChange={(event) => setStrategyDraft({ ...strategyDraft, timezone: event.target.value })} />
                  </FormField>
                  <FormField label="Weekly target">
                    <Input type="number" min={1} max={30} value={strategyDraft.weekly_post_target} onChange={(event) => setStrategyDraft({ ...strategyDraft, weekly_post_target: Number(event.target.value) || 1 })} />
                  </FormField>
                  <FormField label="Cooldown hours">
                    <Input type="number" min={0} max={168} value={strategyDraft.cooldown_hours} onChange={(event) => setStrategyDraft({ ...strategyDraft, cooldown_hours: Number(event.target.value) || 0 })} />
                  </FormField>
                  <FormField label="Minimum ready assets">
                    <Input type="number" min={0} max={50} value={strategyDraft.min_ready_assets} onChange={(event) => setStrategyDraft({ ...strategyDraft, min_ready_assets: Number(event.target.value) || 0 })} />
                  </FormField>
                  <FormField label="Autopilot mode">
                    <SelectField value={strategyDraft.auto_queue_enabled ? "enabled" : "disabled"} onChange={(event) => setStrategyDraft({ ...strategyDraft, auto_queue_enabled: event.target.value === "enabled" })}>
                      <option value="disabled">Operator confirmed</option>
                      <option value="enabled">Future autopilot</option>
                    </SelectField>
                  </FormField>
                </div>

                <div className="mt-4">
                  <FormField label="Notes">
                    <Textarea rows={3} value={strategyDraft.notes ?? ""} onChange={(event) => setStrategyDraft({ ...strategyDraft, notes: event.target.value })} />
                  </FormField>
                </div>
              </FormShell>

              <FormShell
                title="Pillars"
                description="Target share and content roles for each active content lane."
                footer={
                  <Button type="button" variant="secondary" onClick={() => setStrategyDraft({ ...strategyDraft, pillars: [...strategyDraft.pillars, blankPillar(strategyDraft.pillars.length)] })}>
                    <Plus className="h-4 w-4" />
                    Add pillar
                  </Button>
                }
              >
                <div className="space-y-3">
                  {strategyDraft.pillars.map((pillar, index) => (
                    <div key={`${pillar.key}-${index}`} className="grid gap-3 rounded-[1.2rem] border border-border/70 bg-muted/20 p-3 xl:grid-cols-[1fr_1fr_120px_160px_auto]">
                      <FormField label="Key">
                        <Input value={pillar.key} onChange={(event) => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.map((entry, itemIndex) => itemIndex === index ? { ...entry, key: event.target.value } : entry) })} />
                      </FormField>
                      <FormField label="Name">
                        <Input value={pillar.name} onChange={(event) => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.map((entry, itemIndex) => itemIndex === index ? { ...entry, name: event.target.value } : entry) })} />
                      </FormField>
                      <FormField label="Share %">
                        <Input type="number" min={0} max={100} value={pillar.target_share_percent} onChange={(event) => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.map((entry, itemIndex) => itemIndex === index ? { ...entry, target_share_percent: Number(event.target.value) || 0 } : entry) })} />
                      </FormField>
                      <FormField label="Post types">
                        <SelectField value={pillar.supported_post_types.join(",")} onChange={(event) => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.map((entry, itemIndex) => itemIndex === index ? { ...entry, supported_post_types: event.target.value.split(",") as StrategyPillar["supported_post_types"] } : entry) })}>
                          <option value="feed">Feed</option>
                          <option value="feed,story">Feed + Story</option>
                          <option value="story">Story</option>
                        </SelectField>
                      </FormField>
                      <div className="flex items-end justify-end">
                        <Button type="button" variant="ghost" onClick={() => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.filter((_, itemIndex) => itemIndex !== index) })} disabled={strategyDraft.pillars.length === 1}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="xl:col-span-5">
                        <FormField label="Description">
                          <Textarea rows={2} value={pillar.description ?? ""} onChange={(event) => setStrategyDraft({ ...strategyDraft, pillars: strategyDraft.pillars.map((entry, itemIndex) => itemIndex === index ? { ...entry, description: event.target.value } : entry) })} />
                        </FormField>
                      </div>
                    </div>
                  ))}
                </div>
              </FormShell>

              <FormShell
                title="Slot templates"
                description="The repeatable weekly skeleton that powers recommendations and queue pacing."
                footer={
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() =>
                      setStrategyDraft({
                        ...strategyDraft,
                        slot_templates: [...strategyDraft.slot_templates, blankSlot(strategyDraft.slot_templates.length, strategyDraft.pillars[0]?.key)],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    Add slot
                  </Button>
                }
              >
                <div className="space-y-3">
                  {strategyDraft.slot_templates.map((slot, index) => (
                    <div key={`${slot.label}-${index}`} className="grid gap-3 rounded-[1.2rem] border border-border/70 bg-muted/20 p-3 xl:grid-cols-[180px_180px_110px_110px_130px_auto]">
                      <FormField label="Label">
                        <Input value={slot.label} onChange={(event) => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.map((entry, itemIndex) => itemIndex === index ? { ...entry, label: event.target.value } : entry) })} />
                      </FormField>
                      <FormField label="Pillar">
                        <SelectField value={slot.pillar_key ?? ""} onChange={(event) => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.map((entry, itemIndex) => itemIndex === index ? { ...entry, pillar_key: event.target.value || null } : entry) })}>
                          <option value="">No fixed pillar</option>
                          {strategyDraft.pillars.map((pillar) => (
                            <option key={pillar.key} value={pillar.key}>
                              {pillar.name}
                            </option>
                          ))}
                        </SelectField>
                      </FormField>
                      <FormField label="Weekday">
                        <SelectField value={String(slot.weekday)} onChange={(event) => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.map((entry, itemIndex) => itemIndex === index ? { ...entry, weekday: Number(event.target.value) } : entry) })}>
                          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, dayIndex) => (
                            <option key={day} value={dayIndex}>
                              {day}
                            </option>
                          ))}
                        </SelectField>
                      </FormField>
                      <FormField label="Time">
                        <Input value={slot.local_time} onChange={(event) => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.map((entry, itemIndex) => itemIndex === index ? { ...entry, local_time: event.target.value } : entry) })} />
                      </FormField>
                      <FormField label="Post type">
                        <SelectField value={slot.post_type} onChange={(event) => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.map((entry, itemIndex) => itemIndex === index ? { ...entry, post_type: event.target.value as StrategySlotTemplate["post_type"], variant_type: event.target.value === "story" ? "story_9x16" : "feed_4x5" } : entry) })}>
                          <option value="feed">Feed</option>
                          <option value="story">Story</option>
                        </SelectField>
                      </FormField>
                      <div className="flex items-end justify-end">
                        <Button type="button" variant="ghost" onClick={() => setStrategyDraft({ ...strategyDraft, slot_templates: strategyDraft.slot_templates.filter((_, itemIndex) => itemIndex !== index) })}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </FormShell>
            </form>
          ) : null}
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-4">
            <WorkspaceMetric label="Total reach" value={(analyticsQuery.data?.kpis.total_reach ?? 0).toLocaleString()} hint="Profile analytics rollup" />
            <WorkspaceMetric label="Average engagement" value={`${(analyticsQuery.data?.kpis.avg_engagement_rate ?? 0).toFixed(2)}%`} hint={`${analyticsQuery.data?.kpis.total_posts ?? 0} published posts`} />
            <WorkspaceMetric label="On-slot rate" value={`${analyticsStrategyQuery.data?.schedule_adherence.on_slot_percent ?? 0}%`} hint={`${analyticsStrategyQuery.data?.schedule_adherence.avg_publish_delay_minutes ?? 0} min average delay`} />
            <WorkspaceMetric
              label="Top post"
              value={analyticsQuery.data?.kpis.top_post ? `${analyticsQuery.data.kpis.top_post.engagement_rate.toFixed(2)}%` : "No top post"}
              hint={analyticsQuery.data?.kpis.top_post ? analyticsQuery.data.kpis.top_post.publishing_queue_id.slice(0, 8) : "Waiting for more published history"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <FormShell title="Trend" description="Daily engagement history for this profile.">
              <div className="space-y-3">
                {analyticsQuery.data?.trend_data.length ? (
                  analyticsQuery.data.trend_data.map((point) => (
                    <div key={point.date} className="space-y-1">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{point.date}</span>
                        <span>{point.engagement_rate.toFixed(2)}%</span>
                      </div>
                      <Progress value={Math.min(100, point.engagement_rate * 10)} />
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No trend data available yet.</p>
                )}
              </div>
            </FormShell>

            <FormShell title="Best patterns" description="Top strategy-aware combinations for this profile.">
              <div className="space-y-3">
                {analyticsStrategyQuery.data?.best_patterns.length ? (
                  analyticsStrategyQuery.data.best_patterns.map((pattern) => (
                    <div key={pattern.label} className="rounded-[1.2rem] border border-border/70 bg-muted/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-medium">{pattern.label}</p>
                          <p className="text-xs text-muted-foreground">{pattern.published_posts} published posts</p>
                        </div>
                        <Badge tone="success">{pattern.engagement_rate.toFixed(2)}%</Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground">No pattern insights yet.</p>
                )}
              </div>
            </FormShell>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <BreakdownCard
              title="Pillar breakdown"
              description="Which content lanes are carrying reach and engagement."
              items={
                analyticsStrategyQuery.data?.pillar_breakdown.map((pillar) => ({
                  label: humanizePillar(pillar.pillar_key),
                  value: `${pillar.avg_engagement_rate.toFixed(2)}%`,
                  detail: `${pillar.published_posts} published · ${pillar.total_reach.toLocaleString()} reach`,
                })) ?? []
              }
            />
            <BreakdownCard
              title="Daypart breakdown"
              description="Which posting windows are rewarding this profile."
              items={
                analyticsStrategyQuery.data?.daypart_breakdown.map((daypart) => ({
                  label: daypart.daypart,
                  value: `${daypart.avg_engagement_rate.toFixed(2)}%`,
                  detail: `${daypart.published_posts} published posts`,
                })) ?? []
              }
            />
          </div>
        </TabsContent>
      </Tabs>
    </PageScaffold>
  );
}

function WorkspaceMetric({
  label,
  value,
  hint,
  tone = "neutral",
  compact = false,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: SignalTone;
  compact?: boolean;
}) {
  return (
    <div className={cn("rounded-[1.25rem] border border-border/70 bg-background/70 p-4", compact && "p-3")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={cn("mt-2 font-display text-3xl tracking-[-0.05em]", compact && "text-2xl", tone === "danger" && "text-destructive", tone === "success" && "text-primary")}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function HeroSignal({
  icon,
  label,
  value,
  description,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  description: string;
  tone?: SignalTone;
}) {
  return (
    <div className="space-y-2 bg-background/82 p-5">
      <div className={cn("flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground", tone === "danger" && "text-destructive", tone === "warning" && "text-[var(--status-warning)]", tone === "success" && "text-primary")}>
        {icon}
        {label}
      </div>
      <p className="font-display text-[clamp(1.5rem,2.8vw,2.2rem)] tracking-[-0.05em]">{value}</p>
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function SectionCallout({
  tone,
  title,
  description,
  action,
}: {
  tone: SignalTone;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 rounded-[1.4rem] border px-4 py-3",
        tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-950 dark:text-emerald-100",
        tone === "warning" && "border-amber-500/25 bg-amber-500/10 text-amber-950 dark:text-amber-100",
        tone === "danger" && "border-red-500/25 bg-red-500/10 text-red-950 dark:text-red-100",
        tone === "neutral" && "border-border/70 bg-background/65 text-foreground",
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-sm leading-relaxed opacity-85">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function ShieldPill({ tone, label }: { tone: SignalTone; label: string }) {
  return <Badge tone={tone === "neutral" ? "neutral" : tone}>{label}</Badge>;
}

function RecommendationCard({
  item,
  selected,
  working,
  canQueue,
  onLoad,
  onAccept,
  onSkip,
}: {
  item: PostingPlanItem;
  selected: boolean;
  working: boolean;
  canQueue: boolean;
  onLoad: () => void;
  onAccept: () => void;
  onSkip: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.3rem] border border-border/70 bg-muted/20 p-4 transition duration-200",
        selected && "border-[color:color-mix(in_oklab,var(--primary),transparent_32%)] bg-[color:color-mix(in_oklab,var(--accent),transparent_55%)] shadow-[var(--shadow-soft)]",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-medium capitalize">{humanizePillar(item.pillar_key)}</p>
          <p className="text-xs text-muted-foreground">{formatSlot(item.slot_start)} · {item.post_type} / {item.variant_type}</p>
        </div>
        <Badge tone={item.status === "RECOMMENDED" ? "warning" : "success"}>{item.status}</Badge>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.rationale ?? "Strategy-generated slot."}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{item.asset ? `Asset #${item.asset.sequence_number}` : "Waiting for asset attachment"}</span>
        <span>•</span>
        <span>{item.confidence ? `${Math.round(item.confidence * 100)}% confidence` : "No confidence score"}</span>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={onAccept} disabled={working || !canQueue}>
          {working ? "Working…" : "Queue instantly"}
        </Button>
        <Button size="sm" variant="secondary" onClick={onLoad}>
          Load in composer
        </Button>
        <Button size="sm" variant="ghost" onClick={onSkip} disabled={working}>
          Skip
        </Button>
      </div>
    </div>
  );
}

function AssetChoiceCard({
  asset,
  selected,
  onSelect,
}: {
  asset: ApprovedAsset;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "overflow-hidden rounded-[1.3rem] border border-border/70 bg-background/70 text-left transition duration-200 hover:-translate-y-[1px] hover:shadow-[var(--shadow-soft)]",
        selected && "border-[color:color-mix(in_oklab,var(--primary),transparent_24%)] shadow-[var(--shadow-soft)]",
      )}
    >
      <div className="overflow-hidden border-b border-border/60 bg-muted/20">
        {asset.preview_url ? (
          <img src={asset.preview_url} alt={`Asset ${asset.sequence_number}`} className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--accent),transparent_32%),transparent_60%)]">
            <ImageIcon className="h-8 w-8 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{asset.campaign?.name ?? "Campaign"}</p>
          <Badge tone="success">Asset #{asset.sequence_number}</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Approved and free to queue.</p>
      </div>
    </button>
  );
}

function QueueEventCard({ item }: { item: QueueItem }) {
  const previewUrl = item.asset?.preview_url;
  const tone = toneForQueueStatus(item.status);
  const anchor = item.published_at ?? item.scheduled_at;

  return (
    <div className="grid gap-4 rounded-[1.35rem] border border-border/70 bg-muted/20 p-4 md:grid-cols-[92px_1fr_auto] md:items-start">
      <div className="overflow-hidden rounded-[1.15rem] border border-border/70 bg-background/80">
        {previewUrl ? (
          <img src={previewUrl} alt={`Asset ${item.asset?.sequence_number ?? ""}`} className="aspect-[4/5] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/5] items-center justify-center bg-[radial-gradient(circle_at_top,color-mix(in_oklab,var(--accent),transparent_34%),transparent_60%)]">
            <ImageIcon className="h-7 w-7 text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{item.status}</Badge>
          <Badge tone="neutral">{humanizePillar(item.pillar_key)}</Badge>
          <Badge tone="neutral">{item.post_type}</Badge>
        </div>

        <div>
          <p className="font-medium">{item.asset?.campaign?.name ?? "Campaign"} · Asset #{item.asset?.sequence_number ?? "?"}</p>
          <p className="text-xs text-muted-foreground">{formatSlot(item.slot_start ?? item.scheduled_at)} · {item.variant_type}</p>
        </div>

        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{item.caption}</p>
      </div>

      <div className="space-y-1 text-right text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{formatRelativeWindow(anchor)}</p>
        <p>{formatDateLabel(anchor)}</p>
      </div>
    </div>
  );
}

function BreakdownCard({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: Array<{ label: string; value: string; detail: string }>;
}) {
  return (
    <FormShell title={title} description={description}>
      <div className="space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={`${item.label}-${item.value}`} className="rounded-[1.2rem] border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-medium capitalize">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <Badge tone="success">{item.value}</Badge>
              </div>
            </div>
          ))
        ) : (
          <p className="text-sm text-muted-foreground">No breakdown data available yet.</p>
        )}
      </div>
    </FormShell>
  );
}
