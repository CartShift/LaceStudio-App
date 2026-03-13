"use client";

import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";

type XpSegment = {
	key: string;
	label: string;
	done: boolean;
	active: boolean;
};

export function XpProgressBar({ segments, className, onSegmentClick }: { segments: XpSegment[]; className?: string; onSegmentClick?: (key: string) => void }) {
	const completedCount = segments.filter(s => s.done).length;
	const total = segments.length;
	const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;

	return (
		<div className={cn("space-y-3", className)}>
			{/* XP bar track */}
			<div className="relative">
				<div className="flex items-center justify-between gap-1 px-1 text-[10px] font-semibold text-muted-foreground">
					<span className="font-subheader tracking-wider uppercase">Progress</span>
					<span className="tabular-nums">{pct}% Complete</span>
				</div>
				<div className="relative mt-1.5">
					<Progress
						value={pct}
						aria-label="Progress"
						className="h-3 bg-muted/60 shadow-inner [&_[data-slot='progress-indicator']]:bg-gradient-to-r [&_[data-slot='progress-indicator']]:from-[var(--color-primary)] [&_[data-slot='progress-indicator']]:via-[color:color-mix(in_oklab,var(--color-primary),var(--status-success)_40%)] [&_[data-slot='progress-indicator']]:to-[var(--status-success)] [&_[data-slot='progress-indicator']]:duration-700"
					/>
					{pct > 0 && pct < 100 && <div className="absolute inset-y-0 w-6 animate-pulse rounded-full bg-muted-foreground/35 blur-sm" style={{ left: `calc(${pct}% - 12px)` }} />}
					{pct >= 100 && <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-transparent via-muted-foreground/20 to-transparent" />}
				</div>
			</div>

			{/* Step nodes */}
			<div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${total}, 1fr)` }}>
				{segments.map((seg, i) => (
					<button
						key={seg.key}
						type="button"
						onClick={() => onSegmentClick?.(seg.key)}
						className={cn(
							"group relative flex flex-col items-center gap-1.5 rounded-xl border px-2 py-2 text-center transition-all duration-200",
							seg.active
								? "border-[var(--color-primary)] bg-[color:color-mix(in_oklab,var(--color-primary),transparent_88%)] shadow-[0_0_12px_rgba(var(--color-primary-rgb,99,102,241),0.2)]"
								: seg.done
									? "border-[var(--status-success-border)] bg-[color:color-mix(in_oklab,var(--status-success-bg),white_8%)]"
									: "border-border/60 bg-card/40 hover:border-border hover:bg-card/70"
						)}>
						<div
							className={cn(
								"flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-all duration-300",
								seg.done
									? "bg-[var(--status-success)] text-background shadow-[0_0_8px_color-mix(in_oklab,var(--status-success),transparent_70%)]"
									: seg.active
										? "border-2 border-[var(--color-primary)] bg-[color:color-mix(in_oklab,var(--color-primary),transparent_80%)] text-[var(--color-primary)] shadow-[0_0_10px_rgba(var(--color-primary-rgb,99,102,241),0.25)]"
										: "border border-border bg-muted/50 text-muted-foreground"
							)}>
							{seg.done ? (
								<svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
									<polyline points="20 6 9 17 4 12" />
								</svg>
							) : (
								i + 1
							)}
						</div>
						<span className={cn("text-[10px] font-medium leading-tight", seg.active ? "text-foreground" : seg.done ? "text-[var(--status-success)]" : "text-muted-foreground")}>{seg.label}</span>
					</button>
				))}
			</div>
		</div>
	);
}
