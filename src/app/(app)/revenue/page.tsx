"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { FormField } from "@/components/workspace/form-field";
import { FormShell } from "@/components/workspace/form-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type Client = {
	id: string;
	name: string;
};

type RevenueContract = {
	id: string;
	client_id: string;
	contract_type: "RETAINER" | "RETAINER_PLUS_BONUS";
	monthly_retainer_usd: number | string;
	starts_at: string;
	ends_at: string | null;
	client?: Client | null;
};

type RevenueEntry = {
	id: string;
	contract_id: string;
	type: "RETAINER" | "BONUS" | "ADJUSTMENT";
	amount_usd: number | string;
	reference_month: string;
	notes: string | null;
	contract?: {
		id: string;
		client?: Client | null;
	} | null;
};

function numberFrom(value: number | string): number {
	if (typeof value === "number") return value;
	const parsed = Number(value);
	return Number.isNaN(parsed) ? 0 : parsed;
}

export default function RevenuePage() {
	const [clients, setClients] = useState<Client[]>([]);
	const [contracts, setContracts] = useState<RevenueContract[]>([]);
	const [entries, setEntries] = useState<RevenueEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [clientId, setClientId] = useState("");
	const [retainer, setRetainer] = useState("4500");
	const [contractType, setContractType] = useState<"RETAINER" | "RETAINER_PLUS_BONUS">("RETAINER_PLUS_BONUS");
	const [contractStart, setContractStart] = useState(() => new Date().toISOString().slice(0, 10));

	const [entryContractId, setEntryContractId] = useState("");
	const [entryType, setEntryType] = useState<"RETAINER" | "BONUS" | "ADJUSTMENT">("RETAINER");
	const [entryAmount, setEntryAmount] = useState("0");
	const [entryMonth, setEntryMonth] = useState(() => new Date().toISOString().slice(0, 10));

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [clientsData, contractsData, entriesData] = await Promise.all([
				apiRequest<Client[]>("/api/clients"),
				apiRequest<RevenueContract[]>("/api/revenue/contracts"),
				apiRequest<RevenueEntry[]>("/api/revenue/entries")
			]);
			setClients(clientsData ?? []);
			setContracts(contractsData ?? []);
			setEntries(entriesData ?? []);
			setClientId(current => current || clientsData?.[0]?.id || "");
			setEntryContractId(current => current || contractsData?.[0]?.id || "");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load revenue data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function createContract(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await apiRequest("/api/revenue/contracts", {
				method: "POST",
				body: JSON.stringify({
					client_id: clientId,
					contract_type: contractType,
					monthly_retainer_usd: Number(retainer),
					starts_at: new Date(`${contractStart}T00:00:00`).toISOString()
				})
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create contract");
		} finally {
			setSaving(false);
		}
	}

	async function createEntry(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await apiRequest("/api/revenue/entries", {
				method: "POST",
				body: JSON.stringify({
					contract_id: entryContractId,
					type: entryType,
					amount_usd: Number(entryAmount),
					reference_month: new Date(`${entryMonth}T00:00:00`).toISOString()
				})
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create revenue entry");
		} finally {
			setSaving(false);
		}
	}

	const contractColumns: TableShellColumn<RevenueContract>[] = [
		{
			key: "client",
			header: "Client",
			cell: row => <p className="font-medium">{row.client?.name ?? "Client"}</p>
		},
		{
			key: "type",
			header: "Type",
			cell: row => <Badge tone="warning">{row.contract_type}</Badge>
		},
		{
			key: "retainer",
			header: "Monthly Retainer",
			cell: row => <p>${numberFrom(row.monthly_retainer_usd).toLocaleString()}</p>
		},
		{
			key: "starts",
			header: "Starts",
			cell: row => <p>{new Date(row.starts_at).toLocaleDateString()}</p>
		}
	];

	const entryColumns: TableShellColumn<RevenueEntry>[] = [
		{
			key: "client",
			header: "Client",
			cell: row => <p className="font-medium">{row.contract?.client?.name ?? "Client"}</p>
		},
		{
			key: "type",
			header: "Entry Type",
			cell: row => <Badge tone={row.type === "BONUS" ? "success" : row.type === "ADJUSTMENT" ? "warning" : "neutral"}>{row.type}</Badge>
		},
		{
			key: "amount",
			header: "Amount",
			cell: row => <p>${numberFrom(row.amount_usd).toLocaleString()}</p>
		},
		{
			key: "month",
			header: "Reference Month",
			cell: row => <p>{new Date(row.reference_month).toLocaleDateString()}</p>
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader
				title="Revenue"
				description="Manage contracts and revenue entries."
				action={
					<Button asChild variant="secondary">
						<a href="/api/reports/export">Export CSV</a>
					</Button>
				}
			/>

			{loading ? <StateBlock title="Loading revenue data..." /> : null}
			{error ? <StateBlock tone="danger" title="Revenue operation failed" description={error} /> : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<FormShell title="Create Contract" description="Add a contract for a client.">
					<form className="space-y-3" onSubmit={createContract}>
						<FormField label="Client">
							<SelectField value={clientId} onChange={event => setClientId(event.target.value)} required>
								<option value="" disabled>
									Select client
								</option>
								{clients.map(client => (
									<option key={client.id} value={client.id}>
										{client.name}
									</option>
								))}
							</SelectField>
						</FormField>
						<FormField label="Contract Type">
							<SelectField value={contractType} onChange={event => setContractType(event.target.value as "RETAINER" | "RETAINER_PLUS_BONUS")}>
								<option value="RETAINER_PLUS_BONUS">Retainer + Bonus</option>
								<option value="RETAINER">Retainer Only</option>
							</SelectField>
						</FormField>
						<div className="grid gap-3 md:grid-cols-2">
							<FormField label="Monthly Retainer (USD)">
								<Input type="number" value={retainer} onChange={event => setRetainer(event.target.value)} min={0} step="0.01" required />
							</FormField>
							<FormField label="Starts At">
								<Input type="date" value={contractStart} onChange={event => setContractStart(event.target.value)} required />
							</FormField>
						</div>
						<Button type="submit" disabled={saving || !clientId}>
							{saving ? "Saving..." : "Create Contract"}
						</Button>
					</form>
				</FormShell>

				<FormShell title="Create Revenue Entry" description="Record a retainer, bonus, or adjustment.">
					<form className="space-y-3" onSubmit={createEntry}>
						<FormField label="Contract">
							<SelectField value={entryContractId} onChange={event => setEntryContractId(event.target.value)} required>
								<option value="" disabled>
									Select contract
								</option>
								{contracts.map(contract => (
									<option key={contract.id} value={contract.id}>
										{contract.client?.name ?? "Client"} · {contract.contract_type}
									</option>
								))}
							</SelectField>
						</FormField>
						<div className="grid gap-3 md:grid-cols-3">
							<FormField label="Type">
								<SelectField value={entryType} onChange={event => setEntryType(event.target.value as "RETAINER" | "BONUS" | "ADJUSTMENT")}>
									<option value="RETAINER">Retainer</option>
									<option value="BONUS">Bonus</option>
									<option value="ADJUSTMENT">Adjustment</option>
								</SelectField>
							</FormField>
							<FormField label="Amount (USD)">
								<Input type="number" value={entryAmount} onChange={event => setEntryAmount(event.target.value)} step="0.01" required />
							</FormField>
							<FormField label="Reference Month">
								<Input type="date" value={entryMonth} onChange={event => setEntryMonth(event.target.value)} required />
							</FormField>
						</div>
						<Button type="submit" disabled={saving || !entryContractId}>
							{saving ? "Saving..." : "Create Entry"}
						</Button>
					</form>
				</FormShell>
			</div>

			<TableShell
				title="Contracts"
				description="Current contracts."
				rows={contracts}
				columns={contractColumns}
				rowKey={row => row.id}
				emptyMessage="No contracts configured."
				actions={
					<Button variant="ghost" onClick={() => void load()} disabled={loading}>
						Refresh
					</Button>
				}
			/>

			<TableShell title="Recent Entries" description="Latest entries by client." rows={entries} columns={entryColumns} rowKey={row => row.id} emptyMessage="No entries yet." />
		</div>
	);
}

