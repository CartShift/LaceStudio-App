"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/workspace/form-field";
import { FormShell } from "@/components/workspace/form-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";

type Client = {
	id: string;
	name: string;
	status: string;
	notes: string | null;
	brand_profiles: Array<{
		id: string;
		name: string;
	}>;
	assignments: Array<{
		id: string;
		model_id: string;
	}>;
};

type Brand = {
	id: string;
	client_id: string;
	name: string;
	voice_notes: string | null;
	client?: {
		id: string;
		name: string;
	} | null;
};

export default function ClientsPage() {
	const [clients, setClients] = useState<Client[]>([]);
	const [brands, setBrands] = useState<Brand[]>([]);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const [clientName, setClientName] = useState("");
	const [clientNotes, setClientNotes] = useState("");
	const [brandClientId, setBrandClientId] = useState("");
	const [brandName, setBrandName] = useState("");
	const [brandVoiceNotes, setBrandVoiceNotes] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [clientsData, brandsData] = await Promise.all([apiRequest<Client[]>("/api/clients"), apiRequest<Brand[]>("/api/brands")]);
			setClients(clientsData ?? []);
			setBrands(brandsData ?? []);
			setBrandClientId(current => current || clientsData?.[0]?.id || "");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load client data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	async function createClient(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await apiRequest("/api/clients", {
				method: "POST",
				body: JSON.stringify({
					name: clientName,
					notes: clientNotes || undefined,
					status: "active"
				})
			});
			setClientName("");
			setClientNotes("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create client");
		} finally {
			setSaving(false);
		}
	}

	async function createBrand(event: FormEvent) {
		event.preventDefault();
		setSaving(true);
		setError(null);
		try {
			await apiRequest("/api/brands", {
				method: "POST",
				body: JSON.stringify({
					client_id: brandClientId,
					name: brandName,
					voice_notes: brandVoiceNotes || undefined,
					visual_direction: {
						style: "playful editorial luxe"
					}
				})
			});
			setBrandName("");
			setBrandVoiceNotes("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't create brand");
		} finally {
			setSaving(false);
		}
	}

	const clientColumns: TableShellColumn<Client>[] = [
		{
			key: "client",
			header: "Client",
			cell: row => (
				<div>
					<p className="font-medium">{row.name}</p>
					<p className="text-xs text-muted-foreground">{row.notes ?? "No notes"}</p>
				</div>
			)
		},
		{
			key: "status",
			header: "Status",
			cell: row => <Badge tone={row.status === "active" ? "success" : "warning"}>{row.status}</Badge>
		},
		{
			key: "brands",
			header: "Brands",
			cell: row => <p>{row.brand_profiles.length}</p>
		},
		{
			key: "assignments",
			header: "Model Assignments",
			cell: row => <p>{row.assignments.length}</p>
		}
	];

	const brandColumns: TableShellColumn<Brand>[] = [
		{
			key: "brand",
			header: "Brand",
			cell: row => <p className="font-medium">{row.name}</p>
		},
		{
			key: "client",
			header: "Client",
			cell: row => <p>{row.client?.name ?? "Unknown Client"}</p>
		},
		{
			key: "voice",
			header: "Voice Notes",
			cell: row => <p className="line-clamp-2 text-sm">{row.voice_notes ?? "-"}</p>
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader title="Clients" description="Manage clients and brand profiles." />

			{loading ? <StateBlock title="Loading clients..." /> : null}
			{error ? <StateBlock tone="error" title="Client operation failed" description={error} /> : null}

			<div className="grid gap-4 lg:grid-cols-2">
				<FormShell title="Create Client" description="Add a client account.">
					<form className="space-y-3" onSubmit={createClient}>
						<FormField label="Client Name">
							<Input value={clientName} onChange={event => setClientName(event.target.value)} minLength={2} maxLength={120} required />
						</FormField>
						<FormField label="Notes">
							<Textarea value={clientNotes} onChange={event => setClientNotes(event.target.value)} rows={3} />
						</FormField>
						<Button type="submit" disabled={saving}>
							{saving ? "Saving..." : "Create Client"}
						</Button>
					</form>
				</FormShell>

				<FormShell title="Create Brand Profile" description="Attach a brand profile to a client.">
					<form className="space-y-3" onSubmit={createBrand}>
						<FormField label="Client">
							<SelectField value={brandClientId} onChange={event => setBrandClientId(event.target.value)} required>
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
						<FormField label="Brand Name">
							<Input value={brandName} onChange={event => setBrandName(event.target.value)} minLength={2} maxLength={120} required />
						</FormField>
						<FormField label="Voice Notes">
							<Textarea value={brandVoiceNotes} onChange={event => setBrandVoiceNotes(event.target.value)} rows={3} />
						</FormField>
						<Button type="submit" disabled={saving || !brandClientId}>
							{saving ? "Saving..." : "Create Brand"}
						</Button>
					</form>
				</FormShell>
			</div>

			<TableShell
				title="Clients"
				description="Client accounts."
				rows={clients}
				columns={clientColumns}
				rowKey={row => row.id}
				emptyMessage="No clients available."
				actions={
					<Button variant="ghost" onClick={() => void load()} disabled={loading}>
						Refresh
					</Button>
				}
			/>

			<TableShell title="Brand Profiles" description="Profiles linked to clients." rows={brands} columns={brandColumns} rowKey={row => row.id} emptyMessage="No brands available." />
		</div>
	);
}

