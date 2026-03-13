"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EditorialCard } from "@/components/ui/editorial-card";
import { OptionCardGrid } from "@/components/ui/option-card-grid";
import { ChipInput } from "@/components/ui/chip-input";
import { SelectField } from "@/components/ui/select";
import { SliderWithPreview } from "@/components/ui/slider-with-preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CharacterDesignDraft } from "@/components/models/types";

type SubTab = "body" | "face" | "details";

const BUILD_OPTIONS = [
	{ value: "petite" as const, label: "Petite", emoji: "🧬" },
	{ value: "slim" as const, label: "Slim", emoji: "🦢" },
	{ value: "athletic" as const, label: "Athletic", emoji: "💪" },
	{ value: "curvy" as const, label: "Curvy", emoji: "✨" },
	{ value: "muscular" as const, label: "Muscular", emoji: "🏋️" },
	{ value: "average" as const, label: "Average", emoji: "🧍" }
];

const HAIR_LENGTH_OPTIONS = [
	{ value: "shaved" as const, label: "Shaved", emoji: "🪒" },
	{ value: "short" as const, label: "Short", emoji: "💇" },
	{ value: "medium" as const, label: "Medium", emoji: "💁" },
	{ value: "long" as const, label: "Long", emoji: "👩" },
	{ value: "very_long" as const, label: "Very Long", emoji: "🧜" }
];

const FACE_SHAPE_OPTIONS = [
	{ value: "oval" as const, label: "Oval", emoji: "🥚" },
	{ value: "round" as const, label: "Round", emoji: "🌕" },
	{ value: "square" as const, label: "Square", emoji: "⬜" },
	{ value: "heart" as const, label: "Heart", emoji: "💜" },
	{ value: "diamond" as const, label: "Diamond", emoji: "💎" },
	{ value: "oblong" as const, label: "Oblong", emoji: "📏" }
];

const JAWLINE_OPTIONS = [
	{ value: "soft" as const, label: "Soft", emoji: "☁️" },
	{ value: "defined" as const, label: "Defined", emoji: "📐" },
	{ value: "angular" as const, label: "Angular", emoji: "⚡" }
];

const CHEEKBONE_OPTIONS = [
	{ value: "soft" as const, label: "Soft", emoji: "🌸" },
	{ value: "defined" as const, label: "Defined", emoji: "🔹" },
	{ value: "prominent" as const, label: "Prominent", emoji: "🏔️" }
];

const FEATURE_SUGGESTIONS = ["faint freckles", "beauty mark", "dimples", "small scar", "piercing", "mole", "birthmark", "gap tooth"];

