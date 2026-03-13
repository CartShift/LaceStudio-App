"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { FilterShell } from "@/components/workspace/filter-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type AnalyticsPayload = {
	kpis: {
		total_views: number;
		total_reach: number;
		avg_engagement_rate: number;
		avg_share_rate: number;
		avg_save_rate: number;
		total_posts: number;
		top_post: {
			id?: string;
			publishing_queue_id?: string;
			views: number;
			engagement_rate: number;
		} | null;
	};
	model_breakdown: Array<{
		model_id: string;
		views: number;
		reach: number;
		engagement_rate: number;
		share_rate: number;
		save_rate: number;
		post_count: number;
	}>;
	trend_data: Array<{
		date: string;
		views: number;
		engagement_rate: number;
	}>;
};

type StrategyPayload = {
	profile_breakdown: Array<{
		profile_id: string;
		profile_handle: string | null;
		total_views: number;
		total_reach: number;
		avg_engagement_rate: number;
		published_posts: number;
	}>;
	pillar_breakdown: Array<{
		pillar_key: string;
		total_views: number;
		total_reach: number;
		avg_engagement_rate: number;
		share_rate: number;
		save_rate: number;
		published_posts: number;
	}>;
	daypart_breakdown: Array<{
		daypart: string;
		avg_views: number;
		avg_engagement_rate: number;
		share_rate: number;
		save_rate: number;
		published_posts: number;
	}>;
	best_time_windows: Array<{
		label: string;
		avg_views: number;
		share_rate: number;
		published_posts: number;
	}>;
	schedule_adherence: {
		on_slot_percent: number;
		avg_publish_delay_minutes: number;
	};
	best_patterns: Array<{
		label: string;
		views: number;
		engagement_rate: number;
		share_rate: number;
		published_posts: number;
	}>;
	experiment_win_rate: number;
	reel_readiness: {
		ready_variants: number;
		pending_jobs: number;
		scheduled_reels: number;
		published_reels: number;
	};
};

function toDateInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

