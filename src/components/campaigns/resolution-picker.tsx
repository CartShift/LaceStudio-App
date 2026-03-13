"use client";

import { useMemo } from "react";

type AspectOption = {
	label: string;
	ratio: string;
	w: number;
	h: number;
	icon: string;
};

type ResolutionTier = {
	label: string;
	key: "standard" | "hd" | "ultra";
	multiplier: number;
	badge: string;
};

const ASPECT_OPTIONS: AspectOption[] = [
	{ label: "Square", ratio: "1:1", w: 1, h: 1, icon: "■" },
	{ label: "Portrait", ratio: "3:4", w: 3, h: 4, icon: "▯" },
	{ label: "Landscape", ratio: "4:3", w: 4, h: 3, icon: "▬" },
	{ label: "Story", ratio: "9:16", w: 9, h: 16, icon: "▮" },
	{ label: "Wide", ratio: "16:9", w: 16, h: 9, icon: "━" },
	{ label: "Photo", ratio: "2:3", w: 2, h: 3, icon: "▯" },
	{ label: "Poster", ratio: "4:5", w: 4, h: 5, icon: "▯" },
	{ label: "Cinema", ratio: "21:9", w: 21, h: 9, icon: "━" }
];

const RESOLUTION_TIERS: ResolutionTier[] = [
	{ label: "Standard", key: "standard", multiplier: 1024, badge: "1K" },
	{ label: "HD", key: "hd", multiplier: 1920, badge: "2K" },
	{ label: "Ultra", key: "ultra", multiplier: 3840, badge: "4K" }
];

export function ResolutionPicker({ width, height, onResize }: { width: number; height: number; onResize: (w: number, h: number) => void }) {
	const currentRatio = width / Math.max(height, 1);
	const currentMaxDim = Math.max(width, height);

	const matchedAspect = useMemo(() => {
		let best = ASPECT_OPTIONS[0]!;
		let bestDelta = Infinity;
		for (const option of ASPECT_OPTIONS) {
			const delta = Math.abs(option.w / option.h - currentRatio);
			if (delta < bestDelta) {
				best = option;
				bestDelta = delta;
			}
		}
		return best;
	}, [currentRatio]);

	const matchedTier = useMemo(() => {
		if (currentMaxDim >= 3200) return "ultra";
		if (currentMaxDim >= 1600) return "hd";
		return "standard";
	}, [currentMaxDim]);

	function applySelection(aspect: AspectOption, tier: ResolutionTier) {
		const maxDim = tier.multiplier;
		const isLandscape = aspect.w >= aspect.h;
		const w = isLandscape ? maxDim : Math.round(maxDim * (aspect.w / aspect.h));
		const h = isLandscape ? Math.round(maxDim * (aspect.h / aspect.w)) : maxDim;
		onResize(w, h);
	}

	return (
		<div className="space-y-3">
			<div>
				<p className="mb-1.5 text-xs font-medium text-muted-foreground">Aspect Ratio</p>
				<div className="flex flex-wrap gap-1.5">
					{ASPECT_OPTIONS.map(option => {
						const isActive = matchedAspect.ratio === option.ratio;
						return (
							<button
								key={option.ratio}
								type="button"
								onClick={() => {
									const tier = RESOLUTION_TIERS.find(t => t.key === matchedTier) ?? RESOLUTION_TIERS[0]!;
									applySelection(option, tier);
								}}
								className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all ${
									isActive ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
								}`}>
								<span className="opacity-60">{option.icon}</span>
								<span>{option.ratio}</span>
							</button>
						);
					})}
				</div>
			</div>

			<div>
				<p className="mb-1.5 text-xs font-medium text-muted-foreground">Resolution</p>
				<div className="flex gap-1.5">
					{RESOLUTION_TIERS.map(tier => {
						const isActive = matchedTier === tier.key;
						return (
							<button
								key={tier.key}
								type="button"
								onClick={() => applySelection(matchedAspect, tier)}
								className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
									isActive ? "border-primary bg-primary/10 text-primary shadow-sm" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
								}`}>
								<span>{tier.label}</span>
								<span className={`rounded px-1 py-0.5 text-[10px] font-bold ${isActive ? "bg-primary/20" : "bg-muted"}`}>{tier.badge}</span>
							</button>
						);
					})}
				</div>
			</div>

			<div className="flex items-center gap-3">
				<div
					className="border border-primary/30 bg-primary/5 rounded"
					style={{
						width: `${Math.min(40, 40 * (matchedAspect.w / Math.max(matchedAspect.w, matchedAspect.h)))}px`,
						height: `${Math.min(40, 40 * (matchedAspect.h / Math.max(matchedAspect.w, matchedAspect.h)))}px`
					}}
				/>
				<p className="text-xs text-muted-foreground">
					{width} × {height}px · {matchedAspect.ratio} · {RESOLUTION_TIERS.find(t => t.key === matchedTier)?.badge ?? "1K"}
				</p>
			</div>
		</div>
	);
}
