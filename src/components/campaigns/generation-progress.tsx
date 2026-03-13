"use client";

import { useEffect, useState } from "react";

export function GenerationProgress({ batchSize, isGenerating, onPollComplete }: { batchSize: number; isGenerating: boolean; onPollComplete?: () => void }) {
	const [elapsed, setElapsed] = useState(0);

	useEffect(() => {
		if (!isGenerating) return;

		const startTime = Date.now();
		const timer = setInterval(() => {
			const seconds = Math.floor((Date.now() - startTime) / 1000);
			setElapsed(seconds);
		}, 1000);

		return () => clearInterval(timer);
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
	const guidance = batchSize <= 1 ? "Creating the reference shot that will stabilize the rest of the set." : "Rendering the expanded campaign set from the saved anchor and references.";

	return (
		<div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card p-4 space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<div className="relative h-4 w-4">
						<div className="absolute inset-0 rounded-full bg-primary/40 animate-ping" />
						<div className="relative h-4 w-4 rounded-full bg-primary" />
					</div>
					<div>
						<p className="text-sm font-semibold">Generating Images</p>
						<p className="text-[11px] text-muted-foreground">{passLabel}</p>
					</div>
				</div>
				<p className="text-xs text-muted-foreground tabular-nums">
					{formatTime(elapsed)} elapsed · ~{formatTime(remaining)} remaining
				</p>
			</div>

			{/* Progress bar */}
			<div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
				<div className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-all duration-1000 ease-out" style={{ width: `${progress}%` }} />
			</div>

			{/* Skeleton grid */}
			<div className="grid grid-cols-4 gap-2">
				{Array.from({ length: batchSize }, (_, index) => {
					const isDone = index < completedCount;
					return (
						<div key={index} className={`aspect-square rounded-lg border transition-all duration-500 ${isDone ? "border-primary/40 bg-primary/10" : "border-border bg-muted/50 animate-pulse"}`}>
							{isDone ? (
								<div className="flex h-full items-center justify-center">
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-primary">
										<path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
									</svg>
								</div>
							) : (
								<div className="flex h-full items-center justify-center">
									<span className="text-[10px] text-muted-foreground/50">{index + 1}</span>
								</div>
							)}
						</div>
					);
				})}
			</div>

			<p className="text-xs text-muted-foreground text-center">
				{completedCount} of {batchSize} images · Thinking level auto-selected · Parallel processing
			</p>
			<p className="text-[11px] text-center text-muted-foreground/80">{guidance}</p>
		</div>
	);
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
