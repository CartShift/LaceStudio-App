"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { ToggleRow } from "@/components/ui/toggle-row";
import { FormShell } from "@/components/workspace/form-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type Setting = {
	key: string;
	value: unknown;
	updated_at?: string;
};

export default function SettingsPage() {
	const [settings, setSettings] = useState<Setting[]>([]);
	const [requireApproval, setRequireApproval] = useState(true);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const nonEditable = useMemo(() => settings.filter(setting => setting.key !== "require_publishing_approval"), [settings]);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const payload = await apiRequest<{ data: Setting[] }>("/api/settings");
			const list = payload.data ?? [];
			setSettings(list);
			const approval = list.find(item => item.key === "require_publishing_approval");
			setRequireApproval(typeof approval?.value === "boolean" ? approval.value : true);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load settings");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function savePublishingPolicy() {
		setSaving(true);
		setError(null);
		try {
			await apiRequest("/api/settings", {
				method: "PATCH",
				body: JSON.stringify({
					key: "require_publishing_approval",
					value: requireApproval
				})
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't save settings");
		} finally {
			setSaving(false);
		}
	}

	const columns: TableShellColumn<Setting>[] = [
		{
			key: "key",
			header: "Setting Key",
			cell: row => <p className="font-medium">{row.key}</p>
		},
		{
			key: "value",
			header: "Value",
			cell: row => <p className="text-sm">{typeof row.value === "string" ? row.value : JSON.stringify(row.value)}</p>
		},
		{
			key: "updated",
			header: "Updated",
			cell: row => <p className="text-xs text-muted-foreground">{row.updated_at ? new Date(row.updated_at).toLocaleString() : "-"}</p>
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title="Settings"
				description="Publishing policy and runtime configuration."
				action={
					<Button asChild variant="secondary">
						<Link href="/settings/users">Manage Users</Link>
					</Button>
				}
			/>

			{loading ? <StateBlock title="Loading settings…" /> : null}
			{error ? <StateBlock tone="danger" title="Settings error" description={error} /> : null}

			<FormShell title="Publishing Policy" description="Toggle whether every scheduled post must pass admin approval.">
				<div className="space-y-4">
					<ToggleRow
						label="Require Approval Before Scheduling Goes Live"
						description="Recommended for production-safe publishing governance."
						checked={requireApproval}
						onCheckedChange={setRequireApproval}
					/>
					<Button onClick={() => void savePublishingPolicy()} disabled={saving}>
						{saving ? "Saving..." : "Save Policy"}
					</Button>
				</div>
			</FormShell>

			<TableShell
				title="Runtime Values"
				description="Current read-only runtime settings."
				rows={nonEditable}
				columns={columns}
				rowKey={row => row.key}
				emptyMessage="No extra runtime settings configured."
			/>
		</div>
	);
}
