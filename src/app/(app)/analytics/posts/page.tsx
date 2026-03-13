"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { FilterShell } from "@/components/workspace/filter-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type PostMetric = {
	id?: string;
	publishing_queue_id: string;
	ig_media_id: string;
	impressions?: number;
	reach: number;
	engagement_rate: number;
	likes_count?: number;
	comments_count?: number;
	saves_count?: number;
	shares_count?: number;
	fetched_at: string;
	profile_handle?: string;
	pillar_key?: string;
	post_type?: "feed" | "story" | "reel";
	scheduled_at?: string;
	published_at?: string;
	queue?: {
		asset?: {
			campaign?: {
				id: string;
				name: string;
				model_id?: string;
			} | null;
		} | null;
	} | null;
};

type PostMetricsResponse = {
	data: PostMetric[];
	pagination: {
		page: number;
		limit: number;
		total: number;
	};
};

function toDateInput(date: Date): string {
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
	return local.toISOString().slice(0, 10);
}

export default function AnalyticsPostsPage() {
	const [sortBy, setSortBy] = useState<"engagement_rate" | "reach" | "fetched_at">("engagement_rate");
	const [startDate, setStartDate] = useState(() => toDateInput(new Date(Date.now() - 1000 * 60 * 60 * 24 * 30)));
	const [endDate, setEndDate] = useState(() => toDateInput(new Date()));

	const query = useQuery({
		queryKey: ["analytics-posts", sortBy, startDate, endDate],
		queryFn: () => {
			const params = new URLSearchParams({
				page: "1",
				limit: "50",
				sort_by: sortBy
			});
			if (startDate) params.set("start_date", new Date(`${startDate}T00:00:00`).toISOString());
			if (endDate) params.set("end_date", new Date(`${endDate}T23:59:59`).toISOString());
			return apiRequest<PostMetricsResponse>(`/api/analytics/posts?${params.toString()}`);
		}
	});

	const rows = query.data?.data ?? [];

	const columns: TableShellColumn<PostMetric>[] = [
		{
			key: "campaign",
			header: "Campaign",
			cell: row => (
				<div>
					<p className="font-medium">{row.queue?.asset?.campaign?.name ?? "Campaign"}</p>
					<p className="text-xs text-muted-foreground">{new Date(row.fetched_at).toLocaleString()}</p>
				</div>
			)
		},
		{
			key: "profile",
			header: "Profile / Pillar",
			cell: row => (
				<div>
					<p className="font-medium">{row.profile_handle ?? "Profile"}</p>
					<p className="text-xs text-muted-foreground">{row.pillar_key ? row.pillar_key.replaceAll("_", " ") : "Uncategorized"}</p>
				</div>
			)
		},
		{
			key: "media",
			header: "Media",
			cell: row => (
				<div>
					<p className="text-xs">{row.ig_media_id}</p>
					<p className="text-xs text-muted-foreground">{row.post_type ?? "feed"}</p>
				</div>
			)
		},
		{
			key: "reach",
			header: "Reach",
			cell: row => (
				<div>
					<Badge tone="success">{row.reach.toLocaleString()}</Badge>
					<p className="mt-1 text-xs text-muted-foreground">{(row.impressions ?? 0).toLocaleString()} impressions</p>
				</div>
			)
		},
		{
			key: "engagement",
			header: "Engagement",
			cell: row => (
				<div>
					<Badge tone={row.engagement_rate >= 4 ? "success" : "warning"}>{row.engagement_rate.toFixed(2)}%</Badge>
					<p className="mt-1 text-xs text-muted-foreground">
						{row.likes_count ?? 0} likes · {row.comments_count ?? 0} comments · {row.saves_count ?? 0} saves
					</p>
				</div>
			)
		},
		{
			key: "timing",
			header: "Timing",
			cell: row => (
				<div>
					<p className="text-sm">{row.scheduled_at ? new Date(row.scheduled_at).toLocaleString() : "No schedule"}</p>
					<p className="text-xs text-muted-foreground">{row.published_at ? `Published ${new Date(row.published_at).toLocaleString()}` : "Not published timestamped"}</p>
				</div>
			)
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title="Post Analytics"
				description="Latest synced reach and engagement for each published post."
				action={
					<Button asChild variant="secondary">
						<Link href="/analytics">Back To Dashboard</Link>
					</Button>
				}
			/>

			<FilterShell className="grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
				<Input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
				<Input type="date" value={endDate} onChange={event => setEndDate(event.target.value)} />
				<SelectField value={sortBy} onChange={event => setSortBy(event.target.value as "engagement_rate" | "reach" | "fetched_at")}>
					<option value="engagement_rate">Sort: Engagement Rate</option>
					<option value="reach">Sort: Reach</option>
					<option value="fetched_at">Sort: Latest Sync</option>
				</SelectField>
				<Button onClick={() => void query.refetch()} disabled={query.isFetching}>
					{query.isFetching ? "Loading..." : "Apply"}
				</Button>
			</FilterShell>

			{query.isLoading ? <StateBlock title="Loading post analytics..." /> : null}
			{query.error instanceof Error ? <StateBlock tone="error" title="Couldn't load post analytics" description={query.error.message} /> : null}

			<TableShell
				title="Post Metrics"
				description="One row per post, using the most recent synced metrics."
				rows={rows}
				columns={columns}
				rowKey={row => row.id ?? row.publishing_queue_id}
				emptyMessage="No post analytics data for the selected filters."
			/>
		</div>
	);
}

