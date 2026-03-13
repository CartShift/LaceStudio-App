"use client";

const POSE_SUGGESTIONS: Record<string, string[]> = {
	editorial: [
		"Standing confidently against a minimalist concrete backdrop, golden hour light",
		"Looking over shoulder with wind-swept hair, muted studio environment",
		"Leaning against a textured wall, editorial fashion magazine composition"
	],
	casual: [
		"Relaxed seated pose on a café terrace, natural daylight",
		"Walking through a sun-drenched European street, candid movement",
		"Laughing naturally while adjusting sunglasses, lifestyle photo"
	],
	jewelry_focus: [
		"Close-up of hands and wrists showcasing delicate jewelry, soft studio lighting",
		"Tilting chin up to highlight necklace, dramatic side lighting",
		"Fingers gently touching earring, macro detail shot"
	],
	seated: ["Seated on a designer chair in a modern loft, relaxed editorial pose", "Cross-legged on a plush sofa, warm interior lighting", "Perched on stairs, legs crossed, looking at camera"],
	walking: [
		"Mid-stride on a covered walkway, fabric flowing with movement",
		"Walking toward camera on a rain-wet street, cinematic atmosphere",
		"Striding confidently through a gallery space, motion blur background"
	]
};

const LENS_SUGGESTIONS: Record<string, string[]> = {
	"35mm_doc": ["Documentary-style street scene", "Gritty urban environment", "Natural reportage lighting"],
	"50mm_portrait": ["Classic portrait with bokeh background", "Warm natural window light", "Intimate head-and-shoulders composition"],
	"85mm_editorial": ["Magazine editorial setup", "Controlled studio environment", "Professional beauty lighting"],
	"105mm_beauty": ["Extreme close-up beauty shot", "Flawless skin detail macro", "Ring light beauty setup"]
};

const MOOD_SUGGESTIONS: Record<string, string[]> = {
	"editorial luxe": ["Champagne tones, marble surfaces, velvet textures"],
	"quiet luxury": ["Muted earth tones, cashmere draping, understated elegance"],
	"runway minimal": ["Clean white studio, sharp geometric shadows, stark contrast"],
	"cinematic portrait": ["Dramatic chiaroscuro lighting, film grain, moody atmosphere"],
	"jewelry focus": ["Close macro detail, sparkling highlights, soft metallic reflections"]
};

export function PromptSuggestions({ posePreset, lensSimulation, moodTags, onSelect }: { posePreset?: string; lensSimulation?: string; moodTags?: string[]; onSelect: (suggestion: string) => void }) {
	const suggestions: string[] = [];

	if (posePreset && POSE_SUGGESTIONS[posePreset]) {
		suggestions.push(...POSE_SUGGESTIONS[posePreset]);
	}

	if (lensSimulation && LENS_SUGGESTIONS[lensSimulation]) {
		suggestions.push(...LENS_SUGGESTIONS[lensSimulation]);
	}

	if (moodTags) {
		for (const tag of moodTags) {
			const lower = tag.toLowerCase();
			if (MOOD_SUGGESTIONS[lower]) {
				suggestions.push(...MOOD_SUGGESTIONS[lower]);
			}
		}
	}

	const unique = [...new Set(suggestions)].slice(0, 6);

	if (unique.length === 0) return null;

	return (
		<div className="space-y-1.5">
			<p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Quick prompt ideas</p>
			<div className="flex flex-wrap gap-1.5">
				{unique.map(suggestion => (
					<button
						key={suggestion}
						type="button"
						onClick={() => onSelect(suggestion)}
						className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-foreground">
						{suggestion.length > 52 ? `${suggestion.slice(0, 49)}…` : suggestion}
					</button>
				))}
			</div>
		</div>
	);
}