export function StepCharacterDesign({ value, showAdvanced, onChange }: { value: CharacterDesignDraft; showAdvanced: boolean; onChange: (next: CharacterDesignDraft) => void }) {
	const [subTab, setSubTab] = useState<SubTab>("body");

	const bodyComplete = value.body_profile.skin_tone.trim().length > 0 && value.body_profile.hair_color.trim().length > 0;
	const faceComplete = true; // defaults are always valid
	const detailsComplete = value.body_profile.distinguishing_features.length > 0;

	return (
		<EditorialCard className="space-y-4">
			<div>
				<h2 className="font-display text-2xl">🎨 Character Design</h2>
				<p className="text-sm text-muted-foreground">Build your Model visual identity and shape the look step by step.</p>
			</div>

			<Tabs value={subTab} onValueChange={value => setSubTab(value as SubTab)} className="gap-4">
				<TabsList className="grid h-auto w-full grid-cols-3 rounded-xl border border-border/60 bg-muted/30 p-1">
					{(
						[
							{ key: "body" as const, label: "🧬 Body", done: bodyComplete },
							{ key: "face" as const, label: "👤 Face", done: faceComplete },
							{ key: "details" as const, label: "✨ Details", done: detailsComplete }
						] as const
					).map(tab => (
						<TabsTrigger
							key={tab.key}
							value={tab.key}
							className="h-auto gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-muted-foreground transition-all duration-200 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm">
							<span>{tab.label}</span>
							{tab.done ? <span className="inline-flex size-4 items-center justify-center rounded-full bg-[var(--status-success)] text-[10px] text-background">✓</span> : null}
						</TabsTrigger>
					))}
				</TabsList>

				<TabsContent value="body" className="space-y-4 animate-in fade-in-50 slide-in-from-right-2 duration-200">
					<div>
						<p className="mb-2 text-xs font-semibold text-muted-foreground">Build Type</p>
						<OptionCardGrid
							options={BUILD_OPTIONS}
							value={value.body_profile.build}
							onChange={build =>
								onChange({
									...value,
									body_profile: { ...value.body_profile, build }
								})
							}
							columns={6}
							size="sm"
						/>
					</div>

					<SliderWithPreview
						label="Height"
						value={value.body_profile.height_cm}
						onChange={height_cm =>
							onChange({
								...value,
								body_profile: { ...value.body_profile, height_cm: Math.round(height_cm) }
							})
						}
						min={140}
						max={210}
						step={1}
						minEmoji="📏"
						maxEmoji="📐"
						formatValue={v => `${Math.round(v)} cm`}
					/>

					<div className="grid gap-3 md:grid-cols-2">
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Skin Tone</p>
							<Input
								value={value.body_profile.skin_tone}
								onChange={e =>
									onChange({
										...value,
										body_profile: { ...value.body_profile, skin_tone: e.target.value }
									})
								}
								placeholder="e.g. light olive, deep brown"
							/>
						</div>
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Eye Color</p>
							<Input
								value={value.body_profile.eye_color}
								onChange={e =>
									onChange({
										...value,
										body_profile: { ...value.body_profile, eye_color: e.target.value }
									})
								}
								placeholder="e.g. hazel, dark brown"
							/>
						</div>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Hair Color</p>
							<Input
								value={value.body_profile.hair_color}
								onChange={e =>
									onChange({
										...value,
										body_profile: { ...value.body_profile, hair_color: e.target.value }
									})
								}
								placeholder="e.g. honey blonde"
							/>
						</div>
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Hair Style</p>
							<Input
								value={value.body_profile.hair_style}
								onChange={e =>
									onChange({
										...value,
										body_profile: { ...value.body_profile, hair_style: e.target.value }
									})
								}
								placeholder="e.g. soft wave, straight"
							/>
						</div>
					</div>

					<div>
						<p className="mb-2 text-xs font-semibold text-muted-foreground">Hair Length</p>
						<OptionCardGrid
							options={HAIR_LENGTH_OPTIONS}
							value={value.body_profile.hair_length}
							onChange={hair_length =>
								onChange({
									...value,
									body_profile: { ...value.body_profile, hair_length }
								})
							}
							columns={5}
							size="sm"
						/>
					</div>

					{showAdvanced ? (
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Body Ratio Notes</p>
							<Textarea
								rows={2}
								value={value.body_profile.advanced_traits.body_ratio_notes ?? ""}
								onChange={e =>
									onChange({
										...value,
										body_profile: {
											...value.body_profile,
											advanced_traits: {
												...value.body_profile.advanced_traits,
												body_ratio_notes: e.target.value || undefined
											}
										}
									})
								}
								placeholder="Optional notes on body proportions"
							/>
						</div>
					) : null}
				</TabsContent>

				<TabsContent value="face" className="space-y-4 animate-in fade-in-50 slide-in-from-right-2 duration-200">
					<div>
						<p className="mb-2 text-xs font-semibold text-muted-foreground">Face Shape</p>
						<OptionCardGrid
							options={FACE_SHAPE_OPTIONS}
							value={value.face_profile.face_shape}
							onChange={face_shape =>
								onChange({
									...value,
									face_profile: { ...value.face_profile, face_shape }
								})
							}
							columns={6}
							size="sm"
						/>
					</div>

					<div className="grid gap-3 md:grid-cols-2">
						<div>
							<p className="mb-2 text-xs font-semibold text-muted-foreground">Jawline</p>
							<OptionCardGrid
								options={JAWLINE_OPTIONS}
								value={value.face_profile.jawline}
								onChange={jawline =>
									onChange({
										...value,
										face_profile: { ...value.face_profile, jawline }
									})
								}
								columns={3}
								size="sm"
							/>
						</div>
						<div>
							<p className="mb-2 text-xs font-semibold text-muted-foreground">Cheekbones</p>
							<OptionCardGrid
								options={CHEEKBONE_OPTIONS}
								value={value.face_profile.cheekbones}
								onChange={cheekbones =>
									onChange({
										...value,
										face_profile: { ...value.face_profile, cheekbones }
									})
								}
								columns={3}
								size="sm"
							/>
						</div>
					</div>

					{showAdvanced ? (
						<div>
							<p className="mb-1 text-xs font-medium text-muted-foreground">Face Micro-Asymmetry Notes</p>
							<Textarea
								rows={2}
								value={value.face_profile.advanced_traits.micro_asymmetry_notes ?? ""}
								onChange={e =>
									onChange({
										...value,
										face_profile: {
											...value.face_profile,
											advanced_traits: {
												...value.face_profile.advanced_traits,
												micro_asymmetry_notes: e.target.value || undefined
											}
										}
									})
								}
								placeholder="Optional asymmetry notes"
							/>
						</div>
					) : null}
				</TabsContent>

				<TabsContent value="details" className="space-y-4 animate-in fade-in-50 slide-in-from-right-2 duration-200">
					<div>
						<p className="mb-2 text-xs font-semibold text-muted-foreground">Distinguishing Features</p>
						<ChipInput
							value={value.body_profile.distinguishing_features}
							onChange={features =>
								onChange({
									...value,
									body_profile: {
										...value.body_profile,
										distinguishing_features: features.slice(0, 10)
									}
								})
							}
							suggestions={FEATURE_SUGGESTIONS}
							placeholder="Type a feature and press Enter…"
							max={10}
						/>
					</div>

					<div>
						<p className="mb-2 text-xs font-semibold text-muted-foreground">Imperfection Fingerprint</p>
						<p className="mb-2 text-[11px] text-muted-foreground">Add up to 5 subtle details that make the character unique. These persist across all generated images.</p>
						<ImperfectionEditor value={value.imperfection_fingerprint} onChange={imperfection_fingerprint => onChange({ ...value, imperfection_fingerprint })} />
					</div>
				</TabsContent>
			</Tabs>
		</EditorialCard>
	);
}

