"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type ClientDashboardPayload = {
	clients: Array<{
		id: string;
		name: string;
		assignments: Array<{
			model?: {
				id: string;
				name: string;
			} | null;
		}>;
		revenue_contracts: Array<{
			id: string;
			monthly_retainer_usd?: string | number;
			entries?: Array<{
				id: string;
				amount_usd?: string | number;
			}>;
		}>;
	}>;
};

export default function ClientDashboardPage() {
	const [data, setData] = useState<ClientDashboardPayload | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const payload = await apiRequest<ClientDashboardPayload>("/api/client/dashboard");
			setData(payload);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load client dashboard");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: TableShellColumn<ClientDashboardPayload["clients"][number]>[] = [
		{
			key: "client",
			header: "Client",
			cell: client => <p className="font-medium">{client.name}</p>
		},
		{
			key: "assignments",
			header: "Assigned Models",
			cell: client =>
				client.assignments.length ? (
					<div className="flex flex-wrap gap-1">
						{client.assignments.map((assignment, index) => (
							<Badge key={`${assignment.model?.id ?? index}`} tone="neutral">
								{assignment.model?.name ?? "Unlinked model"}
							</Badge>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">No model assignments.</p>
				)
		},
		{
			key: "contracts",
			header: "Contracts",
			cell: client => <p className="text-sm">{client.revenue_contracts.length} active contracts</p>
		}
	];

	return (
		<PageScaffold>
			<PageHeader
				title="Client Dashboard"
				description="Assigned models and active contracts."
				action={
					<Button variant="ghost" onClick={() => void load()} disabled={loading}>
						Refresh
					</Button>
				}
			/>

			{loading ? <StateBlock title="Loading client view..." /> : null}
			{error ? <StateBlock tone="error" title="Client dashboard failed" description={error} /> : null}

			<TableShell
				title="Client Portfolio"
				description="Assignments and contracts."
				rows={data?.clients ?? []}
				columns={columns}
				rowKey={row => row.id}
				emptyMessage="No client data available yet."
			/>
		</PageScaffold>
	);
}
