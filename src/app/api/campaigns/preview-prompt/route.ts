import { z } from "zod";
import { assertRole, getSessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { validateOrThrow } from "@/lib/request";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { creativeControlsSchema } from "@/server/schemas/creative";
import { buildCreativePromptFragments, createDefaultCreativeControls, mergeCreativeControls } from "@/server/services/creative-controls";

const previewSchema = z.object({
	prompt_text: z.string().min(1).max(4000),
	creative_controls: creativeControlsSchema.partial().optional()
});

export async function POST(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const session = await getSessionContext();
		assertRole(session.role, ["admin", "operator"]);

		const body = validateOrThrow(previewSchema, await request.json());

		const controls = mergeCreativeControls(createDefaultCreativeControls(), body.creative_controls);
		const fragments = buildCreativePromptFragments(controls);
		const additions = fragments.filter(fragment => !body.prompt_text.includes(fragment));

		const assembledPrompt = additions.length > 0 ? `${body.prompt_text}, ${additions.join(", ")}` : body.prompt_text;

		const promptLength = assembledPrompt.length;
		const referenceCount = controls.reference_board.items.length;

		const lowerPrompt = assembledPrompt.toLowerCase();

		const usesSearchGrounding = [
			"current",
			"weather",
			"forecast",
			"today",
			"yesterday",
			"last night",
			"recent",
			"latest",
			"news",
			"real-time",
			"stock",
			"score",
			"game",
			"match",
			"search",
			"find information",
			"look up",
			"what happened"
		].some(trigger => lowerPrompt.includes(trigger));

		const needsHighThinking =
			usesSearchGrounding ||
			referenceCount >= 8 ||
			promptLength > 700 ||
			/\b(text|title|heading|label|caption|sign|logo|infographic|menu|diagram|poster|typography)\b/.test(lowerPrompt) ||
			/\b(base image|refinement|inpaint|edit|modify|change only|preserve|update|retouch|replace)\b/.test(lowerPrompt) ||
			/\b(isometric|miniature|3d scene|blueprint|architectural|multi-layer|crowd scene)\b/.test(lowerPrompt);
		const thinkingLevel = needsHighThinking ? "High" : "minimal";

		return ok({
			assembled_prompt: assembledPrompt,
			base_prompt: body.prompt_text,
			creative_fragments: additions,
			fragment_count: additions.length,
			computed: {
				thinking_level: thinkingLevel,
				search_grounding: usesSearchGrounding,
				reference_count: referenceCount,
				prompt_length: promptLength,
				estimated_tokens: Math.ceil(promptLength / 4) + referenceCount * 258
			}
		});
	});
}

