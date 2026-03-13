"use client";

import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { EditorialCard } from "@/components/ui/editorial-card";
import { SliderWithPreview } from "@/components/ui/slider-with-preview";
import type { SocialTracksDraft } from "@/components/models/types";

export function StepSocialStrategy({ value, showAdvanced, onChange }: { value: SocialTracksDraft; showAdvanced: boolean; onChange: (next: SocialTracksDraft) => void }) {
	const totalRatio = value.reality_like_daily.target_ratio_percent + value.fashion_editorial.target_ratio_percent;

	function handleRatioChange(realityPercent: number) {
		const clamped = Math.round(Math.max(0, Math.min(100, realityPercent)));
		onChange({
			...value,
			reality_like_daily: { ...value.reality_like_daily, target_ratio_percent: clamped },
			fashion_editorial: { ...value.fashion_editorial, target_ratio_percent: 100 - clamped }
		});
	}

	return (
		<EditorialCard className="space-y-5">
			<div>
				<h2 className="font-display text-2xl">📊 Social Strategy</h2>
				<p className="text-sm text-muted-foreground">Balance two content streams — drag the slider to split.</p>
			</div>

			{/* Visual ratio slider */}
			<div className="space-y-2 rounded-2xl border border-border/50 bg-card/30 p-4">
				<div className="flex items-center justify-between text-xs font-semibold">
					<span className="flex items-center gap-1.5">
						<span className="text-base">📸</span> Reality-like Daily
						<span className="rounded-md bg-[color:color-mix(in_oklab,var(--color-primary),transparent_85%)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
							{value.reality_like_daily.target_ratio_percent}%
						</span>
					</span>
					<span className="flex items-center gap-1.5">
						<span className="rounded-md bg-[color:color-mix(in_oklab,var(--status-success),transparent_85%)] px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
							{value.fashion_editorial.target_ratio_percent}%
						</span>
						Fashion Editorial <span className="text-base">👗</span>
					</span>
				</div>
				<div className="relative px-1">
					<div className="absolute inset-x-1 top-1/2 h-4 -translate-y-1/2 overflow-hidden rounded-full border border-border/50 shadow-inner">
						<div
							className="h-full bg-gradient-to-r from-[var(--color-primary)] to-[color:color-mix(in_oklab,var(--color-primary),transparent_30%)] transition-all duration-200"
							style={{ width: `${value.reality_like_daily.target_ratio_percent}%` }}
						/>
						<div
							className="absolute inset-y-0 right-0 bg-gradient-to-r from-[color:color-mix(in_oklab,var(--status-success),transparent_30%)] to-[var(--status-success)] transition-all duration-200"
							style={{ width: `${value.fashion_editorial.target_ratio_percent}%` }}
						/>
					</div>
					<Slider
						value={[value.reality_like_daily.target_ratio_percent]}
						onValueChange={([nextValue]) => {
							if (typeof nextValue === "number") handleRatioChange(nextValue);
						}}
						min={0}
						max={100}
						step={5}
						aria-label="Reality-like Daily ratio"
						className="relative z-10 py-1.5 [&_[data-slot='slider-range']]:bg-transparent [&_[data-slot='slider-thumb']]:size-6 [&_[data-slot='slider-thumb']]:border-border/70 [&_[data-slot='slider-thumb']]:bg-card [&_[data-slot='slider-thumb']]:shadow-[0_0_14px_color-mix(in_oklab,var(--foreground),transparent_84%)] [&_[data-slot='slider-track']]:h-4 [&_[data-slot='slider-track']]:bg-transparent [&_[data-slot='slider-track']]:shadow-none"
					/>
				</div>
			</div>

			{totalRatio !== 100 ? <StateBlock tone="neutral" title="Track Ratio Must Equal 100%" description={`Current ratio total is ${totalRatio}%. Use the slider to balance.`} /> : null}

			{/* Track cards */}
			<div className="grid gap-3 xl:grid-cols-2">
				<TrackCard
					emoji="📸"
					title="Reality-like Daily"
					percent={value.reality_like_daily.target_ratio_percent}
					track={value.reality_like_daily}
					showAdvanced={showAdvanced}
					onChange={track => onChange({ ...value, reality_like_daily: track })}
				/>
				<TrackCard
					emoji="👗"
					title="Fashion Editorial"
					percent={value.fashion_editorial.target_ratio_percent}
					track={value.fashion_editorial}
					showAdvanced={showAdvanced}
					onChange={track => onChange({ ...value, fashion_editorial: track })}
				/>
			</div>
		</EditorialCard>
	);
}

function TrackCard({
	emoji,
	title,
	percent,
	track,
	showAdvanced,
	onChange
}: {
	emoji: string;
	title: string;
	percent: number;
	track: SocialTracksDraft["reality_like_daily"];
	showAdvanced: boolean;
	onChange: (next: SocialTracksDraft["reality_like_daily"]) => void;
}) {
	return (
		<div className="space-y-3 rounded-2xl border border-border/50 bg-card/40 p-4">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="text-xl">{emoji}</span>
					<h3 className="text-sm font-semibold">{title}</h3>
				</div>
				<span className="rounded-lg bg-muted/60 px-2 py-0.5 text-[11px] font-bold tabular-nums text-muted-foreground">{percent}%</span>
			</div>

			<div>
				<p className="mb-1 text-xs font-medium text-muted-foreground">Style Brief</p>
				<Textarea rows={2} value={track.style_brief} onChange={e => onChange({ ...track, style_brief: e.target.value })} placeholder="Describe the visual style…" />
			</div>

			<SliderWithPreview
				label="Weekly Post Goal"
				value={track.weekly_post_goal}
				onChange={v => onChange({ ...track, weekly_post_goal: Math.round(v) })}
				min={0}
				max={14}
				step={1}
				minEmoji="0️⃣"
				maxEmoji="🔥"
				formatValue={v => `${Math.round(v)} posts/week`}
			/>

			{showAdvanced ? (
				<div>
					<p className="mb-1 text-xs font-medium text-muted-foreground">Prompt Bias</p>
					<Input
						value={track.prompt_bias ?? ""}
						onChange={e => onChange({ ...track, prompt_bias: e.target.value })}
						placeholder="cinematic daylight realism"
					/>
				</div>
			) : null}
		</div>
	);
}
