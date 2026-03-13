"use client";

import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/cn";

export function SliderWithPreview({
	value,
	onChange,
	min = 0,
	max = 1,
	step = 0.01,
	label,
	minEmoji,
	maxEmoji,
	formatValue,
	className
}: {
	value: number;
	onChange: (value: number) => void;
	min?: number;
	max?: number;
	step?: number;
	label?: string;
	minEmoji?: string;
	maxEmoji?: string;
	formatValue?: (value: number) => string;
	className?: string;
}) {
	const safeRange = max - min === 0 ? 1 : max - min;
	const normalizedValue = Math.min(max, Math.max(min, value));
	const pct = ((normalizedValue - min) / safeRange) * 100;
	const displayValue = formatValue ? formatValue(normalizedValue) : normalizedValue.toFixed(2);

	return (
		<div className={cn("space-y-1.5", className)}>
			{label ? (
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-medium text-foreground">{label}</span>
					<span className="rounded-md bg-[color:color-mix(in_oklab,var(--color-primary),transparent_85%)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-foreground">{displayValue}</span>
				</div>
			) : null}
			<div className="flex items-center gap-2.5">
				{minEmoji ? <span className="text-sm">{minEmoji}</span> : null}
				<Slider
					value={[normalizedValue]}
					onValueChange={([nextValue]) => {
						if (typeof nextValue === "number") onChange(nextValue);
					}}
					min={min}
					max={max}
					step={step}
					aria-label={label ?? "Slider value"}
					className={cn(
						"flex-1 [&_[data-slot='slider-range']]:bg-[linear-gradient(90deg,var(--color-primary),color-mix(in_oklab,var(--color-primary),var(--status-success)_42%))] [&_[data-slot='slider-thumb']]:border-[color:color-mix(in_oklab,var(--primary),transparent_60%)] [&_[data-slot='slider-thumb']]:shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary),transparent_88%),0_6px_18px_color-mix(in_oklab,var(--primary),transparent_74%)] [&_[data-slot='slider-track']]:bg-muted/60 [&_[data-slot='slider-track']]:shadow-inner",
					)}
				/>
				{maxEmoji ? <span className="text-sm">{maxEmoji}</span> : null}
			</div>
			<div className="h-1 rounded-full bg-[linear-gradient(90deg,color-mix(in_oklab,var(--color-primary),transparent_90%),color-mix(in_oklab,var(--color-primary),transparent_22%))]" style={{ width: `${pct}%` }} />
		</div>
	);
}
