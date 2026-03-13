"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

export function ModelPhotoImporter({
	modelId,
	onApplied,
	className,
	embedded = false,
	canonicalSettings
}: {
	modelId: string;
	onApplied?: (payload: ModelPhotoImportApplyResponse) => void | Promise<void>;
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
	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [provider, setProvider] = useState<ImageModelProvider>("zai_glm");
	const [providerModelId, setProviderModelId] = useState("glm-image");
	const [candidatesPerShot, setCandidatesPerShot] = useState(1);

	const canStartImport = selectedFiles.length >= 3 && selectedFiles.length <= 20 && !uploading;
	const status = snapshot?.status ?? "IDLE";
	const shouldPoll = status === "UPLOADING" || status === "ANALYZING";
	const hasImportedReferences = (snapshot?.references.length ?? 0) > 0;
	const activeProvider = canonicalSettings?.provider ?? provider;
	const activeProviderModelId = canonicalSettings?.providerModelId ?? providerModelId;
	const activeCandidatesPerShot = canonicalSettings?.candidatesPerShot ?? candidatesPerShot;
	const canUpdateModelInfoWithAi = status === "READY" && Boolean(snapshot?.latest_suggestion) && !applying;
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
		setProvider(snapshot.options.canonical_provider ?? "zai_glm");
		setProviderModelId(
			snapshot.options.canonical_model_id ??
				(snapshot.options.canonical_provider === "openai"
					? "gpt-image-1"
					: snapshot.options.canonical_provider === "zai_glm"
						? "glm-image"
						: snapshot.options.canonical_provider === "gpu"
							? "sdxl-1.0"
							: "glm-image")
		);
		setCandidatesPerShot(snapshot.options.canonical_candidates_per_shot);
	}, [snapshot, canonicalSettings]);

	const previewableReferences = useMemo(() => (snapshot?.references ?? []).filter(reference => Boolean(reference.preview_url)), [snapshot?.references]);
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

	const body = (
		<>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="font-display text-xl">Photo Setup</h3>
					<p className="text-sm text-muted-foreground">Upload 3-20 clear photos. We will suggest Character, Personality, and Strategy details.</p>
				</div>
				<Badge tone={statusTone(status)}>{humanizeStatusLabel(status)}</Badge>
			</div>

			{error ? <StateBlock tone="error" title="Photo Setup Issue" description={error} /> : null}
			{info ? <StateBlock tone="success" title="Model Updated" description={info} /> : null}

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
					<Button type="button" variant="secondary" onClick={() => void applySuggestion()} disabled={!canUpdateModelInfoWithAi}>
						{applying ? "Updating..." : "Apply Suggested Details"}
					</Button>
				) : null}
			</div>

			{snapshot ? (
				<div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs md:grid-cols-4">
					<div>Waiting: {snapshot.counts.pending}</div>
					<div>Ready: {snapshot.counts.accepted}</div>
					<div>Skipped: {snapshot.counts.rejected}</div>
					<div>Total: {snapshot.counts.total}</div>
				</div>
			) : null}

			{snapshot?.references.length ? (
				<div className="space-y-2">
					<p className="text-xs font-subheader">Imported Photos</p>
					<div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
						{snapshot.references.map(reference => (
							<div key={reference.id} className="rounded-lg border border-border bg-card p-2">
								<SquareImageThumbnail
									src={reference.preview_url}
									alt={reference.file_name ?? reference.id}
									placeholder="No preview"
									containerClassName="mb-2"
									onImageClick={() => {
										const index = previewIndexByReferenceId.get(reference.id);
										if (typeof index === "number") setPreviewIndex(index);
									}}
								/>
								<div className="flex items-center justify-between gap-2">
									<p className="truncate text-[11px]">{reference.file_name ?? "Uploaded photo"}</p>
									<Badge tone={reference.status === "ACCEPTED" ? "success" : reference.status === "REJECTED" ? "danger" : "neutral"}>
										{humanizeStatusLabel(reference.status)}
									</Badge>
								</div>
								{reference.rejection_reason ? <p className="mt-1 text-[10px] text-muted-foreground">{reference.rejection_reason}</p> : null}
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
