"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, CalendarClock, ChartNoAxesCombined, Clock3, Link2, RefreshCw, Sparkles, Unplug } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Progress } from "@/components/ui/progress";
import { StateBlock } from "@/components/ui/state-block";
import { apiRequest } from "@/lib/client-api";
import { useNotice } from "@/components/providers/notice-provider";
import type { InstagramProfileSummary } from "@/types/domain";

type ProfilesResponse = {
  data: InstagramProfileSummary[];
};

type OAuthStartResponse = {
  authorization_url: string;
};

function toneForConnection(status: InstagramProfileSummary["connection_status"]) {
  if (status === "CONNECTED") return "success";
  if (status === "PENDING") return "warning";
  if (status === "ERROR" || status === "EXPIRED") return "danger";
  return "neutral";
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.round(value))}%`;
}

function formatSlot(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function urgencyScore(profile: InstagramProfileSummary) {
  return (
    (profile.connection_status !== "CONNECTED" ? 40 : 0) +
    profile.health.failed_count * 30 +
    profile.health.pending_approval_count * 12 +
    (profile.health.approved_assets_ready < (profile.strategy?.min_ready_assets ?? 0) ? 14 : 0) +
    (profile.health.stale_analytics ? 8 : 0)
  );
}

export default function PublishPage() {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const { notify } = useNotice();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ["instagram-profiles"],
    queryFn: () => apiRequest<ProfilesResponse>("/api/instagram/profiles"),
  });

  const profiles = profilesQuery.data?.data ?? [];
  const totals = useMemo(() => {
    return profiles.reduce(
      (accumulator, profile) => {
        accumulator.profiles += 1;
        accumulator.scheduled += profile.health.scheduled_count;
        accumulator.pending += profile.health.pending_approval_count;
        accumulator.failed += profile.health.failed_count;
        accumulator.recommendations += profile.health.recommendation_count;
        accumulator.readyAssets += profile.health.approved_assets_ready;
        return accumulator;
      },
      {
        profiles: 0,
        scheduled: 0,
        pending: 0,
        failed: 0,
        recommendations: 0,
        readyAssets: 0,
      },
    );
  }, [profiles]);

  const rankedProfiles = useMemo(
    () => [...profiles].sort((left, right) => urgencyScore(right) - urgencyScore(left) || left.model_name.localeCompare(right.model_name)),
    [profiles],
  );
  const leadProfile = rankedProfiles[0];
  const priorityProfiles = useMemo(
    () => rankedProfiles.filter((profile) => urgencyScore(profile) > 0).slice(0, 3),
    [rankedProfiles],
  );

  async function connectProfile(profileId: string) {
    setConnectingId(profileId);
    try {
      const payload = await apiRequest<OAuthStartResponse>(`/api/instagram/profiles/${profileId}/oauth/start`, {
        method: "POST",
      });
      window.location.href = payload.authorization_url;
    } catch (error) {
      notify({
        tone: "error",
        title: "Connection failed",
        description: error instanceof Error ? error.message : "We couldn't start the Instagram OAuth flow.",
      });
    } finally {
      setConnectingId(null);
    }
  }

  async function disconnectProfile(profileId: string) {
    setDisconnectingId(profileId);
    try {
      await apiRequest(`/api/instagram/profiles/${profileId}/disconnect`, {
        method: "POST",
      });
      await profilesQuery.refetch();
      notify({
        tone: "success",
        title: "Profile disconnected",
        description: "The Instagram account has been detached from this publishing profile.",
      });
    } catch (error) {
      notify({
        tone: "error",
        title: "Disconnect failed",
        description: error instanceof Error ? error.message : "We couldn't disconnect this profile.",
      });
    } finally {
      setDisconnectingId(null);
    }
  }

  return (
    <PageScaffold className="space-y-6">
      <PageHeader
        title="Publishing"
        description="Profile-centric Instagram control tower for cadence, next posts, connection health, and performance."
        action={
          <>
            <Button asChild>
              <Link href={leadProfile ? `/publish/profiles/${leadProfile.id}` : "/publish/approvals"}>Schedule Post</Link>
            </Button>
            <Button asChild variant="secondary">
              <Link href="/publish/approvals">Approval Queue</Link>
            </Button>
          </>
        }
      />

      <EditorialCard className="overflow-hidden rounded-[2rem] border border-border/70 bg-[linear-gradient(135deg,color-mix(in_oklab,var(--background),var(--primary)_7%)_0%,color-mix(in_oklab,var(--background),var(--accent)_6%)_55%,color-mix(in_oklab,var(--background),white_4%)_100%)] p-0">
        <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-5 border-b border-border/60 p-6 lg:border-r lg:border-b-0 lg:p-7">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <Sparkles className="h-4 w-4" />
              Profile-Centric Cockpit
            </div>
            <div className="space-y-3">
              <h2 className="max-w-3xl font-display text-[clamp(2rem,4vw,3.3rem)] font-semibold leading-[0.95] tracking-[-0.06em]">
                Run several model-owned Instagram profiles from one publishing deck.
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                Timezone: {timezone}. Strategy recommendations stay operator-confirmed, but the data model and queue now support profile-specific autopilot later.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <SignalStat label="Profiles" value={String(totals.profiles)} tone="neutral" />
              <SignalStat label="Queued" value={String(totals.scheduled)} tone="success" />
              <SignalStat label="Pending Approval" value={String(totals.pending)} tone="warning" />
              <SignalStat label="Failures" value={String(totals.failed)} tone={totals.failed > 0 ? "danger" : "neutral"} />
            </div>
          </div>
          <div className="grid gap-px bg-border/50 p-px sm:grid-cols-2 lg:grid-cols-1">
            <MiniPanel label="Ready Assets" value={String(totals.readyAssets)} description="Approved assets not already claimed by an active queue item." />
            <MiniPanel label="Next Recommendations" value={String(totals.recommendations)} description="Upcoming operator-confirmed posting opportunities generated from strategy slots." />
          </div>
        </div>
      </EditorialCard>

      {priorityProfiles.length ? (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
          <EditorialCard className="rounded-[1.8rem] border border-border/70 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--background),white_4%),color-mix(in_oklab,var(--accent),transparent_50%))] p-5 md:p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                Needs Operator Attention
              </div>
              <div className="grid gap-3">
                {priorityProfiles.map((profile) => (
                  <div key={profile.id} className="rounded-[1.25rem] border border-border/70 bg-background/75 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={toneForConnection(profile.connection_status)}>{profile.connection_status}</Badge>
                          {profile.health.failed_count > 0 ? <Badge tone="danger">{profile.health.failed_count} failures</Badge> : null}
                          {profile.health.pending_approval_count > 0 ? <Badge tone="warning">{profile.health.pending_approval_count} approvals</Badge> : null}
                        </div>
                        <p className="font-medium">{profile.display_name ?? profile.model_name}</p>
                        <p className="text-sm text-muted-foreground">{profile.health.warnings[0] ?? "Review the queue and connection status for this profile."}</p>
                      </div>
                      <Button asChild size="sm">
                        <Link href={`/publish/profiles/${profile.id}`}>
                          Open workspace
                          <ArrowUpRight className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </EditorialCard>

          <EditorialCard className="rounded-[1.8rem] border border-border/70 bg-[linear-gradient(155deg,color-mix(in_oklab,var(--background),white_4%),color-mix(in_oklab,var(--primary),transparent_92%))] p-5 md:p-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                <Clock3 className="h-4 w-4" />
                Next Focus
              </div>
              {leadProfile ? (
                <>
                  <div>
                    <h3 className="font-display text-[clamp(1.8rem,3.4vw,2.5rem)] tracking-[-0.05em]">{leadProfile.display_name ?? leadProfile.model_name}</h3>
                    <p className="mt-2 text-sm leading-7 text-muted-foreground">
                      {leadProfile.handle ? `@${leadProfile.handle.replace(/^@/, "")}` : "Handle pending"} · {leadProfile.health.recommendation_count} recommendations · {leadProfile.health.approved_assets_ready} ready assets
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <MiniPanel label="Pending Approval" value={String(leadProfile.health.pending_approval_count)} description="Items waiting for a green light." />
                    <MiniPanel label="Queued" value={String(leadProfile.health.scheduled_count)} description="Already lined up in the queue." />
                  </div>
                  <Button asChild>
                    <Link href={`/publish/profiles/${leadProfile.id}`}>
                      Go to profile deck
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No profiles available yet.</p>
              )}
            </div>
          </EditorialCard>
        </div>
      ) : null}

      <div className="flex items-center justify-end">
        <Button variant="ghost" onClick={() => void profilesQuery.refetch()} disabled={profilesQuery.isFetching}>
          <RefreshCw className={`h-4 w-4 ${profilesQuery.isFetching ? "animate-spin" : ""}`} />
          Refresh cockpit
        </Button>
      </div>

      {profilesQuery.isLoading ? <StateBlock title="Loading Instagram publishing cockpit…" /> : null}
      {profilesQuery.error instanceof Error ? (
        <StateBlock tone="error" title="Publishing cockpit failed to load" description={profilesQuery.error.message} />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        {rankedProfiles.map((profile, index) => (
          <EditorialCard
            key={profile.id}
            className={`relative overflow-hidden rounded-[1.85rem] border border-border/70 p-0 ${index % 2 === 0 ? "bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary),transparent_88%),transparent_42%),linear-gradient(180deg,color-mix(in_oklab,var(--background),white_2%),transparent)]" : "bg-[radial-gradient(circle_at_top_right,color-mix(in_oklab,var(--accent),transparent_80%),transparent_38%),linear-gradient(180deg,color-mix(in_oklab,var(--background),white_2%),transparent)]"}`}
          >
            <div className="space-y-5 p-5 md:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneForConnection(profile.connection_status)}>{profile.connection_status}</Badge>
                    <Badge tone="neutral">{profile.publish_enabled ? "Publishing enabled" : "Publishing paused"}</Badge>
                  </div>
                  <div>
                    <h3 className="font-display text-3xl font-semibold tracking-[-0.05em]">{profile.display_name ?? profile.model_name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {profile.handle ? `@${profile.handle.replace(/^@/, "")}` : "Handle not connected yet"} · {profile.model_name}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button asChild size="sm">
                    <Link href={`/publish/profiles/${profile.id}`}>
                      Open workspace
                      <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  </Button>
                  {profile.connection_status === "CONNECTED" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void disconnectProfile(profile.id)}
                      disabled={disconnectingId === profile.id}
                    >
                      <Unplug className="h-4 w-4" />
                      {disconnectingId === profile.id ? "Disconnecting…" : "Disconnect"}
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => void connectProfile(profile.id)} disabled={connectingId === profile.id}>
                      <Link2 className="h-4 w-4" />
                      {connectingId === profile.id ? "Connecting…" : "Connect"}
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MetricTile label="Cadence" value={formatPercent(profile.health.cadence_score)} hint={`${profile.strategy?.weekly_post_target ?? 0} target / week`} />
                <MetricTile label="Ready assets" value={String(profile.health.approved_assets_ready)} hint={`${profile.strategy?.min_ready_assets ?? 0} minimum`} />
                <MetricTile label="Pending approvals" value={String(profile.health.pending_approval_count)} hint={`${profile.health.scheduled_count} already scheduled`} />
                <MetricTile label="Failures" value={String(profile.health.failed_count)} hint={`${profile.health.recommendation_count} next recommendations`} tone={profile.health.failed_count > 0 ? "danger" : "neutral"} />
              </div>

              <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                <div className="space-y-4 rounded-[1.4rem] border border-border/70 bg-background/75 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Health</p>
                      <p className="mt-1 text-sm text-muted-foreground">Cadence, readiness, and sync risk for this profile.</p>
                    </div>
                    <ChartNoAxesCombined className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Cadence against weekly target</span>
                        <span>{formatPercent(profile.health.cadence_score)}</span>
                      </div>
                      <Progress value={profile.health.cadence_score} className="[&_[data-slot='progress-indicator']]:bg-[linear-gradient(90deg,var(--primary),color-mix(in_oklab,var(--primary),white_14%))]" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Asset readiness buffer</span>
                        <span>{profile.health.approved_assets_ready} ready</span>
                      </div>
                      <Progress
                        value={
                          profile.strategy?.min_ready_assets
                            ? Math.min(100, Math.round((profile.health.approved_assets_ready / profile.strategy.min_ready_assets) * 100))
                            : 0
                        }
                        className="[&_[data-slot='progress-indicator']]:bg-[linear-gradient(90deg,var(--accent),color-mix(in_oklab,var(--accent),white_10%))]"
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{profile.graph_user_id_preview ? `Graph user ${profile.graph_user_id_preview}` : "No graph user linked"}</span>
                    <span>•</span>
                    <span>{profile.last_analytics_sync_at ? `Last analytics sync ${new Date(profile.last_analytics_sync_at).toLocaleString()}` : "No analytics sync yet"}</span>
                  </div>
                  {profile.health.warnings.length > 0 ? (
                    <div className="space-y-2 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
                      {profile.health.warnings.map((warning) => (
                        <p key={warning}>{warning}</p>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-900 dark:text-emerald-100">
                      Publishing, strategy, and analytics are currently aligned for this profile.
                    </div>
                  )}
                </div>

                <div className="space-y-4 rounded-[1.4rem] border border-border/70 bg-background/75 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Next posts</p>
                      <p className="mt-1 text-sm text-muted-foreground">The next three recommended slots from the strategy planner.</p>
                    </div>
                    <CalendarClock className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="space-y-3">
                    {profile.next_posts.length > 0 ? (
                      profile.next_posts.map((item) => (
                        <div key={item.id} className="rounded-[1.2rem] border border-border/70 bg-muted/35 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <p className="font-medium">{item.pillar_key?.replaceAll("_", " ") ?? "Open slot"}</p>
                              <p className="text-xs text-muted-foreground">{formatSlot(item.slot_start)} · {item.post_type} / {item.variant_type}</p>
                            </div>
                            <Badge tone={item.status === "RECOMMENDED" ? "warning" : "success"}>{item.status}</Badge>
                          </div>
                          <p className="mt-2 text-sm text-muted-foreground">{item.rationale ?? "Strategy-generated recommendation."}</p>
                          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                            <span>{item.asset ? `Asset #${item.asset.sequence_number}` : "Waiting for asset assignment"}</span>
                            <span>{item.confidence ? `${Math.round(item.confidence * 100)}% confidence` : "Draft confidence"}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="rounded-[1.2rem] border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
                        No recommendations are ready yet. Open the profile workspace to refine the strategy and generate the next queue.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="rounded-[1.4rem] border border-border/70 bg-background/75 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">Last post performance</p>
                {profile.last_post ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <MetricTile label="Published" value={new Date(profile.last_post.published_at).toLocaleDateString()} hint={new Date(profile.last_post.published_at).toLocaleTimeString()} />
                    <MetricTile label="Reach" value={profile.last_post.reach.toLocaleString()} hint={profile.last_post.pillar_key?.replaceAll("_", " ") ?? "Uncategorized"} />
                    <MetricTile label="Engagement" value={`${profile.last_post.engagement_rate.toFixed(2)}%`} hint={`Queue ${profile.last_post.publishing_queue_id.slice(0, 8)}`} />
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-muted-foreground">No published post analytics have been synced for this profile yet.</p>
                )}
              </div>
            </div>
          </EditorialCard>
        ))}
      </div>

      {!profilesQuery.isLoading && profiles.length === 0 ? (
        <StateBlock
          title="No Instagram profiles found"
          description="Create or bootstrap a profile from the models library to begin managing cadence, queue state, and next-post recommendations."
        />
      ) : null}
    </PageScaffold>
  );
}

function SignalStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <div className="rounded-[1.35rem] border border-border/70 bg-background/70 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-2 font-display text-3xl tracking-[-0.05em] ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}

function MiniPanel({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="space-y-2 bg-background/80 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className="font-display text-4xl tracking-[-0.06em]">{value}</p>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div className="rounded-[1.15rem] border border-border/70 bg-muted/25 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={`mt-2 text-2xl font-semibold tracking-[-0.05em] ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