/* ---- Imperfection mini-form (replaces pipe-separated text) ---- */

const IMPERFECTION_TYPES = ["freckles", "birthmark", "scar", "beauty mark", "dimple", "wrinkle", "pore texture", "asymmetry"];

function ImperfectionEditor({ value, onChange }: { value: CharacterDesignDraft["imperfection_fingerprint"]; onChange: (next: CharacterDesignDraft["imperfection_fingerprint"]) => void }) {
	function addItem() {
		if (value.length >= 5) return;
		onChange([...value, { type: "freckles", location: "", intensity: 0.3 }]);
	}

	function removeItem(index: number) {
		onChange(value.filter((_, i) => i !== index));
	}

	function updateItem(index: number, patch: Partial<CharacterDesignDraft["imperfection_fingerprint"][0]>) {
		onChange(value.map((item, i) => (i === index ? { ...item, ...patch } : item)));
	}

	return (
		<div className="space-y-2">
			{value.map((item, i) => (
				<div key={i} className="flex items-center gap-2 rounded-xl border border-border/60 bg-card/50 p-2 animate-in fade-in-50 zoom-in-95 duration-200">
					<SelectField
						value={item.type}
						onChange={e => updateItem(i, { type: e.target.value })}
						className="h-8 min-w-[9rem] rounded-lg px-2.5 py-1 text-xs"
					>
						{IMPERFECTION_TYPES.map(t => (
							<option key={t} value={t}>
								{t}
							</option>
						))}
					</SelectField>
					<Input value={item.location} onChange={e => updateItem(i, { location: e.target.value })} placeholder="Location (e.g. left cheek)" className="flex-1 text-xs" />
					<SliderWithPreview
						value={item.intensity}
						onChange={intensity => updateItem(i, { intensity: Math.round(intensity * 100) / 100 })}
						min={0}
						max={1}
						step={0.05}
						minEmoji="🔅"
						maxEmoji="🔆"
						className="w-28"
					/>
					<button
						type="button"
						onClick={() => removeItem(i)}
						className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive"
						aria-label="Remove">
						×
					</button>
				</div>
			))}
			{value.length < 5 ? (
				<button
					type="button"
					onClick={addItem}
					className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/60 bg-card/30 px-3 py-2 text-xs text-muted-foreground transition-all hover:border-[color:color-mix(in_oklab,var(--color-primary),transparent_50%)] hover:bg-card/60 hover:text-foreground">
					<span className="text-base">+</span> Add Imperfection
				</button>
			) : null}
		</div>
	);
}
