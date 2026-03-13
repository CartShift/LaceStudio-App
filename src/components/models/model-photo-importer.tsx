"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Images, ScanFace, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { SquareImageThumbnail } from "@/components/ui/square-image-thumbnail";
import { EditorialCard } from "@/components/ui/editorial-card";
import { FormField } from "@/components/workspace/form-field";
import { DropZone } from "@/components/campaigns/drop-zone";
import { apiFormRequest, apiRequest } from "@/lib/client-api";
import { humanizeStatusLabel } from "@/lib/status-labels";
import { getPhotoImportAnalysisIssue, isHeuristicPhotoAnalysis } from "@/components/models/photo-import-analysis";
import type { CharacterDesignDraft, ModelPhotoImportSnapshot, PersonalityDraft, SocialTracksDraft } from "@/components/models/types";
import type { ImageModelProvider } from "@/server/schemas/creative";

const POLL_INTERVAL_MS = 2500;
const PHOTO_IMPORT_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

export type ModelPhotoImportApplyResponse = {
	applied: true;
	model_id: string;
	workflow_state: {
		current_step: "character_design" | "personality" | "social_strategy";
		completed_steps: Array<"character_design" | "personality" | "social_strategy">;
		last_saved_at: string;
	};
	draft: {
		character_design: CharacterDesignDraft;
		personality: PersonalityDraft;
		social_strategy: SocialTracksDraft;
	};
	canonical_job?: {
		job_id: string;
		pack_version: number;
	};
	canonical_warning?: string;
};

type PhotoImportImageReview = NonNullable<ModelPhotoImportSnapshot["latest_suggestion"]>["image_reviews"][number];
type ReviewedReference = ModelPhotoImportSnapshot["references"][number] & Partial<PhotoImportImageReview>;