function formatCompactNumber(value: number): string {
	return new Intl.NumberFormat([], { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
}

function formatPercent(value: number, digits = 2): string {
	return `${value.toFixed(digits)}%`;
}

export default function AnalyticsPage() {
	const [startDate, setStartDate] = useState(() => toDateInput(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)));
	const [endDate, setEndDate] = useState(() => toDateInput(new Date()));

	const query = useQuery({
		queryKey: ["analytics-dashboard", startDate, endDate],
		queryFn: () => {
			const params = new URLSearchParams();
			if (startDate) params.set("start_date", new Date(`${startDate}T00:00:00`).toISOString());
			if (endDate) params.set("end_date", new Date(`${endDate}T23:59:59`).toISOString());

			return apiRequest<AnalyticsPayload>(`/api/analytics/dashboard?${params.toString()}`);
		}
	});
	const strategyQuery = useQuery({
		queryKey: ["analytics-strategy", startDate, endDate],
		queryFn: () => {
			const params = new URLSearchParams();
			if (startDate) params.set("start_date", new Date(`${startDate}T00:00:00`).toISOString());
			if (endDate) params.set("end_date", new Date(`${endDate}T23:59:59`).toISOString());
			return apiRequest<StrategyPayload>(`/api/analytics/strategy?${params.toString()}`);
		}
	});
	const modelsQuery = useQuery({
		queryKey: ["analytics-model-names"],
		queryFn: () => apiRequest<{ data: Array<{ id: string; name: string }> }>("/api/models?limit=200")
	});
	const modelNames = useMemo(() => {
		return new Map((modelsQuery.data?.data ?? []).map(model => [model.id, model.name]));
	}, [modelsQuery.data?.data]);

	const data = query.data;
	const maxTrendViews = useMemo(() => {
		const series = data?.trend_data ?? [];
		return Math.max(1, ...series.map(row => row.views));
	}, [data?.trend_data]);

	const modelColumns: TableShellColumn<AnalyticsPayload["model_breakdown"][number]>[] = [
		{
			key: "model",
			header: "Model",
			cell: row => <p className="font-medium">{modelNames.get(row.model_id) ?? `Model ${row.model_id.slice(0, 8)}`}</p>
		},
		{
			key: "views",
			header: "Views",
			cell: row => <p>{formatCompactNumber(row.views)}</p>
		},
		{
			key: "share_save",
			header: "Share / Save",
			cell: row => <p>{formatPercent(row.share_rate)} / {formatPercent(row.save_rate)}</p>
		},
		{
			key: "posts",
			header: "Posts",
			cell: row => <Badge tone="success">{row.post_count}</Badge>
		}
	];

	return (
		<PageScaffold>
			<PageHeader
				title="Analytics"
				description="Views-first Instagram performance with timing, share/save, and reel readiness signals."
				action={
					<Button asChild variant="secondary">
						<Link href="/analytics/posts">Post-Level View</Link>
					</Button>
				}
			/>

			<FilterShell className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
				<Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
				<Input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
				<Button onClick={() => void query.refetch()} disabled={query.isFetching}>
					{query.isFetching ? "Loading..." : "Apply"}
				</Button>
			</FilterShell>

			{query.isLoading ? <StateBlock title="Loading analytics…" /> : null}
			{query.error instanceof Error ? <StateBlock tone="error" title="Couldn't load analytics" description={query.error.message} /> : null}

			<div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
				<EditorialCard>
					<h2 className="font-display text-xl font-semibold">Daily Views Trend</h2>
					<div className="mt-4 space-y-3">
						{data?.trend_data.length ? (
							data.trend_data.map(point => (
								<div key={point.date} className="space-y-1">
									<div className="flex items-center justify-between text-xs text-muted-foreground">
										<span>{point.date}</span>
										<span>{formatCompactNumber(point.views)} views · {formatPercent(point.engagement_rate)}</span>
									</div>
									<div className="h-2 rounded-full bg-muted">
										<div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (point.views / maxTrendViews) * 100)}%` }} />
									</div>
								</div>
							))
						) : (
							<p className="text-sm text-muted-foreground">No trend data available for this range.</p>
						)}
					</div>
				</EditorialCard>

				<TableShell
					title="Model Breakdown"
					description="Views with share/save quality by model."
					rows={data?.model_breakdown ?? []}
					columns={modelColumns}
					rowKey={row => row.model_id}
					emptyMessage="No model-level data yet."
				/>
			</div>

			<div className="grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
				<EditorialCard>
					<h2 className="font-display text-xl font-semibold">Best Patterns</h2>
					<div className="mt-4 space-y-3">
						{strategyQuery.data?.best_patterns.length ? (
							strategyQuery.data.best_patterns.map(pattern => (
								<div key={pattern.label} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="font-medium">{pattern.label}</p>
											<p className="text-xs text-muted-foreground">{pattern.published_posts} published posts · {formatPercent(pattern.share_rate)} share rate</p>
										</div>
										<Badge tone="success">{formatCompactNumber(pattern.views)} views</Badge>
									</div>
								</div>
							))
						) : (
							<p className="text-sm text-muted-foreground">No pattern data available yet.</p>
						)}
					</div>
				</EditorialCard>

				<TableShell
					title="Pillar Breakdown"
					description={`On-slot publish rate ${strategyQuery.data?.schedule_adherence.on_slot_percent ?? 0}% · average delay ${strategyQuery.data?.schedule_adherence.avg_publish_delay_minutes ?? 0} min`}
					rows={strategyQuery.data?.pillar_breakdown ?? []}
					columns={[
						{
							key: "pillar",
							header: "Pillar",
							cell: row => <p className="font-medium">{row.pillar_key ? row.pillar_key.replaceAll("_", " ") : "Uncategorized"}</p>
						},
						{
							key: "views",
							header: "Views",
							cell: row => <p>{formatCompactNumber(row.total_views)}</p>
						},
						{
							key: "share_save",
							header: "Share / Save",
							cell: row => <p>{formatPercent(row.share_rate)} / {formatPercent(row.save_rate)}</p>
						},
						{
							key: "posts",
							header: "Posts",
							cell: row => <Badge tone="success">{row.published_posts}</Badge>
						}
					]}
					rowKey={row => row.pillar_key}
					emptyMessage="No pillar-level analytics yet."
				/>
			</div>

			<div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
				<EditorialCard>
					<h2 className="font-display text-xl font-semibold">Best Time Windows</h2>
					<div className="mt-4 space-y-3">
						{strategyQuery.data?.best_time_windows.length ? (
							strategyQuery.data.best_time_windows.map(window => (
								<div key={window.label} className="rounded-2xl border border-border/60 bg-muted/20 p-3">
									<div className="flex items-center justify-between gap-3">
										<div>
											<p className="font-medium">{window.label}</p>
											<p className="text-xs text-muted-foreground">{window.published_posts} published posts · {formatPercent(window.share_rate)} share rate</p>
										</div>
										<Badge tone="success">{formatCompactNumber(window.avg_views)} views</Badge>
									</div>
								</div>
							))
						) : (
							<p className="text-sm text-muted-foreground">No best-time data available yet.</p>
						)}
					</div>
				</EditorialCard>

				<EditorialCard>
					<h2 className="font-display text-xl font-semibold">Reel Readiness</h2>
					<div className="mt-4 grid gap-3 sm:grid-cols-2">
						<MetricTile label="Ready variants" value={String(strategyQuery.data?.reel_readiness.ready_variants ?? 0)} hint="Assets ready for reels" />
						<MetricTile label="Pending jobs" value={String(strategyQuery.data?.reel_readiness.pending_jobs ?? 0)} hint="Video jobs processing" />
						<MetricTile label="Scheduled reels" value={String(strategyQuery.data?.reel_readiness.scheduled_reels ?? 0)} hint="Queued reel posts" />
						<MetricTile label="Experiment win rate" value={formatPercent(strategyQuery.data?.experiment_win_rate ?? 0, 0)} hint={`${strategyQuery.data?.reel_readiness.published_reels ?? 0} reels published`} />
					</div>
				</EditorialCard>
			</div>
		</PageScaffold>
	);
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint: string }) {
	return (
		<div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
			<p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
			<p className="mt-2 font-display text-2xl tracking-[-0.04em]">{value}</p>
			<p className="mt-1 text-xs text-muted-foreground">{hint}</p>
		</div>
	);
}
