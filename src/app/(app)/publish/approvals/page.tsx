"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { FilterShell } from "@/components/workspace/filter-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiRequest } from "@/lib/client-api";
import { useNotice } from "@/components/providers/notice-provider";
import { humanizeStatusLabel, toneForPublishingStatus } from "@/lib/status-labels";

type QueueItem = {
	id: string;
	status: "PENDING_APPROVAL" | "SCHEDULED" | "PUBLISHING" | "PUBLISHED" | "RETRY" | "FAILED" | "REJECTED" | "CANCELLED";
	caption: string;
	post_type: "feed" | "story" | "reel";
	variant_type: "feed_1x1" | "feed_4x5" | "story_9x16" | "reel_9x16" | "master";
	scheduled_at: string;
	pillar_key?: string | null;
	rejection_reason?: string | null;
	profile?: {
		id: string;
		handle?: string | null;
		display_name?: string | null;
	} | null;
	asset?: {
		id: string;
		sequence_number: number;
		campaign?: { id: string; name: string } | null;
	} | null;
};

type AuditEntry = {
	id: string;
	action: string;
	entity_id: string;
	created_at: string;
	actor?: {
		id: string;
		email: string;
		display_name: string;
	} | null;
};

type AuditResponse = {
	data: AuditEntry[];
	pagination: {
		page: number;
		limit: number;
		total: number;
	};
};

const EMPTY_QUEUE: QueueItem[] = [];
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[1];
const QUEUE_REFRESH_INTERVAL_MS = 25_000;

type CalendarResponse = {
	data: QueueItem[];
	pagination: {
		page: number;
		limit: number;
		total: number;
	} | null;
};
type QueueItemWithAudit = QueueItem & {
	last_audit_action?: string;
	last_audit_at?: string;
	last_audit_actor?: string;
};
type ActionSource = "bulk" | "single";

