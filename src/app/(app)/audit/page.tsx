"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { FilterShell } from "@/components/workspace/filter-shell";
import { FormField } from "@/components/workspace/form-field";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type AuditRow = {
	id: string;
	action: string;
	entity_type: string;
	entity_id: string;
	created_at: string;
	actor?: {
		id: string;
		email: string;
		display_name: string;
	} | null;
};

type AuditResponse = {
	data: AuditRow[];
	pagination: {
		page: number;
		limit: number;
		total: number;
	};
};

export default function AuditPage() {
	const [rows, setRows] = useState<AuditRow[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [entityType, setEntityType] = useState("");
	const [actionFilter, setActionFilter] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const params = new URLSearchParams({
				page: "1",
				limit: "60"
			});
			if (entityType) params.set("entity_type", entityType);
			if (actionFilter) params.set("action", actionFilter);

			const payload = await apiRequest<AuditResponse>(`/api/audit?${params.toString()}`);
			setRows(payload.data);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load audit log");
		} finally {
			setLoading(false);
		}
	}, [actionFilter, entityType]);

	useEffect(() => {
		void load();
	}, [load]);

	async function onFilter(event: FormEvent) {
		event.preventDefault();
		await load();
	}

	const columns: TableShellColumn<AuditRow>[] = [
		{
			key: "action",
			header: "Action",
			cell: row => (
				<div>
					<p className="font-medium">{row.action}</p>
					<p className="text-xs text-muted-foreground">{row.entity_type}</p>
				</div>
			)
		},
		{
			key: "entity",
			header: "Entity ID",
			cell: row => <p className="text-xs">{row.entity_id}</p>
		},
		{
			key: "actor",
			header: "Actor",
			cell: row =>
				row.actor ? (
					<p className="text-sm">
						{row.actor.display_name} ({row.actor.email})
					</p>
				) : (
					<p className="text-sm text-muted-foreground">System</p>
				)
		},
		{
			key: "created",
			header: "Created At",
			cell: row => <p className="text-sm">{new Date(row.created_at).toLocaleString()}</p>
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader title="Audit Log" description="History of state-changing actions." />

			<FilterShell>
				<form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={onFilter}>
					<FormField label="Entity Type">
						<Input value={entityType} onChange={event => setEntityType(event.target.value)} placeholder="publishing_queue" />
					</FormField>
					<FormField label="Action">
						<Input value={actionFilter} onChange={event => setActionFilter(event.target.value)} placeholder="settings.update" />
					</FormField>
					<div className="self-end">
						<Button type="submit" disabled={loading}>
							{loading ? "Loading..." : "Apply Filters"}
						</Button>
					</div>
				</form>
			</FilterShell>

			{loading ? <StateBlock title="Loading audit log..." /> : null}
			{error ? <StateBlock tone="error" title="Audit loading failed" description={error} /> : null}

			<TableShell title="Audit Entries" description="Recent audit events." rows={rows} columns={columns} rowKey={row => row.id} emptyMessage="No audit events found." />
		</div>
	);
}
