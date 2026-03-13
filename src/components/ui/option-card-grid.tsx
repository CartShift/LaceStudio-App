"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/cn";

export type OptionCardItem<T extends string = string> = {
	value: T;
	label: string;
	emoji?: string;
	description?: string;
};

export function OptionCardGrid<T extends string = string>({
	options,
	value,
	onChange,
	columns = 3,
	size = "md",
	className
}: {
	options: OptionCardItem<T>[];
	value: T;
	onChange: (value: T) => void;
	columns?: 2 | 3 | 4 | 5 | 6;
	size?: "sm" | "md";
	className?: string;
}) {
	const colClass =
		columns === 2 ? "grid-cols-2" : columns === 3 ? "grid-cols-3" : columns === 4 ? "sm:grid-cols-4 grid-cols-3" : columns === 5 ? "sm:grid-cols-5 grid-cols-3" : "sm:grid-cols-6 grid-cols-3";

	return (
		<ToggleGroup
			type="single"
			value={value}
			onValueChange={nextValue => {
				if (nextValue) onChange(nextValue as T);
			}}
			className={cn("grid w-full gap-2", colClass, className)}>
			{options.map(opt => {
				return (
					<ToggleGroupItem
						key={opt.value}
						value={opt.value}
						aria-label={opt.label}
						className={cn(
							"group relative h-auto w-full min-w-0 flex-col items-center overflow-hidden rounded-[1.15rem] border text-center whitespace-normal shadow-none transition-[transform,box-shadow,border-color,background-color,color] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklab,var(--ring),transparent_58%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
							size === "sm" ? "min-h-[78px] gap-1 px-2.5 py-2.5 text-[11px]" : "min-h-[108px] gap-1.5 px-3.5 py-3.5 text-xs",
							"data-[state=on]:scale-[1.02] data-[state=on]:border-[color:color-mix(in_oklab,var(--primary),transparent_44%)] data-[state=on]:bg-[linear-gradient(160deg,color-mix(in_oklab,var(--primary),transparent_84%),color-mix(in_oklab,var(--card),transparent_0%)_60%)] data-[state=on]:shadow-[0_0_18px_rgba(var(--color-primary-rgb,99,102,241),0.18),var(--shadow-inner)]",
							"data-[state=off]:border-border/70 data-[state=off]:bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--card),transparent_0%)_58%,color-mix(in_oklab,var(--accent),transparent_96%))] data-[state=off]:hover:-translate-y-0.5 data-[state=off]:hover:border-[color:color-mix(in_oklab,var(--primary),transparent_66%)] data-[state=off]:hover:bg-[linear-gradient(160deg,color-mix(in_oklab,var(--accent),transparent_84%),color-mix(in_oklab,var(--card),transparent_0%)_62%)] data-[state=off]:hover:shadow-[var(--shadow-soft)]"
						)}>
						<span
							aria-hidden
							className={cn(
								"pointer-events-none absolute inset-x-0 top-0 h-12 bg-[radial-gradient(circle_at_50%_0%,color-mix(in_oklab,var(--primary),transparent_88%),transparent_70%)] opacity-0 transition-opacity duration-200",
								"group-data-[state=on]:opacity-100"
							)}
						/>
						{opt.emoji ? <span className={cn("relative transition-transform duration-200 group-data-[state=on]:scale-110", size === "sm" ? "text-lg" : "text-2xl")}>{opt.emoji}</span> : null}
						<span className="relative font-medium leading-tight text-muted-foreground group-data-[state=on]:text-foreground">{opt.label}</span>
						{opt.description && size !== "sm" ? <span className="relative line-clamp-2 text-[10px] leading-snug text-muted-foreground/72">{opt.description}</span> : null}
						<div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-foreground)] opacity-0 shadow-[0_8px_18px_rgba(var(--color-primary-rgb,99,102,241),0.28)] transition-opacity group-data-[state=on]:opacity-100">
							<svg viewBox="0 0 24 24" className="h-3 w-3 fill-none stroke-current" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
								<polyline points="20 6 9 17 4 12" />
							</svg>
						</div>
					</ToggleGroupItem>
				);
			})}
		</ToggleGroup>
	);
}