export function ModelPhotoImporter({
	modelId,
	onApplied,
	onSnapshotChange,
	className,
	embedded = false,
	canonicalSettings
}: {
	modelId: string;
	onApplied?: (payload: ModelPhotoImportApplyResponse) => void | Promise<void>;
	onSnapshotChange?: (snapshot: ModelPhotoImportSnapshot | null) => void;
	className?: string;
	embedded?: boolean;
	canonicalSettings?: {
		provider: ImageModelProvider;
		providerModelId: string;
		candidatesPerShot: number;
		onProviderChange: (provider: ImageModelProvider) => void;
		onProviderModelIdChange: (modelId: string) => void;
		onCandidatesPerShotChange: (count: number) => void;
	};
}) {
	const [snapshot, setSnapshot] = useState<ModelPhotoImportSnapshot | null>(null);
	const [loadingSnapshot, setLoadingSnapshot] = useState(false);
	const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
	const [uploading, setUploading] = useState(false);
	const [applying, setApplying] = useState(false);
	const [reanalyzing, setReanalyzing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [provider, setProvider] = useState<ImageModelProvider>("nano_banana_2");
	const [providerModelId, setProviderModelId] = useState("gemini-3.1-flash-image-preview");
	const [candidatesPerShot, setCandidatesPerShot] = useState(1);

	const canStartImport = selectedFiles.length >= 3 && selectedFiles.length <= 20 && !uploading;
	const status = snapshot?.status ?? "IDLE";
	const shouldPoll = status === "UPLOADING" || status === "ANALYZING";
	const hasImportedReferences = (snapshot?.references.length ?? 0) > 0;
	const activeProvider = canonicalSettings?.provider ?? provider;
	const activeProviderModelId = canonicalSettings?.providerModelId ?? providerModelId;
	const activeCandidatesPerShot = canonicalSettings?.candidatesPerShot ?? candidatesPerShot;
	const canReanalyze = hasImportedReferences && status !== "UPLOADING" && status !== "ANALYZING" && !reanalyzing;
	const refreshSnapshot = useCallback(async () => {
		setLoadingSnapshot(true);
		try {
			const payload = await apiRequest<ModelPhotoImportSnapshot>(`/api/models/${modelId}/workflow/photo-import`);
			setSnapshot(payload);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't load your photo progress. Please try again.");
		} finally {
			setLoadingSnapshot(false);
		}
	}, [modelId]);

	useEffect(() => {
		void refreshSnapshot();
	}, [refreshSnapshot]);

	useEffect(() => {
		if (!shouldPoll) return;
		const timer = setInterval(() => {
			void refreshSnapshot();
		}, POLL_INTERVAL_MS);
		return () => clearInterval(timer);
	}, [shouldPoll, refreshSnapshot]);

	useEffect(() => {
		if (!snapshot) return;
		if (canonicalSettings) return;
		setProvider(snapshot.options.canonical_provider ?? "nano_banana_2");
		setProviderModelId(
			snapshot.options.canonical_model_id ??
				(snapshot.options.canonical_provider === "openai"
					? "gpt-image-1"
					: snapshot.options.canonical_provider === "nano_banana_2"
						? "gemini-3.1-flash-image-preview"
					: snapshot.options.canonical_provider === "zai_glm"
						? "glm-image"
						: snapshot.options.canonical_provider === "gpu"
							? "sdxl-1.0"
							: "gemini-3.1-flash-image-preview")
		);
		setCandidatesPerShot(snapshot.options.canonical_candidates_per_shot);
	}, [snapshot, canonicalSettings]);

	useEffect(() => {
		onSnapshotChange?.(snapshot);
	}, [onSnapshotChange, snapshot]);

	const previewableReferences = useMemo(() => (snapshot?.references ?? []).filter(reference => Boolean(reference.preview_url)), [snapshot?.references]);
	const reviewByReferenceId = useMemo(() => new Map((snapshot?.latest_suggestion?.image_reviews ?? []).map(review => [review.reference_id, review])), [snapshot?.latest_suggestion?.image_reviews]);
	const heuristicAnalysis = useMemo(() => isHeuristicPhotoAnalysis(snapshot), [snapshot]);
	const reviewedReferences = useMemo<ReviewedReference[]>(
		() =>
			(snapshot?.references ?? []).map(reference => ({
				...reference,
				...(reviewByReferenceId.get(reference.id) ?? {})
			})),
		[snapshot?.references, reviewByReferenceId]
	);
	const hasStructuredReviews = !heuristicAnalysis && (snapshot?.latest_suggestion?.image_reviews.length ?? 0) > 0;
	const acceptedReviewedReferences = useMemo(
		() =>
			hasStructuredReviews
				? reviewedReferences
						.filter(reference => reference.status === "ACCEPTED" && reviewByReferenceId.has(reference.id))
						.sort(
							(a, b) =>
								Number(b.identity_anchor_score ?? 0) - Number(a.identity_anchor_score ?? 0) ||
								Number(b.sharpness_score ?? 0) - Number(a.sharpness_score ?? 0) ||
								a.sort_order - b.sort_order
						)
				: [],
		[hasStructuredReviews, reviewByReferenceId, reviewedReferences]
	);
	const topIdentityAnchors = useMemo(() => acceptedReviewedReferences.slice(0, 3), [acceptedReviewedReferences]);
	const readiness = useMemo(() => deriveIdentityReadiness(acceptedReviewedReferences), [acceptedReviewedReferences]);
	const analysisIssue = useMemo(() => getPhotoImportAnalysisIssue(snapshot), [snapshot]);
	const canUpdateModelInfoWithAi = status === "READY" && Boolean(snapshot?.latest_suggestion) && !applying && !analysisIssue?.blocking;
	const previewIndexByReferenceId = useMemo(() => {
		const map = new Map<string, number>();
		previewableReferences.forEach((reference, index) => {
			map.set(reference.id, index);
		});
		return map;
	}, [previewableReferences]);
	const activePreview = typeof previewIndex === "number" && previewIndex >= 0 ? (previewableReferences[previewIndex] ?? null) : null;
	const canGoPrevPreview = typeof previewIndex === "number" && previewIndex > 0;
	const canGoNextPreview = typeof previewIndex === "number" && previewIndex >= 0 && previewIndex < previewableReferences.length - 1;

	useEffect(() => {
		if (previewIndex == null) return;
		if (previewIndex < 0 || previewIndex >= previewableReferences.length) {
			setPreviewIndex(null);
		}
	}, [previewIndex, previewableReferences.length]);

	useEffect(() => {
		if (!activePreview) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setPreviewIndex(null);
				return;
			}

			if (event.key === "ArrowLeft" && canGoPrevPreview && previewIndex != null) {
				setPreviewIndex(previewIndex - 1);
			}

			if (event.key === "ArrowRight" && canGoNextPreview && previewIndex != null) {
				setPreviewIndex(previewIndex + 1);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener("keydown", onKeyDown);
		};
	}, [activePreview, canGoNextPreview, canGoPrevPreview, previewIndex]);

	async function startImport() {
		if (!canStartImport) return;
		setUploading(true);
		setError(null);
		setInfo(null);
		try {
			const form = new FormData();
			for (const file of selectedFiles) {
				form.append("photos", file);
			}
			form.set("keep_as_references", "true");
			form.set("canonical_provider", activeProvider);
			if (activeProviderModelId.trim().length > 0) {
				form.set("canonical_model_id", activeProviderModelId.trim());
			}
			form.set("canonical_candidates_per_shot", String(activeCandidatesPerShot));

			await apiFormRequest(`/api/models/${modelId}/workflow/photo-import`, form, {
				timeoutMs: PHOTO_IMPORT_UPLOAD_TIMEOUT_MS
			});
			setSelectedFiles([]);
			await refreshSnapshot();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't upload your photos. Please try again.");
		} finally {
			setUploading(false);
		}
	}

	async function applySuggestion() {
		setApplying(true);
		setError(null);
		setInfo(null);
		try {
			const payload = await apiRequest<ModelPhotoImportApplyResponse>(`/api/models/${modelId}/workflow/photo-import/apply`, {
				method: "POST",
				body: JSON.stringify({
					start_canonical_generation: false,
					canonical_provider: activeProvider,
					canonical_model_id: activeProviderModelId || undefined,
					canonical_candidates_per_shot: activeCandidatesPerShot
				})
			});
			await refreshSnapshot();
			if (onApplied) {
				await onApplied(payload);
			}
			const warningSuffix = payload.canonical_warning ? ` ${payload.canonical_warning}` : "";
			setInfo(
				payload.canonical_job
					? `We updated this Model using your photos. Reference Set creation started (set v${payload.canonical_job.pack_version}).${warningSuffix}`
					: `We updated this Model using your photos.${warningSuffix}`
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't apply the suggested details. Please try again.");
		} finally {
			setApplying(false);
		}
	}

	async function reanalyzePhotos() {
		if (!canReanalyze) return;
		setReanalyzing(true);
		setError(null);
		setInfo(null);
		try {
			await apiRequest(`/api/models/${modelId}/workflow/photo-import/reanalyze`, {
				method: "POST"
			});
			setInfo("Rechecking photo angles and identity anchors with live vision analysis.");
			await refreshSnapshot();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't reanalyze these photos. Please try again.");
		} finally {
			setReanalyzing(false);
		}
	}

	const body = (
		<>
			<header className="relative grid gap-5 rounded-4xl border border-border/70 bg-[linear-gradient(140deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--accent),transparent_76%)_54%,color-mix(in_oklab,var(--primary),transparent_92%))] p-4 shadow-[var(--shadow-soft)] md:p-5 lg:grid-cols-[minmax(0,1.2fr),minmax(17rem,0.8fr)]">
				<div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-[34%] bg-[radial-gradient(circle_at_100%_0%,color-mix(in_oklab,var(--primary),transparent_82%),transparent_62%)]" />
				
				<div className="relative grid content-between gap-5">
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div className="grid max-w-2xl gap-1">
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Identity Intake</p>
							<h3 className="font-display text-[clamp(1.6rem,3vw,2.15rem)] leading-[0.95]">Build the anchor set before you generate.</h3>
							<p className="mt-1 text-sm text-muted-foreground/90">
								Upload 3-20 photos, let the system rank likeness anchors, then use the strongest front match to drive the rest of the reference set.
							</p>
						</div>
						<Badge tone={statusTone(status)}>{humanizeStatusLabel(status)}</Badge>
					</div>

					<div className="grid gap-2.5 md:grid-cols-3">
						<FlowStep
							icon={<Images className="size-4" />}
							label="1. Upload"
							description={selectedFiles.length > 0 ? `${selectedFiles.length} file(s) queued` : "3-20 solo photos"}
							tone={selectedFiles.length > 0 || snapshot?.counts.total ? "success" : "neutral"}
						/>
						<FlowStep
							icon={<ScanFace className="size-4" />}
							label="2. Analyze"
							description={
								status === "UPLOADING" || status === "ANALYZING"
									? "Reviewing angle, sharpness, anchor strength"
									: analysisIssue?.blocking
										? "Vision analysis needs another pass before anchors are trustworthy"
										: "Angle + anchor scoring"
							}
							tone={status === "UPLOADING" || status === "ANALYZING" ? "warning" : analysisIssue?.blocking ? "danger" : snapshot?.latest_suggestion ? "success" : "neutral"}
						/>
						<FlowStep
							icon={<Sparkles className="size-4" />}
							label="3. Generate"
							description={readiness.nextStep}
							tone={readiness.tone}
						/>
					</div>
				</div>

				<aside className="relative rounded-3xl border border-border/70 bg-background/72 p-4 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_26%)]">
					<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Identity Readiness</p>
					<div className="mt-3 flex items-center justify-between gap-3">
						<div className="grid gap-1">
							<p className="font-display text-2xl leading-none">{readiness.label}</p>
							<p className="text-xs text-muted-foreground">{readiness.description}</p>
						</div>
						<Badge tone={readiness.tone}>{readiness.scoreLabel}</Badge>
					</div>

					<div className="mt-4 grid gap-2 sm:grid-cols-2">
						<CoveragePill label="Frontal anchor" ready={readiness.coverage.frontal} />
						<CoveragePill label="Left 45" ready={readiness.coverage.left45} />
						<CoveragePill label="Right 45" ready={readiness.coverage.right45} />
						<CoveragePill label="Body framing" ready={readiness.coverage.body} />
					</div>
				</aside>
			</header>

			{error ? <StateBlock tone="danger" title="Photo Setup Issue" description={error} /> : null}
			{info ? <StateBlock tone="success" title="Model Updated" description={info} /> : null}
			{analysisIssue && !embedded ? <StateBlock tone={analysisIssue.tone === "danger" ? "warning" : "neutral"} title={analysisIssue.title} description={analysisIssue.description} /> : null}

			{embedded && canonicalSettings ? null : (
				<div className="grid gap-3 md:grid-cols-3">
					<FormField label="Reference Image Engine">
						<SelectField
							value={activeProvider}
							onChange={event => {
								const next = event.target.value as ImageModelProvider;
								if (canonicalSettings) {
									canonicalSettings.onProviderChange(next);
								} else {
									setProvider(next);
								}
							}}>
							<option value="openai">OpenAI</option>
							<option value="nano_banana_2">Nano Banana 2</option>
							<option value="zai_glm">Z.AI GLM</option>
							<option value="gpu">GPU</option>
						</SelectField>
					</FormField>
					<FormField label="Engine Version">
						<Input
							value={activeProviderModelId}
							onChange={event => {
								if (canonicalSettings) {
									canonicalSettings.onProviderModelIdChange(event.target.value);
								} else {
									setProviderModelId(event.target.value);
								}
							}}
						/>
					</FormField>
					<FormField label="Options per Angle">
						<Input
							type="number"
							min={1}
							max={5}
							value={String(activeCandidatesPerShot)}
							onChange={event => {
								const next = Math.max(1, Math.min(5, Number(event.target.value || "1")));
								if (canonicalSettings) {
									canonicalSettings.onCandidatesPerShotChange(next);
								} else {
									setCandidatesPerShot(next);
								}
							}}
						/>
					</FormField>
				</div>
			)}

			<DropZone
				onFilesAdded={files => {
					setSelectedFiles(current => {
						const merged = [...current, ...files];
						return merged.slice(0, 20);
					});
				}}
				maxFiles={20}
			/>

			{selectedFiles.length > 0 ? (
				<div className="rounded-lg border border-border bg-card p-3">
					<p className="text-xs font-subheader">Selected Photos ({selectedFiles.length})</p>
					<p className="mt-1 text-[11px] text-muted-foreground">{selectedFiles.map(file => file.name).join(", ")}</p>
				</div>
			) : null}

			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" onClick={() => void startImport()} disabled={!canStartImport}>
					{uploading ? "Uploading..." : "Upload Photos"}
				</Button>
				<Button type="button" variant="secondary" onClick={() => void refreshSnapshot()} disabled={loadingSnapshot}>
					Refresh
				</Button>
				{hasImportedReferences ? (
					<Button type="button" variant="secondary" onClick={() => void reanalyzePhotos()} disabled={!canReanalyze}>
						{reanalyzing ? "Reanalyzing..." : "Reanalyze Photos"}
					</Button>
				) : null}
				{hasImportedReferences ? (
					<Button type="button" variant="secondary" onClick={() => void applySuggestion()} disabled={!canUpdateModelInfoWithAi}>
						{applying ? "Updating..." : "Apply Suggested Details"}
					</Button>
				) : null}
			</div>

			{snapshot ? (
				<div className="grid gap-2 md:grid-cols-4">
					<MetricPanel label="Queued" value={snapshot.counts.pending} tone="neutral" />
					<MetricPanel label="Accepted" value={snapshot.counts.accepted} tone="success" />
					<MetricPanel label="Rejected" value={snapshot.counts.rejected} tone={snapshot.counts.rejected > 0 ? "warning" : "neutral"} />
					<MetricPanel label="Top anchor" value={formatPercent(topIdentityAnchors[0]?.identity_anchor_score)} tone={readiness.tone} />
				</div>
			) : null}

			{hasStructuredReviews && topIdentityAnchors.length > 0 ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-xs font-subheader">Best Identity Anchors</p>
						<p className="text-[11px] text-muted-foreground">These are the strongest photos to preserve your exact face.</p>
					</div>
					<div className="grid gap-3 md:grid-cols-3">
						{topIdentityAnchors.map((reference, index) => (
							<div key={`anchor-${reference.id}`} className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card/90 p-3 shadow-[var(--shadow-soft)]">
								<SquareImageThumbnail
									src={reference.preview_url}
									alt={reference.file_name ?? reference.id}
									placeholder="Preview unavailable"
									containerClassName="rounded-xl border-border/70"
									onImageClick={() => {
										const previewPosition = previewIndexByReferenceId.get(reference.id);
										if (typeof previewPosition === "number") setPreviewIndex(previewPosition);
									}}
								/>
								<div className="min-w-0">
									<p className="truncate text-sm font-semibold">{index === 0 ? "Primary anchor" : `Anchor ${index + 1}`}</p>
									<Badge className="mt-2 w-fit px-2 py-0.5 text-[10px]" tone={index === 0 ? "success" : "neutral"}>
										{formatPercent(reference.identity_anchor_score)}
									</Badge>
								</div>
								<div className="flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
									{buildReferenceDetailTags(reference, { includeSharpness: true }).map(label => (
										<MiniTag key={`${reference.id}-${label}`} label={label} />
									))}
								</div>
							</div>
						))}
					</div>
				</div>
			) : null}

			{snapshot?.latest_suggestion ? (
				<StateBlock
					tone={readiness.tone === "danger" ? "warning" : readiness.tone === "success" ? "success" : "neutral"}
					title={
						readiness.tone === "success"
							? "Photo set is strong enough for identity-locked generation."
							: "Photo set is usable, but the likeness can improve with better anchor coverage."
					}
					description={readiness.recommendation}
				/>
			) : null}

			{snapshot?.references.length ? (
				<div className="space-y-2">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-xs font-subheader">Imported Photos</p>
						{heuristicAnalysis ? <p className="text-[11px] text-muted-foreground">Angle and anchor tags stay hidden until live analysis succeeds.</p> : null}
					</div>
					<div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
						{reviewedReferences.map(reference => (
							<div key={reference.id} className="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/90 p-3 shadow-[var(--shadow-soft)]">
								<SquareImageThumbnail
									src={reference.preview_url}
									alt={reference.file_name ?? reference.id}
									placeholder="No preview"
									containerClassName="rounded-lg border-border/70"
									onImageClick={() => {
										const index = previewIndexByReferenceId.get(reference.id);
										if (typeof index === "number") setPreviewIndex(index);
									}}
								/>
								<div className="min-w-0">
									<p className="truncate text-[11px] font-medium">{reference.file_name ?? "Uploaded photo"}</p>
									<Badge
										className="mt-2 w-fit px-2 py-0.5 text-[10px]"
										tone={reference.status === "ACCEPTED" ? "success" : reference.status === "REJECTED" ? "danger" : "neutral"}>
										{humanizeStatusLabel(reference.status)}
									</Badge>
								</div>
								{hasStructuredReviews ? (
									<div className="flex flex-wrap gap-1.5">
										{buildReferenceDetailTags(reference, { includeAnchorScore: true }).map(label => (
											<MiniTag key={`${reference.id}-${label}`} label={label} />
										))}
									</div>
								) : null}
								{reference.rejection_reason ? <p className="text-[10px] text-muted-foreground">{reference.rejection_reason}</p> : null}
							</div>
						))}
					</div>
					{previewableReferences.length > 0 ? <p className="text-[11px] text-muted-foreground">Tip: click a thumbnail to open a larger preview.</p> : null}
				</div>
			) : null}

			{activePreview ? (
				<div className="fixed inset-0 z-50 bg-background/85 p-3 backdrop-blur-sm sm:p-5" onClick={() => setPreviewIndex(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Imported photo preview"
						className="mx-auto flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border/70 bg-card text-foreground"
						onClick={event => event.stopPropagation()}>
						<div className="flex items-center justify-between gap-2 border-b border-border/70 p-3">
							<p className="text-sm">
								Imported Photo {Number(previewIndex ?? 0) + 1} / {previewableReferences.length}
							</p>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={() => {
										if (!canGoPrevPreview || previewIndex == null) return;
										setPreviewIndex(previewIndex - 1);
									}}
									disabled={!canGoPrevPreview}
									aria-label="Previous reference">
									Prev
								</Button>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={() => {
										if (!canGoNextPreview || previewIndex == null) return;
										setPreviewIndex(previewIndex + 1);
									}}
									disabled={!canGoNextPreview}
									aria-label="Next reference">
									Next
								</Button>
								<Button type="button" size="sm" variant="secondary" onClick={() => setPreviewIndex(null)} aria-label="Close expanded preview">
									Close
								</Button>
							</div>
						</div>
						<div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3 sm:p-5">
							{/* eslint-disable-next-line @next/next/no-img-element */}
							<img src={activePreview.preview_url ?? ""} alt={activePreview.file_name ?? activePreview.id} className="max-h-full max-w-full rounded-lg object-contain" />
						</div>
					</div>
				</div>
			) : null}
		</>
	);

	if (embedded) {
		return <div className={`space-y-4 ${className ?? ""}`}>{body}</div>;
	}

	return <EditorialCard className={`space-y-4 ${className ?? ""}`}>{body}</EditorialCard>;
}

function statusTone(status: ModelPhotoImportSnapshot["status"]): "neutral" | "warning" | "success" | "danger" {
	if (status === "READY") return "success";
	if (status === "FAILED") return "danger";
	if (status === "UPLOADING" || status === "ANALYZING") return "warning";
	return "neutral";
}

function FlowStep({
	icon,
	label,
	description,
	tone
}: {
	icon: ReactNode;
	label: string;
	description: string;
	tone: "neutral" | "warning" | "success" | "danger";
}) {
	return (
		<div className="grid gap-2 rounded-xl border border-border/70 bg-background/70 p-3">
			<div className="flex items-center gap-2.5">
				<div aria-hidden className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-card text-foreground">{icon}</div>
				<div className="grid gap-0.5">
					<p className="text-xs font-semibold leading-tight">{label}</p>
					<Badge className="w-fit scale-[0.85] origin-left" tone={tone}>
						{tone === "success" ? "Ready" : tone === "warning" ? "In progress" : tone === "danger" ? "Needs attention" : "Waiting"}
					</Badge>
				</div>
			</div>
			<p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p>
		</div>
	);
}

function CoveragePill({ label, ready }: { label: string; ready: boolean }) {
	return (
		<div className={`flex items-center gap-1.5 rounded-full border px-3 py-2 text-[11px] font-medium ${ready ? "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]" : "border-border/70 bg-muted/45 text-muted-foreground"}`}>
			{ready ? <Check className="size-3.5" /> : <ArrowRight className="size-3.5" />}
			{label}
		</div>
	);
}

function MetricPanel({
	label,
	value,
	tone
}: {
	label: string;
	value: string | number;
	tone: "neutral" | "warning" | "success" | "danger";
}) {
	return (
		<div className="rounded-xl border border-border/70 bg-card/85 p-3">
			<div className="flex items-center justify-between gap-2">
				<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
				<Badge tone={tone}>{tone === "success" ? "Good" : tone === "warning" ? "Watch" : tone === "danger" ? "Low" : "Info"}</Badge>
			</div>
			<p className="mt-2 font-display text-2xl leading-none">{value}</p>
		</div>
	);
}

function MiniTag({ label }: { label: string }) {
	return <span className="rounded-full border border-border/70 bg-muted/45 px-2 py-1 text-[10px] text-muted-foreground">{label}</span>;
}

function deriveIdentityReadiness(references: ReviewedReference[]) {
	const frontal = references.some(reference => reference.view_angle === "frontal" && (reference.framing === "closeup" || reference.framing === "head_shoulders"));
	const left45 = references.some(reference => reference.view_angle === "left_45");
	const right45 = references.some(reference => reference.view_angle === "right_45");
	const body = references.some(reference => reference.framing === "half_body" || reference.framing === "full_body");
	const topAnchorScore = Number(references[0]?.identity_anchor_score ?? 0);

	let signalCount = 0;
	if (references.length >= 5) signalCount += 1;
	if (frontal) signalCount += 1;
	if (left45) signalCount += 1;
	if (right45) signalCount += 1;
	if (body) signalCount += 1;
	if (topAnchorScore >= 0.85) signalCount += 1;

	if (signalCount >= 6) {
		return {
			label: "Anchor-ready",
			tone: "success" as const,
			scoreLabel: `${signalCount}/6`,
			description: "Strong angle coverage with a clear front anchor.",
			nextStep: "Generate the front look now.",
			recommendation: "Approve the front option with the strongest identity match first, then generate the remaining angles so they inherit that anchor.",
			coverage: { frontal, left45, right45, body }
		};
	}

	if (signalCount >= 4) {
		return {
			label: "Usable",
			tone: "warning" as const,
			scoreLabel: `${signalCount}/6`,
			description: "The set can work, but one or two anchor angles are still thin.",
			nextStep: "You can generate now, but better coverage will improve likeness.",
			recommendation: "For a closer match, add a sharper frontal close-up plus missing left/right 45 or body shots before the next generation pass.",
			coverage: { frontal, left45, right45, body }
		};
	}

	return {
		label: "Thin coverage",
		tone: "danger" as const,
		scoreLabel: `${signalCount}/6`,
		description: "The system does not have enough strong identity anchors yet.",
		nextStep: "Add more solo photos before generating.",
		recommendation: "Prioritize one sharp frontal close-up, one left 45, one right 45, and at least one half-body or full-body image with the face still clearly visible.",
		coverage: { frontal, left45, right45, body }
	};
}

function formatPercent(value: number | null | undefined): string {
	if (typeof value !== "number" || Number.isNaN(value)) return "--";
	return `${Math.round(value * 100)}%`;
}

function humanizeAngle(value: ReviewedReference["view_angle"]): string {
	if (!value || value === "unknown") return "Angle unknown";
	if (value === "left_45") return "Left 45";
	if (value === "right_45") return "Right 45";
	if (value === "left_profile") return "Left profile";
	if (value === "right_profile") return "Right profile";
	return "Frontal";
}

function humanizeFraming(value: ReviewedReference["framing"]): string {
	if (!value || value === "unknown") return "Framing unknown";
	if (value === "head_shoulders") return "Head + shoulders";
	if (value === "half_body") return "Half body";
	if (value === "full_body") return "Full body";
	return "Close-up";
}

function humanizeExpression(value: ReviewedReference["expression"]): string {
	if (!value || value === "other") return "Flexible expression";
	if (value === "soft_smile") return "Soft smile";
	if (value === "serious") return "Serious";
	return "Neutral";
}

function buildReferenceDetailTags(
	reference: Pick<ReviewedReference, "view_angle" | "framing" | "expression" | "identity_anchor_score" | "sharpness_score">,
	options?: {
		includeAnchorScore?: boolean;
		includeSharpness?: boolean;
	}
): string[] {
	const tags: string[] = [];

	if (reference.view_angle && reference.view_angle !== "unknown") {
		tags.push(humanizeAngle(reference.view_angle));
	}

	if (reference.framing && reference.framing !== "unknown") {
		tags.push(humanizeFraming(reference.framing));
	}

	if (reference.expression && reference.expression !== "other") {
		tags.push(humanizeExpression(reference.expression));
	}

	if (options?.includeAnchorScore && typeof reference.identity_anchor_score === "number") {
		tags.push(`Anchor ${formatPercent(reference.identity_anchor_score)}`);
	}

	if (options?.includeSharpness && typeof reference.sharpness_score === "number") {
		tags.push(`Sharp ${formatPercent(reference.sharpness_score)}`);
	}

	return tags;
}
