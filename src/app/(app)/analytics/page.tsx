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
		total_reach: number;
		avg_engagement_rate: number;
		total_posts: number;
		top_post: {
			id?: string;
			publishing_queue_id?: string;
			engagement_rate: number;
		} | null;
	};
	model_breakdown: Array<{
		model_id: string;
		reach: number;
		engagement_rate: number;
		post_count: number;
	}>;
	trend_data: Array<{
		date: string;
		engagement_rate: number;
	}>;
};

type StrategyPayload = {
	pillar_breakdown: Array<{
		pillar_key: string;
		total_reach: number;
		avg_engagement_rate: number;
		published_posts: number;
	}>;
	daypart_breakdown: Array<{
		daypart: string;
		avg_engagement_rate: number;
		published_posts: number;
	}>;
	schedule_adherence: {
		on_slot_percent: number;
		avg_publish_delay_minutes: number;
	};
	best_patterns: Array<{
		label: string;
		engagement_rate: number;
		published_posts: number;
	}>;
};

function toDateInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
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
	const maxTrendRate = useMemo(() => {
		const series = data?.trend_data ?? [];
		return Math.max(1, ...series.map(row => row.engagement_rate));
	}, [data?.trend_data]);

	const modelColumns: TableShellColumn<AnalyticsPayload["model_breakdown"][number]>[] = [
		{
			key: "model",
			header: "Model",
			cell: row => <p className="font-medium">{modelNames.get(row.model_id) ?? `Model ${row.model_id.slice(0, 8)}`}</p>
		},
		{
			key: "reach",
			header: "Reach",
			cell: row => <p>{row.reach.toLocaleString()}</p>
		},
		{
			key: "engagement",
			header: "Engagement",
			cell: row => <p>{row.engagement_rate.toFixed(2)}%</p>
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
				description="Latest post performance with daily engagement history."
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
					<h2 className="font-display text-xl font-semibold">Daily Engagement Trend</h2>
					<div className="mt-4 space-y-3">
						{data?.trend_data.length ? (
							data.trend_data.map(point => (
								<div key={point.date} className="space-y-1">
									<div className="flex items-center justify-between text-xs text-muted-foreground">
										<span>{point.date}</span>
										<span>{point.engagement_rate.toFixed(2)}%</span>
									</div>
									<div className="h-2 rounded-full bg-muted">
										<div className="h-2 rounded-full bg-primary" style={{ width: `${Math.max(6, (point.engagement_rate / maxTrendRate) * 100)}%` }} />
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
					description="Reach and engagement by model."
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
											<p className="text-xs text-muted-foreground">{pattern.published_posts} published posts</p>
										</div>
										<Badge tone="success">{pattern.engagement_rate.toFixed(2)}%</Badge>
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
							cell: row => <p className="font-medium">{row.pillar_key.replaceAll("_", " ")}</p>
						},
						{
							key: "reach",
							header: "Reach",
							cell: row => <p>{row.total_reach.toLocaleString()}</p>
						},
						{
							key: "engagement",
							header: "Engagement",
							cell: row => <p>{row.avg_engagement_rate.toFixed(2)}%</p>
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
		</PageScaffold>
	);
}