export default function PublishingApprovalsPage() {
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<QueueItem["status"] | "ALL">("PENDING_APPROVAL");
	const [page, setPage] = useState(1);
	const [limit, setLimit] = useState<number>(DEFAULT_PAGE_SIZE);
	const [reasons, setReasons] = useState<Record<string, string>>({});
	const [workingIds, setWorkingIds] = useState<Record<string, boolean>>({});
	const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
	const [pendingStatusById, setPendingStatusById] = useState<Record<string, QueueItem["status"]>>({});
	const [pendingRejectionById, setPendingRejectionById] = useState<Record<string, string>>({});
	const [bulkRejectReason, setBulkRejectReason] = useState("");
	const { notify } = useNotice();

	const start = useMemo(() => {
		const date = new Date();
		date.setDate(date.getDate() - 14);
		return date.toISOString();
	}, []);
	const end = useMemo(() => {
		const date = new Date();
		date.setDate(date.getDate() + 60);
		return date.toISOString();
	}, []);

	const queueQuery = useQuery({
		queryKey: ["publishing-approvals", start, end, filter, page, limit],
		queryFn: () => {
			const params = new URLSearchParams({
				start_date: start,
				end_date: end,
				page: String(page),
				limit: String(limit)
			});
			if (filter !== "ALL") {
				params.set("status", filter);
			}
			return apiRequest<QueueItem[] | CalendarResponse>(`/api/publishing/calendar?${params.toString()}`);
		},
		refetchInterval: QUEUE_REFRESH_INTERVAL_MS
	});

	const response = queueQuery.data;
	const responseData = Array.isArray(response)
		? { data: response, pagination: null }
		: response ?? { data: EMPTY_QUEUE, pagination: null };

	const auditQuery = useQuery({
		queryKey: ["publishing-approvals-audit", responseData.data.map((item) => item.id)],
		queryFn: async () => {
			const ids = responseData.data.map((item) => item.id).join(",");
			const params = new URLSearchParams({
				entity_type: "publishing_queue",
				entity_ids: ids,
				page: "1",
				limit: String(Math.max(1, Math.min(200, responseData.data.length)))
			});
			return apiRequest<AuditResponse>(`/api/audit?${params.toString()}`);
		},
		enabled: responseData.data.length > 0,
		refetchInterval: responseData.data.length > 0 ? QUEUE_REFRESH_INTERVAL_MS : false
	});

	const latestAuditByEntity = useMemo(() => {
		const map: Record<string, { action: string; created_at: string; actor?: string }> = {};
		for (const entry of auditQuery.data?.data ?? []) {
			if (map[entry.entity_id]) continue;
			map[entry.entity_id] = {
				action: entry.action,
				created_at: entry.created_at,
				actor: entry.actor ? entry.actor.display_name : "System"
			};
		}
		return map;
	}, [auditQuery.data]);

	const queueWithOverrides = useMemo<QueueItemWithAudit[]>(() => {
		const patched = responseData.data.map((item) => {
			const audit = latestAuditByEntity[item.id];
			return {
				...item,
				status: pendingStatusById[item.id] ?? item.status,
				rejection_reason: pendingRejectionById[item.id] ?? item.rejection_reason,
				last_audit_action: audit?.action,
				last_audit_at: audit?.created_at,
				last_audit_actor: audit?.actor
			};
		});

		if (filter === "ALL") {
			return patched;
		}

		return patched.filter((item) => item.status === filter);
	}, [filter, latestAuditByEntity, pendingRejectionById, pendingStatusById, responseData.data]);

	const queue = queueWithOverrides;
	const pagination = responseData.pagination;
	const totalInRange = pagination?.total ?? queue.length;
	const hasNextPage = pagination ? page < Math.ceil(totalInRange / limit) : false;
	const hasPrevPage = page > 1;
	const queueRefreshing = queueQuery.isFetching || auditQuery.isFetching;
	const visibleFrom = totalInRange > 0 ? (page - 1) * limit + 1 : 0;
	const visibleTo = totalInRange > 0 ? Math.min(page * limit, totalInRange) : 0;
	const pendingOnlyVisibleQueue = queue.filter((item) => item.status === "PENDING_APPROVAL");
	const selectableCount = pendingOnlyVisibleQueue.length;
	const selectedPendingIds = pendingOnlyVisibleQueue.filter((item) => selectedIds[item.id]).map((item) => item.id);
	const selectedCount = selectedPendingIds.length;
	const allPendingSelected = selectableCount > 0 && selectedPendingIds.length === selectableCount;
	const somePendingSelected = selectedCount > 0 && selectedCount < selectableCount;
	const bulkActionDisabled = selectedCount === 0 || selectedPendingIds.some((id) => workingIds[id]);
	const profileBreakdown = useMemo(() => {
		const map = new Map<string, { label: string; count: number }>();
		for (const item of queue) {
			if (item.status !== "PENDING_APPROVAL") continue;
			const key = item.profile?.id ?? "unassigned";
			const label = item.profile?.display_name ?? item.profile?.handle ?? "Unassigned";
			const current = map.get(key) ?? { label, count: 0 };
			current.count += 1;
			map.set(key, current);
		}
		return Array.from(map.values()).sort((left, right) => right.count - left.count);
	}, [queue]);

	function setWorkingForIds(ids: string[], isWorking: boolean) {
		if (ids.length === 0) return;
		setWorkingIds((current) => {
			const next = { ...current };
			for (const id of ids) {
				if (isWorking) {
					next[id] = true;
				} else {
					delete next[id];
				}
			}
			return next;
		});
	}

	function clearPendingForIds(ids: string[]) {
		setPendingStatusById((current) => {
			let changed = false;
			const next = { ...current };
			for (const id of ids) {
				if (next[id]) {
					delete next[id];
					changed = true;
				}
			}
			return changed ? next : current;
		});
		setPendingRejectionById((current) => {
			let changed = false;
			const next = { ...current };
			for (const id of ids) {
				if (next[id]) {
					delete next[id];
					changed = true;
				}
			}
			return changed ? next : current;
		});
	}

	function clearSelectionForIds(ids: string[]) {
		setSelectedIds((current) => {
			const next = { ...current };
			for (const id of ids) {
				delete next[id];
			}
			return next;
		});
	}

	async function refreshQueueActivity() {
		await queueQuery.refetch();
		if (responseData.data.length > 0) {
			await auditQuery.refetch();
		}
	}

	async function executeBulkApprove(ids: string[], source: ActionSource = "bulk") {
		const isSingle = source === "single";
		if (!ids.length) {
			setError("Select at least one item to approve.");
			return;
		}

		setError(null);
		notify({
			tone: "info",
			title: isSingle ? "Approving item" : `${ids.length} item(s) selected`,
			description: isSingle ? "Updating queue status..." : "Submitting approval updates..."
		});
		setWorkingForIds(ids, true);
		setPendingStatusById((current) => {
			const next = { ...current };
			for (const id of ids) {
				next[id] = "SCHEDULED";
			}
			return next;
		});

		const settle = await Promise.allSettled(
			ids.map((id) =>
				apiRequest(`/api/publishing/${id}/approve`, {
					method: "POST"
				})
			)
		);

		const failedIds = ids.filter((id, index) => settle[index]?.status === "rejected");
		setWorkingForIds(ids, false);
		const succeededIds = ids.filter((id) => !failedIds.includes(id));

		if (failedIds.length) {
			clearPendingForIds(failedIds);
			setError(isSingle ? "This item could not be approved. Please retry." : `${failedIds.length} item(s) could not be approved. Please retry.`);
			notify({
				tone: "error",
				title: isSingle ? "Approve failed" : "Bulk approve partially failed",
				description: isSingle ? "The queue item stayed in review." : `${ids.length - failedIds.length} approved, ${failedIds.length} failed.`
			});
		} else {
			notify({
				tone: "success",
				title: isSingle ? "Item approved" : "Items approved",
				description: isSingle ? "The post moved back into the scheduled queue." : `${ids.length} item(s) approved.`
			});
			if (source === "bulk") {
				setBulkRejectReason("");
			}
		}

		await Promise.all([queueQuery.refetch(), auditQuery.refetch()]);
		if (succeededIds.length) {
			clearSelectionForIds(succeededIds);
		}
		for (const id of succeededIds) {
			setReasons((current) => {
				if (!current[id]) return current;
				const next = { ...current };
				delete next[id];
				return next;
			});
		}
		if (succeededIds.length) {
			clearPendingForIds(succeededIds);
		}
	}

	async function executeBulkReject(ids: string[], reason: string, source: ActionSource = "bulk") {
		const isSingle = source === "single";
		const trimmedReason = reason.trim();
		if (!ids.length) {
			setError("Select at least one item to reject.");
			return;
		}
		if (!trimmedReason) {
			setError("Enter a rejection reason before rejecting.");
			return;
		}

		setError(null);
		notify({
			tone: "info",
			title: isSingle ? "Rejecting item" : `${ids.length} item(s) selected`,
			description: isSingle ? "Saving rejection reason and updating queue..." : "Submitting rejection updates..."
		});
		setWorkingForIds(ids, true);
		setPendingStatusById((current) => {
			const next = { ...current };
			for (const id of ids) {
				next[id] = "REJECTED";
			}
			return next;
		});
		setPendingRejectionById((current) => {
			const next = { ...current };
			for (const id of ids) {
				next[id] = trimmedReason;
			}
			return next;
		});

		const settle = await Promise.allSettled(
			ids.map((id) =>
				apiRequest(`/api/publishing/${id}/reject`, {
					method: "POST",
					body: JSON.stringify({ reason: trimmedReason })
				})
			)
		);

		const failedIds = ids.filter((id, index) => settle[index]?.status === "rejected");
		setWorkingForIds(ids, false);
		const succeededIds = ids.filter((id) => !failedIds.includes(id));

		if (failedIds.length) {
			clearPendingForIds(failedIds);
			setError(isSingle ? "This item could not be rejected. Please retry." : `${failedIds.length} item(s) could not be rejected. Please retry.`);
			notify({
				tone: "error",
				title: isSingle ? "Reject failed" : "Bulk reject partially failed",
				description: isSingle ? "The queue item stayed in review." : `${ids.length - failedIds.length} rejected, ${failedIds.length} failed.`
			});
		} else {
			notify({
				tone: "warning",
				title: isSingle ? "Item rejected" : "Items rejected",
				description: isSingle ? "The rejection reason is now saved on the queue item." : `${ids.length} item(s) rejected.`
			});
			if (source === "bulk") {
				setBulkRejectReason("");
			}
		}

		await Promise.all([queueQuery.refetch(), auditQuery.refetch()]);
		if (succeededIds.length) {
			clearSelectionForIds(succeededIds);
		}
		for (const id of succeededIds) {
			setReasons((current) => {
				if (!current[id]) return current;
				const next = { ...current };
				delete next[id];
				return next;
			});
		}
		if (succeededIds.length) {
			clearPendingForIds(succeededIds);
		}
	}

	function toggleSelectAllPending(selected: boolean) {
		setSelectedIds((current) => {
			const next = { ...current };
			for (const row of pendingOnlyVisibleQueue) {
				if (selected) {
					next[row.id] = true;
				} else {
					delete next[row.id];
				}
			}
			return next;
		});
	}

	function setSelected(id: string, selected: boolean) {
		setSelectedIds((current) => {
			const next = { ...current };
			if (selected) {
				next[id] = true;
			} else {
				delete next[id];
			}
			return next;
		});
	}

	async function approveItem(id: string) {
		await executeBulkApprove([id], "single");
	}

	async function rejectItem(id: string) {
		const reason = reasons[id]?.trim();
		if (!reason) {
			setError("Add a rejection reason before rejecting.");
			return;
		}
		await executeBulkReject([id], reason, "single");
	}

	const columns: TableShellColumn<QueueItemWithAudit>[] = [
		{
			key: "selection",
			header: (
				<Checkbox
					checked={allPendingSelected ? true : somePendingSelected ? "indeterminate" : false}
					onCheckedChange={(checked) => {
						toggleSelectAllPending(Boolean(checked));
					}}
				/>
			),
			cell: item => (
				<Checkbox
					checked={Boolean(selectedIds[item.id])}
					disabled={item.status !== "PENDING_APPROVAL" || Boolean(workingIds[item.id])}
					onCheckedChange={(checked) => setSelected(item.id, Boolean(checked))}
				/>
			)
		},
		{
			key: "profile",
			header: "Profile",
			cell: item => (
				<div>
					<p className="font-medium">{item.profile?.display_name ?? item.profile?.handle ?? "Unassigned"}</p>
					<p className="text-xs text-muted-foreground">{item.pillar_key ? item.pillar_key.replaceAll("_", " ") : "No pillar"}</p>
				</div>
			)
		},
		{
			key: "campaign",
			header: "Campaign",
			cell: item => (
				<div>
					<p className="font-medium">{item.asset?.campaign?.name ?? "Campaign"}</p>
					<p className="text-xs text-muted-foreground">Asset #{item.asset?.sequence_number ?? "?"}</p>
				</div>
			)
		},
		{
			key: "slot",
			header: "Slot",
			cell: item => (
				<div>
					<p className="text-sm">
						{item.post_type} / {item.variant_type}
					</p>
					<p className="text-xs text-muted-foreground">{new Date(item.scheduled_at).toLocaleString()}</p>
				</div>
			)
		},
		{
			key: "status",
			header: "Status",
			cell: item => <Badge tone={toneForPublishingStatus(item.status)}>{humanizeStatusLabel(item.status)}</Badge>
		},
		{
			key: "caption",
			header: "Caption",
			cell: item => (
				<div>
					<p className="line-clamp-2 text-sm">{item.caption}</p>
					{item.rejection_reason ? <p className="mt-1 text-xs text-destructive">{item.rejection_reason}</p> : null}
				</div>
			)
		},
		{
			key: "actions",
			header: "Decision",
			cell: item =>
				item.status === "PENDING_APPROVAL" ? (
					<div className="space-y-2">
						<Input
							value={reasons[item.id] ?? ""}
							onChange={event =>
								setReasons(current => ({
									...current,
									[item.id]: event.target.value
								}))
							}
							placeholder="Reason for rejection"
							disabled={workingIds[item.id]}
						/>
						<div className="flex gap-2">
							<Button size="sm" onClick={() => void approveItem(item.id)} disabled={workingIds[item.id]}>
								{workingIds[item.id] ? "Saving..." : "Approve"}
							</Button>
							<Button size="sm" variant="danger" onClick={() => void rejectItem(item.id)} disabled={workingIds[item.id] || !(reasons[item.id]?.trim())}>
								{workingIds[item.id] ? "Saving..." : "Reject"}
							</Button>
						</div>
					</div>
				) : (
					<p className="text-xs text-muted-foreground">No action available</p>
				)
		},
		{
			key: "latest_activity",
			header: "Latest Activity",
			cell: item => {
				if (!item.last_audit_action) {
					return <p className="text-xs text-muted-foreground">No audit yet</p>;
				}
				return (
					<div>
						<p className="text-sm">{item.last_audit_action}</p>
						<p className="text-xs text-muted-foreground">
							{item.last_audit_at ? new Date(item.last_audit_at).toLocaleString() : "No timestamp"} · {item.last_audit_actor}
						</p>
					</div>
				);
			}
		}
	];

	return (
		<div className="space-y-4">
			<PageHeader title="Approval Queue" description="Approve or reject posts waiting for review." />

			<FilterShell className="grid gap-3 md:grid-cols-[220px_180px_180px_1fr_auto] md:items-center">
				<div className="space-y-1">
					<p className="text-xs text-muted-foreground">Status</p>
					<SelectField
						value={filter}
						onChange={event => {
							setFilter(event.target.value as QueueItem["status"] | "ALL");
							setPage(1);
							setSelectedIds({});
							setPendingStatusById({});
							setPendingRejectionById({});
							setWorkingIds({});
						}}
					>
						<option value="ALL">All Statuses</option>
						<option value="PENDING_APPROVAL">Pending Approval</option>
						<option value="SCHEDULED">Scheduled</option>
						<option value="PUBLISHED">Published</option>
						<option value="FAILED">Failed</option>
						<option value="REJECTED">Rejected</option>
						<option value="CANCELLED">Cancelled</option>
					</SelectField>
				</div>
				<div className="space-y-1">
					<p className="text-xs text-muted-foreground">Rows per page</p>
					<SelectField
						value={String(limit)}
						onChange={event => {
							setLimit(Number(event.target.value));
							setPage(1);
							setSelectedIds({});
							setWorkingIds({});
							setPendingStatusById({});
						}}
					>
						{PAGE_SIZE_OPTIONS.map(size => (
							<option key={size} value={size}>
								{size}
							</option>
						))}
					</SelectField>
				</div>
				<div className="space-y-1">
					<p className="text-xs text-muted-foreground">
						Page {totalInRange === 0 ? 0 : page} of {totalInRange === 0 ? 0 : Math.max(1, Math.ceil(totalInRange / limit))}
					</p>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setPage(page - 1);
								setSelectedIds({});
								setPendingStatusById({});
								setPendingRejectionById({});
								setWorkingIds({});
							}}
							disabled={!hasPrevPage || queueQuery.isFetching}
						>
							<ChevronLeft className="h-4 w-4" />
							Prev
						</Button>
						<Button
							size="sm"
							variant="ghost"
							onClick={() => {
								setPage(page + 1);
								setSelectedIds({});
								setPendingStatusById({});
								setPendingRejectionById({});
								setWorkingIds({});
							}}
							disabled={!hasNextPage || queueQuery.isFetching}
						>
							Next
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
				<div className="space-y-1 text-right">
					<p className="text-xs text-muted-foreground">Showing</p>
					<p className="text-sm text-right">
						{visibleFrom}-{visibleTo} of {totalInRange}
					</p>
					<div className="flex justify-end">
						<Button variant="ghost" onClick={() => void refreshQueueActivity()} disabled={queueRefreshing}>
							Refresh
						</Button>
					</div>
				</div>
			</FilterShell>

			{queueQuery.isLoading ? <StateBlock title="Loading approval queue..." /> : null}
			{queueQuery.error instanceof Error ? <StateBlock tone="error" title="Couldn't load the queue" description={queueQuery.error.message} /> : null}
			{error ? <StateBlock tone="error" title="Action failed" description={error} /> : null}

			<div className="rounded-lg border border-border bg-card p-3">
				<div className="flex flex-wrap items-end gap-3">
					<div className="grow">
						<p className="text-sm">Selected {selectedCount} pending item(s)</p>
						<p className="text-xs text-muted-foreground">Approve or reject all selected items in one action.</p>
					</div>
					<div className="w-full md:w-auto">
						<Input
							value={bulkRejectReason}
							onChange={(event) => setBulkRejectReason(event.target.value)}
							placeholder="Rejection reason (for bulk reject)"
						/>
					</div>
					<Button size="sm" onClick={() => void executeBulkApprove(selectedPendingIds)} disabled={bulkActionDisabled}>
						Approve selected
					</Button>
					<Button size="sm" variant="danger" onClick={() => void executeBulkReject(selectedPendingIds, bulkRejectReason)} disabled={bulkActionDisabled || !bulkRejectReason.trim()}>
						Reject selected
					</Button>
				</div>
			</div>

			{profileBreakdown.length > 0 ? (
				<div className="grid gap-3 md:grid-cols-3">
					{profileBreakdown.slice(0, 6).map(profile => (
						<div key={profile.label} className="rounded-lg border border-border bg-card px-3 py-3">
							<p className="text-xs text-muted-foreground">Pending for profile</p>
							<p className="mt-1 font-medium">{profile.label}</p>
							<p className="text-sm text-muted-foreground">{profile.count} item(s)</p>
						</div>
					))}
				</div>
			) : null}

			<TableShell
				title="Items Awaiting Decision"
				description="Approve or reject items directly from the queue."
				rows={queue}
				columns={columns}
				rowKey={row => row.id}
				emptyMessage={
					totalInRange === 0
						? "No queue items for the selected filter."
						: "No queue items for this page."
				}
			/>
		</div>
	);
}

