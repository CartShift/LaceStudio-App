"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type AppUser = {
	id: string;
	email: string;
	role: "admin" | "operator" | "client";
	display_name: string;
	created_at?: string;
};

function roleTone(role: AppUser["role"]): "neutral" | "success" | "warning" {
	if (role === "admin") return "warning";
	if (role === "operator") return "success";
	return "neutral";
}

export default function SettingsUsersPage() {
	const [users, setUsers] = useState<AppUser[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const payload = await apiRequest<{ data: AppUser[] }>("/api/users");
			setUsers(payload.data ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load users");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const columns: TableShellColumn<AppUser>[] = [
		{
			key: "name",
			header: "Name",
			cell: row => (
				<div>
					<p className="font-medium">{row.display_name}</p>
					<p className="text-xs text-muted-foreground">{row.email}</p>
				</div>
			)
		},
		{
			key: "role",
			header: "Role",
			cell: row => <Badge tone={roleTone(row.role)}>{row.role.toUpperCase()}</Badge>
		},
		{
			key: "created",
			header: "Created",
			cell: row => <p className="text-xs text-muted-foreground">{row.created_at ? new Date(row.created_at).toLocaleDateString() : "-"}</p>
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title="Team"
				description="User roles and access."
				action={
					<Button asChild variant="secondary">
						<Link href="/settings">Back To Settings</Link>
					</Button>
				}
			/>

			{loading ? <StateBlock title="Loading users..." /> : null}
			{error ? <StateBlock tone="danger" title="User loading failed" description={error} /> : null}

			<TableShell
				title="Directory"
				description="Current users and roles."
				rows={users}
				columns={columns}
				rowKey={row => row.id}
				emptyMessage="No users found."
				actions={
					<Button variant="ghost" onClick={() => void load()} disabled={loading}>
						Refresh
					</Button>
				}
			/>
		</div>
	);
}
