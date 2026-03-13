"use client";

import { useEffect, useState } from "react";
import { ImageGenerationSurface } from "@/components/ui/image-generation-surface";

export function GenerationProgress({ batchSize, isGenerating, onPollComplete }: { batchSize: number; isGenerating: boolean; onPollComplete?: () => void }) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!isGenerating) return;

		const startTime = Date.now();
		const timer = setInterval(() => {
			const seconds = Math.floor((Date.now() - startTime) / 1000);
			setElapsed(seconds);
		}, 1000);

		return () => {
			clearInterval(timer);
			setElapsed(0);
		};
	}, [isGenerating]);

	useEffect(() => {
		if (!isGenerating) return;

		const pollInterval = setInterval(() => {
			onPollComplete?.();
		}, 3000);

		return () => clearInterval(pollInterval);
	}, [isGenerating, onPollComplete]);

	if (!isGenerating) return null;

	const estimatedPerImage = 12;
	const completedCount = batchSize > 0 ? Math.min(batchSize, Math.floor(elapsed / estimatedPerImage)) : 0;
	const progress = batchSize > 0 ? Math.min(95, (completedCount / batchSize) * 100) : 0;
	const estimatedTotal = batchSize * estimatedPerImage;
	const remaining = Math.max(0, estimatedTotal - elapsed);
	const passLabel = batchSize <= 1 ? "Anchor pass" : "Campaign batch";
	const guidance =
		batchSize <= 1
			? "The lead frame is being tuned first so the rest of the set inherits the same identity and scene."
			: "Queued renders keep the anchor, outfit direction, and reference mood aligned while the batch fills in.";

	return (
		<div className="relative overflow-hidden rounded-2xl border border-[color:color-mix(in_oklab,var(--color-primary),transparent_76%)] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--card),white_12%),color-mix(in_oklab,var(--accent),transparent_78%))] p-4 shadow-[var(--shadow-soft)]">
			<div className="image-generation-shell opacity-90" />

			<div className="relative z-10 space-y-4">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex items-start gap-3">
						<div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-white/10 shadow-[0_10px_28px_color-mix(in_oklab,var(--foreground),transparent_90%)] backdrop-blur-md">
							<span className="image-generation-shell__dot" />
						</div>
						<div>
							<p className="text-sm font-semibold">Rendering live image slots</p>
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{passLabel}</p>
							<p className="mt-1 max-w-xl text-[11px] leading-relaxed text-muted-foreground">{guidance}</p>
						</div>
					</div>

					<div className="rounded-[1rem] border border-white/16 bg-white/8 px-3 py-2 text-right backdrop-blur-md">
						<p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Live ETA</p>
						<p className="mt-1 text-sm font-semibold tabular-nums">{formatTime(elapsed)} elapsed</p>
						<p className="text-[11px] tabular-nums text-muted-foreground">~{formatTime(remaining)} remaining</p>
					</div>
				</div>

				<div className="rounded-[1rem] border border-white/14 bg-black/[0.03] p-3 backdrop-blur-sm">
					<div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
						<p>{completedCount} frames landed</p>
						<p>{Math.max(batchSize - completedCount, 0)} still rendering</p>
					</div>
					<div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
						<div
							className="h-full rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--media-loading-a),white_6%),color-mix(in_oklab,var(--media-loading-c),white_6%),color-mix(in_oklab,var(--media-loading-b),white_6%))] transition-[width] duration-1000 ease-out"
							style={{ width: `${progress}%` }}
						/>
					</div>
				</div>

				<div className="grid grid-cols-2 gap-2 md:grid-cols-4">
					{Array.from({ length: batchSize }, (_, index) => {
						const isDone = index < completedCount;
						return isDone ? (
							<div
								key={index}
								className="relative aspect-square overflow-hidden rounded-xl border border-[color:color-mix(in_oklab,var(--status-success),transparent_72%)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-success-bg),white_12%),color-mix(in_oklab,var(--card),transparent_0%))] shadow-[var(--shadow-soft)]">
								<div className="absolute inset-0 bg-[radial-gradient(circle_at_24%_20%,color-mix(in_oklab,var(--status-success),transparent_76%),transparent_42%),linear-gradient(145deg,transparent,color-mix(in_oklab,var(--status-success),transparent_92%))]" />
								<div className="relative z-10 flex h-full flex-col items-center justify-center gap-2 p-3 text-center">
									<div className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:color-mix(in_oklab,var(--status-success),transparent_70%)] bg-[color:color-mix(in_oklab,var(--status-success),white_82%)] text-[var(--status-success)] shadow-[0_10px_24px_color-mix(in_oklab,var(--status-success),transparent_78%)]">
										<svg width="18" height="18" viewBox="0 0 16 16" fill="none" aria-hidden="true">
											<path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
										</svg>
									</div>
									<div>
										<p className="text-[11px] font-semibold text-foreground">{`Frame ${index + 1}`}</p>
										<p className="text-[10px] uppercase tracking-[0.16em] text-[var(--status-success)]">Ready</p>
									</div>
								</div>
							</div>
						) : (
							<ImageGenerationSurface
								key={index}
								src={null}
								alt={`Rendering frame ${index + 1}`}
								className="rounded-xl"
								loading
								loadingTitle={`Frame ${index + 1}`}
								loadingBadge={index === completedCount ? "Rendering" : "Queued"}
								loadingVariant="compact"
							/>
						);
					})}
				</div>

				<p className="text-center text-[11px] text-muted-foreground">These slots stay animated until the generated images are written into the campaign queue.</p>
			</div>
		</div>
	);
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
