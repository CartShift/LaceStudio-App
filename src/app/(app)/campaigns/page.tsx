"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { FilterShell } from "@/components/workspace/filter-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";
import { humanizeStatusLabel, toneForCampaignStatus } from "@/lib/status-labels";

type CampaignStatus = "DRAFT" | "GENERATING" | "REVIEW" | "APPROVED" | "REJECTED" | "SCHEDULED" | "PUBLISHED" | "FAILED";

type Campaign = {
	id: string;
	name: string;
	status: CampaignStatus;
	model?: { id: string; name: string } | null;
};

type ModelOption = {
	id: string;
	name: string;
};

export default function CampaignsPage() {
	const [status, setStatus] = useState<CampaignStatus | "ALL">("ALL");
	const [modelId, setModelId] = useState<string>("ALL");
	const [search, setSearch] = useState("");

	const modelsQuery = useQuery({
		queryKey: ["campaign-model-options"],
		queryFn: () => apiRequest<{ data: ModelOption[] }>("/api/models?limit=100")
	});

	const campaignsQuery = useQuery({
		queryKey: ["campaigns", status, modelId],
		queryFn: () => {
			const params = new URLSearchParams();
			if (status !== "ALL") params.set("status", status);
			if (modelId !== "ALL") params.set("model_id", modelId);
			return apiRequest<{ data: Campaign[] }>(`/api/campaigns${params.toString() ? `?${params.toString()}` : ""}`);
		}
	});

	const filteredItems = useMemo(() => {
		const items = campaignsQuery.data?.data ?? [];
		const needle = search.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(item => item.name.toLowerCase().includes(needle) || item.model?.name?.toLowerCase().includes(needle));
	}, [campaignsQuery.data?.data, search]);

	const columns: TableShellColumn<Campaign>[] = [
		{
			key: "name",
			header: "Campaign",
			cell: item => <p className="font-medium">{item.name}</p>
		},
		{
			key: "model",
			header: "Model",
			cell: item => <p className="text-sm text-muted-foreground">{item.model?.name ?? "Unknown"}</p>
		},
		{
			key: "status",
			header: "Status",
			cell: item => <Badge tone={toneForCampaignStatus(item.status)}>{humanizeStatusLabel(item.status)}</Badge>
		},
		{
			key: "actions",
			header: "Actions",
			className: "w-[220px]",
			cell: item => (
				<div className="flex flex-wrap gap-2">
					<Button asChild size="sm" variant="secondary">
						<Link href={`/campaigns/${item.id}`}>Open</Link>
					</Button>
					{item.status === "REVIEW" ? (
						<Button asChild size="sm" variant="ghost">
							<Link href={`/campaigns/${item.id}/review`}>Review</Link>
						</Button>
					) : null}
				</div>
			)
		}
	];

	return (
		<PageScaffold>
			<PageHeader
				title="Campaigns"
				description="Track campaigns from draft to publishing."
				action={
					<Button asChild>
						<Link href="/campaigns/new">Create Campaign</Link>
					</Button>
				}
			/>

			<FilterShell className="grid gap-3 md:grid-cols-4">
				<SelectField value={status} onChange={event => setStatus(event.target.value as CampaignStatus | "ALL")}>
					<option value="ALL">All statuses</option>
					<option value="DRAFT">Draft</option>
					<option value="GENERATING">Generating</option>
					<option value="REVIEW">Review</option>
					<option value="APPROVED">Approved</option>
					<option value="REJECTED">Rejected</option>
					<option value="SCHEDULED">Scheduled</option>
					<option value="PUBLISHED">Published</option>
					<option value="FAILED">Failed</option>
				</SelectField>

				<SelectField value={modelId} onChange={event => setModelId(event.target.value)}>
					<option value="ALL">All models</option>
					{(modelsQuery.data?.data ?? []).map(model => (
						<option key={model.id} value={model.id}>
							{model.name}
						</option>
					))}
				</SelectField>

				<Input placeholder="Search campaign or model…" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" />

				<Button variant="ghost" onClick={() => void campaignsQuery.refetch()} disabled={campaignsQuery.isFetching} aria-label="Refresh campaigns">
					<RefreshCw className={`h-4 w-4 ${campaignsQuery.isFetching ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</FilterShell>

			{campaignsQuery.isLoading ? <StateBlock title="Loading campaigns…" /> : null}
			{campaignsQuery.error instanceof Error ? <StateBlock tone="error" title="Couldn't load campaigns" description={campaignsQuery.error.message} /> : null}
			<TableShell
				title="Campaign Queue"
				description="Campaign status across production."
				rows={filteredItems}
				columns={columns}
				rowKey={row => row.id}
				emptyMessage="No campaigns found for current filters."
			/>
		</PageScaffold>
	);
}

