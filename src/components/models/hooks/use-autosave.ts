"use client";

import { useRef, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import type { CharacterDesignDraft, PersonalityDraft, SocialTracksDraft } from "@/components/models/types";

type AutosaveStep = "character_design" | "personality" | "social_strategy";
type AutosavePayload = CharacterDesignDraft | PersonalityDraft | SocialTracksDraft;

export type UseAutosaveReturn = {
	saveState: "idle" | "saving" | "saved" | "error";
	saveError: string | null;
	scheduleAutosave: (step: AutosaveStep, payload: AutosavePayload) => void;
	setSaveState: React.Dispatch<React.SetStateAction<"idle" | "saving" | "saved" | "error">>;
};

const AUTOSAVE_DEBOUNCE_MS = 800;

/**
 * F1: Extracted autosave hook.
 * Debounces draft saves (800ms) and tracks save state for UI display.
 * Each wizard step has an independent timer so a fast user doesn't lose data.
 */
export function useAutosave(modelId: string | null, onSaved: (step: AutosaveStep, savedAt: string) => void): UseAutosaveReturn {
	const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const [saveError, setSaveError] = useState<string | null>(null);

	const timersRef = useRef<Record<AutosaveStep, ReturnType<typeof setTimeout> | null>>({
		character_design: null,
		personality: null,
		social_strategy: null
	});

	function scheduleAutosave(step: AutosaveStep, payload: AutosavePayload) {
		if (!modelId) return;

		const existing = timersRef.current[step];
		if (existing) clearTimeout(existing);

		setSaveState("saving");
		setSaveError(null);

		timersRef.current[step] = setTimeout(async () => {
			try {
				await apiRequest(`/api/models/${modelId}/workflow`, {
					method: "PATCH",
					body: JSON.stringify({ step, payload })
				});

				setSaveState("saved");
				const savedAt = new Date().toISOString();
				onSaved(step, savedAt);
			} catch (err) {
				setSaveState("error");
				setSaveError(err instanceof Error ? err.message : "Autosave failed");
			}
		}, AUTOSAVE_DEBOUNCE_MS);
	}

	return { saveState, saveError, scheduleAutosave, setSaveState };
}
