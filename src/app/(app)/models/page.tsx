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
import { humanizeStatusLabel, toneForModelStatus } from "@/lib/status-labels";

type ModelListItem = {
	id: string;
	name: string;
	status: "DRAFT" | "ACTIVE" | "ARCHIVED";
	description: string | null;
};

type ModelStatusFilter = "ALL" | "DRAFT" | "ACTIVE" | "ARCHIVED";

export default function ModelsPage() {
	const [statusFilter, setStatusFilter] = useState<ModelStatusFilter>("ALL");
	const [search, setSearch] = useState("");

	const query = useQuery({
		queryKey: ["models", statusFilter],
		queryFn: () => apiRequest<{ data: ModelListItem[] }>(`/api/models${statusFilter !== "ALL" ? `?status=${statusFilter}` : ""}`)
	});

	const filteredItems = useMemo(() => {
		const items = query.data?.data ?? [];
		const needle = search.trim().toLowerCase();
		if (!needle) return items;
		return items.filter(item => item.name.toLowerCase().includes(needle) || item.description?.toLowerCase().includes(needle));
	}, [query.data?.data, search]);

	const columns: TableShellColumn<ModelListItem>[] = [
		{
			key: "name",
			header: "Model",
			cell: item => <p className="font-medium">{item.name}</p>
		},
		{
			key: "status",
			header: "Status",
			cell: item => <Badge tone={toneForModelStatus(item.status)}>{humanizeStatusLabel(item.status)}</Badge>
		},
		{
			key: "description",
			header: "Description",
			cell: item => <p className="line-clamp-2 text-sm text-muted-foreground">{item.description ?? "No description"}</p>
		},
		{
			key: "actions",
			header: "Actions",
			className: "w-[140px]",
			cell: item => (
				<Button asChild size="sm" variant="secondary">
					<Link href={`/models/${item.id}`}>Open Model</Link>
				</Button>
			)
		}
	];

	return (
		<PageScaffold>
			<PageHeader
				title="Models"
				description="Create and manage model profiles."
				action={
					<Button asChild>
						<Link href="/models/new">Create Model</Link>
					</Button>
				}
			/>

			<FilterShell className="grid gap-3 md:grid-cols-[220px_1fr_auto]">
				<SelectField value={statusFilter} onChange={event => setStatusFilter(event.target.value as ModelStatusFilter)}>
					<option value="ALL">All statuses</option>
					<option value="ACTIVE">Active</option>
					<option value="DRAFT">Draft</option>
					<option value="ARCHIVED">Archived</option>
				</SelectField>
				<Input placeholder="Search model name or description…" value={search} onChange={event => setSearch(event.target.value)} autoComplete="off" />
				<Button variant="ghost" onClick={() => query.refetch()} disabled={query.isFetching} aria-label="Refresh models">
					<RefreshCw className={`h-4 w-4 ${query.isFetching ? "animate-spin" : ""}`} />
					Refresh
				</Button>
			</FilterShell>

			{query.isLoading ? <StateBlock title="Loading models…" /> : null}
			{query.error instanceof Error ? <StateBlock tone="error" title="Couldn't load models" description={query.error.message} /> : null}

			<TableShell
				title="Model Library"
				description="All model profiles."
				rows={filteredItems}
				columns={columns}
				rowKey={row => row.id}
				emptyMessage="No models found for current filters."
			/>
		</PageScaffold>
	);
}

