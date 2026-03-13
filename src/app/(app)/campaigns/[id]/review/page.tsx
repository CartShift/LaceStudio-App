"use client";

import { useParams, usePathname, useRouter } from "next/navigation";
import { useBreadcrumb } from "@/components/providers/breadcrumb-provider";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { ToggleRow } from "@/components/ui/toggle-row";
import { FormField } from "@/components/workspace/form-field";
import { apiRequest } from "@/lib/client-api";
import { useNotice } from "@/components/providers/notice-provider";
import { humanizeStatusLabel } from "@/lib/status-labels";
import Image from "next/image";

const allowedIssueTags = ["pose_error", "face_drift", "lighting_mismatch", "artifact", "wardrobe_issue", "expression_mismatch", "composition_issue"] as const;

type IssueTag = (typeof allowedIssueTags)[number];

type Asset = {
	id: string;
	status: "PENDING" | "APPROVED" | "REJECTED";
	seed: number;
	sequence_number: number;
	quality_score: number | null;
	moderation_notes: string | null;
	issue_tags: IssueTag[];
	artifacts_flagged: boolean;
	raw_gcs_uri: string;
};

type CampaignReview = {
	id: string;
	name: string;
	prompt_text: string | null;
	assets: Asset[];
};

export default function CampaignReviewPage() {
	const params = useParams<{ id: string }>();
	const router = useRouter();
	const pathname = usePathname();
	const { setSegmentTitle } = useBreadcrumb();
	const campaignId = params.id;
	const segmentIndex = pathname.split("/").filter(Boolean).indexOf(campaignId);

	const [campaign, setCampaign] = useState<CampaignReview | null>(null);
	const [working, setWorking] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);

	const [qualityByAsset, setQualityByAsset] = useState<Record<string, string>>({});
	const [notesByAsset, setNotesByAsset] = useState<Record<string, string>>({});
	const [tagsByAsset, setTagsByAsset] = useState<Record<string, IssueTag[]>>({});
	const [artifactByAsset, setArtifactByAsset] = useState<Record<string, boolean>>({});
	const [selectedAssetIds, setSelectedAssetIds] = useState<Record<string, boolean>>({});
	const [bulkQuality, setBulkQuality] = useState("82");
	const [bulkNote, setBulkNote] = useState("");
	const [bulkArtifactFlag, setBulkArtifactFlag] = useState(false);
	const [focusedIndex, setFocusedIndex] = useState(0);
	const [viewMode, setViewMode] = useState<"detail" | "grid">("detail");
	const { notify } = useNotice();

	const { approvedCount, flaggedCount } = useMemo(() => {
		let approved = 0;
		let flagged = 0;
		for (const asset of campaign?.assets ?? []) {
			if (asset.status === "APPROVED") approved++;
			if (asset.artifacts_flagged) flagged++;
		}
		return { approvedCount: approved, flaggedCount: flagged };
	}, [campaign]);
	const selectedIds = useMemo(
		() =>
			Object.entries(selectedAssetIds)
				.filter(([, selected]) => selected)
				.map(([id]) => id),
		[selectedAssetIds]
	);
	const averageQuality = useMemo(() => {
		const scores = campaign?.assets.map(asset => asset.quality_score).filter((score): score is number => typeof score === "number");
		if (!scores || scores.length === 0) return null;
		return scores.reduce((sum, score) => sum + score, 0) / scores.length;
	}, [campaign]);

	const load = useCallback(async () => {
		setError(null);
		try {
			const data = await apiRequest<CampaignReview>(`/api/campaigns/${campaignId}`);
			setCampaign(data);

			const quality: Record<string, string> = {};
			const notes: Record<string, string> = {};
			const tags: Record<string, IssueTag[]> = {};
			const artifacts: Record<string, boolean> = {};
			const selected: Record<string, boolean> = {};

			for (const asset of data.assets) {
				quality[asset.id] = asset.quality_score ? String(asset.quality_score) : "82";
				notes[asset.id] = asset.moderation_notes ?? "";
				tags[asset.id] = asset.issue_tags ?? [];
				artifacts[asset.id] = asset.artifacts_flagged;
				selected[asset.id] = false;
			}

			setQualityByAsset(quality);
			setNotesByAsset(notes);
			setTagsByAsset(tags);
			setArtifactByAsset(artifacts);
			setSelectedAssetIds(selected);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't load the review page.");
		}
	}, [campaignId]);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (campaign && segmentIndex >= 0) setSegmentTitle(segmentIndex, campaign.name);
		return () => (segmentIndex >= 0 ? setSegmentTitle(segmentIndex, null) : undefined);
	}, [campaign, segmentIndex, setSegmentTitle]);

	const moderate = useCallback(
		async (assetId: string, action: "approve" | "reject" | "flag") => {
			if (action === "reject") {
				const confirmed = window.confirm("Reject this asset? You can still generate a new version later.");
				if (!confirmed) return;
			}
			setWorking(true);
			setError(null);
			setInfo(null);

			try {
				await apiRequest(`/api/campaigns/${campaignId}/assets/${assetId}/review`, {
					method: "POST",
					body: JSON.stringify({
						action,
						quality_score: clampNumber(qualityByAsset[assetId] ?? "82", 82, 0, 100),
						notes: notesByAsset[assetId] ?? "",
						issue_tags: tagsByAsset[assetId] ?? [],
						flag_artifacts: artifactByAsset[assetId] ?? false
					})
				});
				await load();
				notify({
					tone: action === "reject" ? "warning" : "success",
					title: `Asset ${action === "approve" ? "approved" : action === "reject" ? "rejected" : "flagged"}`
				});
			} catch (err) {
				setError(err instanceof Error ? err.message : "We couldn't apply this review action.");
			} finally {
				setWorking(false);
			}
		},
		[artifactByAsset, campaignId, load, notesByAsset, notify, qualityByAsset, tagsByAsset]
	);

	// Keyboard shortcuts
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const target = event.target as HTMLElement;
			if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;

			const assets = campaign?.assets ?? [];
			if (assets.length === 0) return;

			const focusedAsset = assets[focusedIndex];

			switch (event.key) {
				case "ArrowLeft":
					event.preventDefault();
					setFocusedIndex(i => Math.max(0, i - 1));
					break;
				case "ArrowRight":
					event.preventDefault();
					setFocusedIndex(i => Math.min(assets.length - 1, i + 1));
					break;
				case " ":
					event.preventDefault();
					if (focusedAsset) {
						setSelectedAssetIds(c => ({ ...c, [focusedAsset.id]: !c[focusedAsset.id] }));
					}
					break;
				case "a":
					if (focusedAsset && !working) void moderate(focusedAsset.id, "approve");
					break;
				case "r":
					if (focusedAsset && !working) void moderate(focusedAsset.id, "reject");
					break;
				case "f":
					if (focusedAsset && !working) void moderate(focusedAsset.id, "flag");
					break;
			}
		}

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [campaign?.assets, focusedIndex, moderate, working]);

	async function saveRefinement(assetId: string) {
		setWorking(true);
		setError(null);
		setInfo(null);
		try {
			await apiRequest(`/api/campaigns/${campaignId}/assets/${assetId}/refine`, {
				method: "POST",
				body: JSON.stringify({
					reason: notesByAsset[assetId] || "Manual review adjustment",
					prompt_text: campaign?.prompt_text ?? undefined,
					expression_micro_adjustment: {
						smile_intensity: 0.22
					},
					realism_tuning: {
						skin_texture_realism: 0.85,
						shadow_accuracy: 0.86
					}
				})
			});
			setInfo("Refinement settings saved.");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't save refinement settings.");
		} finally {
			setWorking(false);
		}
	}

	async function applyBulk(action: "approve" | "reject" | "flag" | "save_refinement") {
		if (!selectedIds.length) {
			setError("Select at least one asset for bulk actions.");
			return;
		}
		if (action === "reject") {
			const confirmed = window.confirm(`Reject ${selectedIds.length} selected assets?`);
			if (!confirmed) return;
		}

		setWorking(true);
		setError(null);
		setInfo(null);
		try {
			for (const assetId of selectedIds) {
				if (action === "save_refinement") {
					await apiRequest(`/api/campaigns/${campaignId}/assets/${assetId}/refine`, {
						method: "POST",
						body: JSON.stringify({
							reason: bulkNote || "Bulk review refinement",
							prompt_text: campaign?.prompt_text ?? undefined,
							realism_tuning: {
								skin_texture_realism: 0.85
							}
						})
					});
					continue;
				}

				await apiRequest(`/api/campaigns/${campaignId}/assets/${assetId}/review`, {
					method: "POST",
					body: JSON.stringify({
						action,
						quality_score: clampNumber(qualityByAsset[assetId] ?? bulkQuality, 82, 0, 100),
						notes: bulkNote || notesByAsset[assetId] || "",
						issue_tags: tagsByAsset[assetId] ?? [],
						flag_artifacts: bulkArtifactFlag || artifactByAsset[assetId] || false
					})
				});
			}

			setInfo(`Bulk action completed for ${selectedIds.length} assets.`);
			notify({
				tone: action === "reject" ? "warning" : "success",
				title: `Bulk action applied`,
				description: `${selectedIds.length} assets updated.`
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't complete the bulk action.");
		} finally {
			setWorking(false);
		}
	}

	async function finalize() {
		setWorking(true);
		setError(null);
		setInfo(null);
		try {
			await apiRequest(`/api/campaigns/${campaignId}/finalize`, {
				method: "POST"
			});
			router.push(`/campaigns/${campaignId}`);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't finalize this campaign.");
		} finally {
			setWorking(false);
		}
	}

	function setAllSelections(selected: boolean) {
		setSelectedAssetIds(current => Object.fromEntries(Object.keys(current).map(assetId => [assetId, selected])));
	}

	function toggleIssueTag(assetId: string, tag: IssueTag) {
		setTagsByAsset(current => {
			const active = current[assetId] ?? [];
			const hasTag = active.includes(tag);
			return {
				...current,
				[assetId]: hasTag ? active.filter(item => item !== tag) : [...active, tag]
			};
		});
	}

	return (
		<div className="space-y-4">
			<PageHeader
				title={campaign ? `🎯 ${campaign.name} Review` : "🎯 Campaign Review"}
				description="Review each asset quickly with individual controls or bulk actions."
				action={
					<Button onClick={finalize} disabled={working || !campaign?.assets.length}>
						Finalize Selection
					</Button>
				}
			/>

			<EditorialCard>
				<div className="flex flex-wrap items-center gap-3">
					<Badge tone={approvedCount > 0 ? "success" : "warning"}>Approved {approvedCount}</Badge>
					<Badge tone={flaggedCount > 0 ? "danger" : "neutral"}>Visual Glitches {flaggedCount}</Badge>
					<Badge tone="neutral">Selected {selectedIds.length}</Badge>
					<span className="text-sm text-muted-foreground">Total assets: {campaign?.assets.length ?? 0}</span>
					<span className="text-sm text-muted-foreground">Avg quality: {averageQuality ? averageQuality.toFixed(1) : "n/a"}</span>
					<div className="ml-auto flex gap-2">
						<Button type="button" size="sm" variant={viewMode === "detail" ? "primary" : "secondary"} onClick={() => setViewMode("detail")}>
							Detail
						</Button>
						<Button type="button" size="sm" variant={viewMode === "grid" ? "primary" : "secondary"} onClick={() => setViewMode("grid")}>
							Grid
						</Button>
						<Button type="button" size="sm" variant="secondary" onClick={() => setAllSelections(true)}>
							Select All
						</Button>
						<Button type="button" size="sm" variant="secondary" onClick={() => setAllSelections(false)}>
							Clear
						</Button>
					</div>
				</div>
			</EditorialCard>

			{/* Keyboard shortcuts hint */}
			<div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-1.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
				<span className="font-medium">Shortcuts:</span>
				<span>
					<kbd className="rounded border border-border bg-card px-1">A</kbd> Approve
				</span>
				<span>
					<kbd className="rounded border border-border bg-card px-1">R</kbd> Reject
				</span>
				<span>
					<kbd className="rounded border border-border bg-card px-1">F</kbd> Flag
				</span>
				<span>
					<kbd className="rounded border border-border bg-card px-1">Space</kbd> Toggle
				</span>
				<span>
					<kbd className="rounded border border-border bg-card px-1">←</kbd> <kbd className="rounded border border-border bg-card px-1">→</kbd> Navigate
				</span>
				<span className="ml-auto">Focused: #{campaign?.assets[focusedIndex]?.sequence_number ?? "-"}</span>
			</div>

			<EditorialCard className="space-y-3">
				<h2 className="font-display text-xl font-semibold">Bulk Actions</h2>
				<div className="grid gap-3 md:grid-cols-3">
					<FormField label="Bulk Quality Score">
						<Input value={bulkQuality} onChange={event => setBulkQuality(event.target.value)} />
					</FormField>
					<FormField label="Bulk Note">
						<Input value={bulkNote} onChange={event => setBulkNote(event.target.value)} />
					</FormField>
					<ToggleRow label="Flag Visual Glitches" description="Apply a visual glitch flag to all selected assets." checked={bulkArtifactFlag} onCheckedChange={setBulkArtifactFlag} />
				</div>
				<div className="flex flex-wrap gap-2">
					<Button type="button" onClick={() => void applyBulk("approve")} disabled={working}>
						Approve Selected
					</Button>
					<Button type="button" variant="danger" onClick={() => void applyBulk("reject")} disabled={working}>
						Reject Selected
					</Button>
					<Button type="button" variant="secondary" onClick={() => void applyBulk("flag")} disabled={working}>
						Flag Selected
					</Button>
					<Button type="button" variant="ghost" onClick={() => void applyBulk("save_refinement")} disabled={working}>
						Save Refinement Settings
					</Button>
				</div>
			</EditorialCard>

			{viewMode === "grid" ? (
				<div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
					{campaign?.assets.map((asset, index) => {
						const isFocused = index === focusedIndex;
						const isSelected = selectedAssetIds[asset.id] ?? false;
						return (
							<button
								key={asset.id}
								type="button"
								onClick={() => {
									setFocusedIndex(index);
									setSelectedAssetIds(c => ({ ...c, [asset.id]: !c[asset.id] }));
								}}
								className={`relative aspect-square rounded-xl border-2 transition-all bg-card overflow-hidden group ${
									isFocused ? "border-primary ring-2 ring-primary/20" : isSelected ? "border-primary/50" : "border-border hover:border-primary/30"
								}`}>
								<Image
									src={asset.raw_gcs_uri}
									alt={`Asset ${asset.sequence_number}`}
									fill
									sizes="(max-width: 640px) 50vw, 200px"
									className="object-cover transition-transform duration-300 group-hover:scale-105"
								/>
								<div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-3 pt-12 flex flex-col items-start gap-1">
									<p className="text-xs font-semibold drop-shadow-sm">#{asset.sequence_number}</p>
									<div className="flex w-full flex-wrap items-center gap-1">
										<Badge tone={asset.status === "APPROVED" ? "success" : asset.status === "REJECTED" ? "danger" : "warning"}>{asset.status[0]}</Badge>
										{asset.artifacts_flagged ? <Badge tone="danger">!</Badge> : null}
										<span className="ml-auto text-[10px] font-medium drop-shadow-sm text-foreground/80">seed {asset.seed}</span>
									</div>
								</div>
								{isSelected ? (
									<div className="absolute top-2 right-2 h-5 w-5 rounded-full bg-primary flex items-center justify-center shadow-md">
										<svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="text-primary-foreground">
											<path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</div>
								) : null}
							</button>
						);
					})}
				</div>
			) : (
				<div className="grid gap-4 xl:grid-cols-2">
					{campaign?.assets.map(asset => (
						<EditorialCard key={asset.id}>
							<div className="space-y-4">
								<div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg border border-border bg-muted">
									<Image src={asset.raw_gcs_uri} alt={`Asset ${asset.sequence_number}`} fill sizes="(max-width: 1280px) 100vw, 50vw" className="object-cover" />
								</div>
								<div className="flex items-center justify-between gap-3">
									<div className="flex items-center gap-2">
										<Checkbox
											checked={selectedAssetIds[asset.id] ?? false}
											onCheckedChange={checked =>
												setSelectedAssetIds(current => ({
													...current,
													[asset.id]: Boolean(checked)
												}))
											}
										/>
										<p className="font-semibold">
											#{asset.sequence_number} · seed {asset.seed}
										</p>
									</div>
									<Badge>{humanizeStatusLabel(asset.status)}</Badge>
								</div>

								<div className="grid gap-3 md:grid-cols-2">
									<FormField label="Quality Score">
										<Input value={qualityByAsset[asset.id] ?? "82"} onChange={event => setQualityByAsset(current => ({ ...current, [asset.id]: event.target.value }))} />
									</FormField>
									<ToggleRow
										className="rounded-lg"
										label="Flag Visual Glitches"
										checked={artifactByAsset[asset.id] ?? false}
										onCheckedChange={checked => setArtifactByAsset(current => ({ ...current, [asset.id]: checked }))}
									/>
								</div>

								<FormField label="Issue Tags">
									<div className="flex flex-wrap gap-2">
										{allowedIssueTags.map(tag => {
											const active = (tagsByAsset[asset.id] ?? []).includes(tag);
											return (
												<Button key={`${asset.id}-${tag}`} type="button" size="sm" variant={active ? "primary" : "secondary"} onClick={() => toggleIssueTag(asset.id, tag)}>
													{tag}
												</Button>
											);
										})}
									</div>
								</FormField>

								<FormField label="Review Notes">
									<Textarea rows={2} value={notesByAsset[asset.id] ?? ""} onChange={event => setNotesByAsset(current => ({ ...current, [asset.id]: event.target.value }))} />
								</FormField>

								<div className="flex flex-wrap gap-2">
									<Button onClick={() => void moderate(asset.id, "approve")} disabled={working}>
										Approve
									</Button>
									<Button variant="danger" onClick={() => void moderate(asset.id, "reject")} disabled={working}>
										Reject
									</Button>
									<Button variant="secondary" onClick={() => void moderate(asset.id, "flag")} disabled={working}>
										Flag
									</Button>
									<Button variant="ghost" onClick={() => void saveRefinement(asset.id)} disabled={working}>
										Save Refinement
									</Button>
								</div>
							</div>
						</EditorialCard>
					))}
				</div>
			)}

			{info ? <StateBlock tone="success" title="Review Updated" description={info} /> : null}
			{error ? <StateBlock tone="error" title="Review Failed" description={error} /> : null}
		</div>
	);
}

function clampNumber(value: string, fallback: number, min: number, max: number): number {
	const parsed = Number.parseFloat(value);
	if (Number.isNaN(parsed)) return fallback;
	return Math.max(min, Math.min(max, parsed));
}
