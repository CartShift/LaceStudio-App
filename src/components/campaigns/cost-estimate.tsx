"use client";

import { useMemo } from "react";
import { estimateImageGenerationCost, type ImageCostProvider } from "@/lib/image-cost";

type CostEstimateProps = {
	batchSize: number;
	width: number;
	height: number;
	provider: ImageCostProvider;
	referenceCount: number;
	promptLength: number;
};

export function CostEstimate({ batchSize, width, height, provider, referenceCount, promptLength }: CostEstimateProps) {
	const estimate = useMemo(() => {
		return estimateImageGenerationCost({
			provider,
			batchSize,
			width,
			height,
			referenceCount,
			promptLength
		});
	}, [batchSize, width, height, provider, referenceCount, promptLength]);

	return (
		<div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2 space-y-1.5">
			<div className="flex items-center justify-between">
				<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Estimated Cost</p>
				<p className="font-mono text-sm font-semibold text-primary">${estimate.totalUsd.toFixed(3)}</p>
			</div>
			<div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
				<span>Per image</span>
				<span className="text-right font-mono">${estimate.perImageUsd.toFixed(4)}</span>
				<span>Batch × {batchSize}</span>
				<span className="text-right">{estimate.resolutionTier} resolution</span>
				<span>Refs: {referenceCount}</span>
				<span className="text-right">~{(estimate.totalTokens / 1000).toFixed(1)}k tokens</span>
				<span>Thinking</span>
				<span className={`text-right ${estimate.thinkingLevel === "High" ? "text-amber-400" : ""}`}>{estimate.thinkingLevel}</span>
			</div>
		</div>
	);
}
