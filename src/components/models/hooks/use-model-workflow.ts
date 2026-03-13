"use client";

import { useCallback, useRef, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import type { CharacterDesignDraft, PersonalityDraft, SocialTracksDraft } from "@/components/models/types";
import { createDefaultCharacterDraft, createDefaultPersonalityDraft, createDefaultSocialTracksDraft } from "@/components/models/types";
import type { WorkflowStep } from "@/components/models/types";

type WorkflowPayload = {
	model_id: string;
	model_name: string;
	status: "DRAFT" | "ACTIVE" | "ARCHIVED";
	canonical_pack_status: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
	active_canonical_pack_version: number;
	workflow_state: {
		current_step: "character_design" | "personality" | "social_strategy";
		completed_steps: Array<"character_design" | "personality" | "social_strategy">;
		last_saved_at: string;
	};
	completeness: {
		has_character_design: boolean;
		has_personality: boolean;
		has_social_strategy: boolean;
		has_canonical_pack: boolean;
		can_finalize: boolean;
	};
	draft: {
		character_design: CharacterDesignDraft | null;
		personality: PersonalityDraft | null;
		social_strategy: SocialTracksDraft | null;
	};
	capabilities: {
		gpu_available: boolean;
		openai_available: boolean;
		nano_available: boolean;
	};
};

export type UseModelWorkflowReturn = {
	workflow: WorkflowPayload | null;
	loadingWorkflow: boolean;
	characterDraft: CharacterDesignDraft;
	personalityDraft: PersonalityDraft;
	socialDraft: SocialTracksDraft;
	saveTimestamp: string | null;
	/** Set to true temporarily when loading workflow to prevent autosave from firing on draft state initialization */
	suppressAutosaveRef: React.MutableRefObject<boolean>;
	loadWorkflow: (modelId: string) => Promise<void>;
	setWorkflow: React.Dispatch<React.SetStateAction<WorkflowPayload | null>>;
	setCharacterDraft: React.Dispatch<React.SetStateAction<CharacterDesignDraft>>;
	setPersonalityDraft: React.Dispatch<React.SetStateAction<PersonalityDraft>>;
	setSocialDraft: React.Dispatch<React.SetStateAction<SocialTracksDraft>>;
	setActiveStepFromWorkflow: (payload: WorkflowPayload) => WorkflowStep;
};

/**
 * F1: Extracted hook managing workflow loading and draft state initialization.
 * Handles the canonical pack summary pre-fetch that happens alongside workflow load.
 */
export function useModelWorkflow(
	onSummaryLoaded: (packVersion: number) => Promise<void>,
	setActiveStep: (step: WorkflowStep) => void,
	setError: (error: string | null) => void
): UseModelWorkflowReturn {
	const [workflow, setWorkflow] = useState<WorkflowPayload | null>(null);
	const [loadingWorkflow, setLoadingWorkflow] = useState(false);
	const [characterDraft, setCharacterDraft] = useState<CharacterDesignDraft>(createDefaultCharacterDraft());
	const [personalityDraft, setPersonalityDraft] = useState<PersonalityDraft>(createDefaultPersonalityDraft());
	const [socialDraft, setSocialDraft] = useState<SocialTracksDraft>(createDefaultSocialTracksDraft());
	const [saveTimestamp, setSaveTimestamp] = useState<string | null>(null);
	const suppressAutosaveRef = useRef(false);

	function setActiveStepFromWorkflow(payload: WorkflowPayload): WorkflowStep {
		const current = payload.workflow_state.current_step;
		if (current === "character_design" || current === "personality" || current === "social_strategy") {
			return current;
		}
		return "reference_studio";
	}

	const loadWorkflow = useCallback(
		async (modelId: string) => {
			setLoadingWorkflow(true);
			setError(null);
			try {
				const payload = await apiRequest<WorkflowPayload>(`/api/models/${modelId}/workflow`);

				suppressAutosaveRef.current = true;
				setWorkflow(payload);
				setCharacterDraft(payload.draft.character_design ?? createDefaultCharacterDraft());
				setPersonalityDraft(payload.draft.personality ?? createDefaultPersonalityDraft());
				setSocialDraft(payload.draft.social_strategy ?? createDefaultSocialTracksDraft());
				setSaveTimestamp(payload.workflow_state.last_saved_at ?? null);
				setActiveStep(setActiveStepFromWorkflow(payload));

				await onSummaryLoaded(payload.active_canonical_pack_version);

				setTimeout(() => {
					suppressAutosaveRef.current = false;
				}, 0);
			} catch (err) {
				setError(err instanceof Error ? err.message : "We couldn't load your setup details. Please refresh and try again.");
				setWorkflow(null);
			} finally {
				setLoadingWorkflow(false);
			}
		},
		[onSummaryLoaded, setActiveStep, setError]
	);

	return {
		workflow,
		loadingWorkflow,
		characterDraft,
		personalityDraft,
		socialDraft,
		saveTimestamp,
		suppressAutosaveRef,
		loadWorkflow,
		setWorkflow,
		setCharacterDraft,
		setPersonalityDraft,
		setSocialDraft,
		setActiveStepFromWorkflow
	};
}
