"use client";

import { EditorialCard } from "@/components/ui/editorial-card";
import { OptionCardGrid } from "@/components/ui/option-card-grid";
import { ChipInput } from "@/components/ui/chip-input";
import { Textarea } from "@/components/ui/textarea";
import type { PersonalityDraft } from "@/components/models/types";

const VOICE_OPTIONS = [
	{ value: "warm" as const, label: "Warm", emoji: "🌸" },
	{ value: "witty" as const, label: "Witty", emoji: "🎭" },
	{ value: "playful" as const, label: "Playful", emoji: "🎪" },
	{ value: "minimal" as const, label: "Minimal", emoji: "🔇" },
	{ value: "bold" as const, label: "Bold", emoji: "🔥" }
];

const TEMPERAMENT_OPTIONS = [
	{ value: "calm" as const, label: "Calm", emoji: "🧘" },
	{ value: "energetic" as const, label: "Energetic", emoji: "⚡" },
	{ value: "mysterious" as const, label: "Mysterious", emoji: "🌙" },
	{ value: "confident" as const, label: "Confident", emoji: "👑" },
	{ value: "soft" as const, label: "Soft", emoji: "🕊️" }
];

const CAPTION_TONE_OPTIONS = [
	{ value: "casual" as const, label: "Casual", emoji: "☕" },
	{ value: "editorial" as const, label: "Editorial", emoji: "📖" },
	{ value: "storytelling" as const, label: "Story", emoji: "📝" },
	{ value: "aspirational" as const, label: "Aspire", emoji: "🌟" }
];

const EMOJI_USAGE_OPTIONS = [
	{ value: "none" as const, label: "None", emoji: "🚫" },
	{ value: "minimal" as const, label: "Minimal", emoji: "😊" },
	{ value: "moderate" as const, label: "Moderate", emoji: "🎉" }
];

const LANGUAGE_STYLE_OPTIONS = [
	{ value: "concise" as const, label: "Concise", emoji: "⚡" },
	{ value: "balanced" as const, label: "Balanced", emoji: "⚖️" },
	{ value: "expressive" as const, label: "Expressive", emoji: "🎨" }
];

const INTEREST_SUGGESTIONS = ["fashion", "fitness", "travel", "cooking", "art", "music", "tech", "gaming", "beauty", "reading"];
const BOUNDARY_SUGGESTIONS = ["No explicit content", "No political endorsements", "No alcohol promotion", "Family-friendly only"];

export function StepPersonality({ value, showAdvanced, onChange }: { value: PersonalityDraft; showAdvanced: boolean; onChange: (next: PersonalityDraft) => void }) {
	return (
		<EditorialCard className="space-y-5">
			<div>
				<h2 className="font-display text-2xl">🎭 Personality</h2>
				<p className="text-sm text-muted-foreground">Shape how your model talks and feels — pick the vibe that fits.</p>
			</div>

			{/* Voice */}
			<div>
				<p className="mb-2 text-xs font-semibold text-muted-foreground">Social Voice</p>
				<OptionCardGrid options={VOICE_OPTIONS} value={value.social_voice} onChange={social_voice => onChange({ ...value, social_voice })} columns={5} />
			</div>

			{/* Temperament */}
			<div>
				<p className="mb-2 text-xs font-semibold text-muted-foreground">Temperament</p>
				<OptionCardGrid options={TEMPERAMENT_OPTIONS} value={value.temperament} onChange={temperament => onChange({ ...value, temperament })} columns={5} />
			</div>

			{/* Interests */}
			<div>
				<p className="mb-2 text-xs font-semibold text-muted-foreground">Interests</p>
				<ChipInput value={value.interests} onChange={interests => onChange({ ...value, interests })} suggestions={INTEREST_SUGGESTIONS} placeholder="Type an interest…" max={12} />
			</div>

			{/* Boundaries */}
			<div>
				<p className="mb-2 text-xs font-semibold text-muted-foreground">Boundaries</p>
				<ChipInput value={value.boundaries} onChange={boundaries => onChange({ ...value, boundaries })} suggestions={BOUNDARY_SUGGESTIONS} placeholder="Type a boundary…" max={8} />
			</div>

			{/* Communication Style */}
			<div className="space-y-3 rounded-2xl border border-border/50 bg-card/30 p-3">
				<p className="text-xs font-semibold text-muted-foreground">Communication Style</p>
				<div className="grid gap-4 md:grid-cols-3">
					<div>
						<p className="mb-1.5 text-[11px] text-muted-foreground/70">Caption Tone</p>
						<OptionCardGrid
							options={CAPTION_TONE_OPTIONS}
							value={value.communication_style.caption_tone}
							onChange={caption_tone =>
								onChange({
									...value,
									communication_style: { ...value.communication_style, caption_tone }
								})
							}
							columns={2}
							size="sm"
						/>
					</div>
					<div>
						<p className="mb-1.5 text-[11px] text-muted-foreground/70">Emoji Usage</p>
						<OptionCardGrid
							options={EMOJI_USAGE_OPTIONS}
							value={value.communication_style.emoji_usage}
							onChange={emoji_usage =>
								onChange({
									...value,
									communication_style: { ...value.communication_style, emoji_usage }
								})
							}
							columns={3}
							size="sm"
						/>
					</div>
					<div>
						<p className="mb-1.5 text-[11px] text-muted-foreground/70">Language Style</p>
						<OptionCardGrid
							options={LANGUAGE_STYLE_OPTIONS}
							value={value.communication_style.language_style}
							onChange={language_style =>
								onChange({
									...value,
									communication_style: { ...value.communication_style, language_style }
								})
							}
							columns={3}
							size="sm"
						/>
					</div>
				</div>
			</div>

			{showAdvanced ? (
				<div>
					<p className="mb-1 text-xs font-medium text-muted-foreground">Personality Notes</p>
					<Textarea rows={3} value={value.notes ?? ""} onChange={e => onChange({ ...value, notes: e.target.value })} placeholder="Extra personality context…" />
				</div>
			) : null}
		</EditorialCard>
	);
}
