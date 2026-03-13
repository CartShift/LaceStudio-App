"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/client-api";
import type {
  CharacterDesignDraft,
  PersonalityDraft,
  SocialTracksDraft,
  WorkflowStep,
} from "@/components/models/types";

const AUTOSAVE_DELAY_MS = 800;

export type DraftWorkflowStep =
  | "character_design"
  | "personality"
  | "social_strategy";

type DraftPayloadByStep = {
  character_design: CharacterDesignDraft;
  personality: PersonalityDraft;
  social_strategy: SocialTracksDraft;
};

type SaveState = "idle" | "saving" | "saved" | "error";

function isDraftWorkflowStep(step: WorkflowStep): step is DraftWorkflowStep {
  return (
    step === "character_design" ||
    step === "personality" ||
    step === "social_strategy"
  );
}

export function useModelWizardAutosave(input: {
  modelId: string | null;
  activeStep: WorkflowStep;
  payloadByStep: DraftPayloadByStep;
  onStepSaved: (step: DraftWorkflowStep, savedAt: string) => void;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveTimestamp, setSaveTimestamp] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const suppressAutosaveRef = useRef(false);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveSessionRef = useRef(0);
  const autosaveTimersRef = useRef<
    Record<DraftWorkflowStep, ReturnType<typeof setTimeout> | null>
  >({
    character_design: null,
    personality: null,
    social_strategy: null,
  });
  const modelIdRef = useRef(input.modelId);
  const payloadByStepRef = useRef(input.payloadByStep);
  const onStepSavedRef = useRef(input.onStepSaved);

  useEffect(() => {
    modelIdRef.current = input.modelId;
  }, [input.modelId]);

  useEffect(() => {
    payloadByStepRef.current = input.payloadByStep;
  }, [input.payloadByStep]);

  useEffect(() => {
    onStepSavedRef.current = input.onStepSaved;
  }, [input.onStepSaved]);

  const clearAutosaveTimer = useCallback((step: DraftWorkflowStep) => {
    const timer = autosaveTimersRef.current[step];
    if (!timer) return;

    clearTimeout(timer);
    autosaveTimersRef.current[step] = null;
  }, []);

  const clearAllAutosaveTimers = useCallback(() => {
    clearAutosaveTimer("character_design");
    clearAutosaveTimer("personality");
    clearAutosaveTimer("social_strategy");
  }, [clearAutosaveTimer]);

  const persistAutosave = useCallback(
    async (
      step: DraftWorkflowStep,
      payload: CharacterDesignDraft | PersonalityDraft | SocialTracksDraft,
      modelId: string,
      autosaveSession: number,
    ) => {
      try {
        await apiRequest(`/api/models/${modelId}/workflow`, {
          method: "PATCH",
          body: JSON.stringify({
            step,
            payload,
          }),
        });

        if (
          autosaveSession !== autosaveSessionRef.current ||
          modelId !== modelIdRef.current
        ) {
          return;
        }

        const savedAt = new Date().toISOString();
        setSaveState("saved");
        setSaveTimestamp(savedAt);
        onStepSavedRef.current(step, savedAt);
      } catch (error) {
        if (
          autosaveSession !== autosaveSessionRef.current ||
          modelId !== modelIdRef.current
        ) {
          return;
        }

        setSaveState("error");
        setSaveError(
          error instanceof Error
            ? error.message
            : "Auto-save didn't finish. Please try saving again.",
        );
      }
    },
    [],
  );

  const scheduleAutosave = useCallback(
    (
      step: DraftWorkflowStep,
      payload: CharacterDesignDraft | PersonalityDraft | SocialTracksDraft,
    ) => {
      if (!input.modelId || suppressAutosaveRef.current) return;

      clearAutosaveTimer(step);
      setSaveState("saving");
      setSaveError(null);
      const modelId = input.modelId;
      const autosaveSession = autosaveSessionRef.current;
      autosaveTimersRef.current[step] = setTimeout(() => {
        autosaveTimersRef.current[step] = null;
        void persistAutosave(step, payload, modelId, autosaveSession);
      }, AUTOSAVE_DELAY_MS);
    },
    [clearAutosaveTimer, input.modelId, persistAutosave],
  );

  const suspendAutosave = useCallback(() => {
    suppressAutosaveRef.current = true;
    autosaveSessionRef.current += 1;

    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }

    clearAllAutosaveTimers();
  }, [clearAllAutosaveTimers]);

  const resumeAutosave = useCallback(() => {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
    }

    // Resume after React flushes the remote draft state update.
    resumeTimerRef.current = setTimeout(() => {
      suppressAutosaveRef.current = false;
      resumeTimerRef.current = null;
    }, 0);
  }, []);

  const retryAutosave = useCallback(() => {
    if (!input.modelId || suppressAutosaveRef.current) return;

    const stepToSave = isDraftWorkflowStep(input.activeStep)
      ? input.activeStep
      : "social_strategy";
    scheduleAutosave(stepToSave, payloadByStepRef.current[stepToSave]);
  }, [input.activeStep, input.modelId, scheduleAutosave]);

  const syncSaveTimestamp = useCallback((savedAt: string | null) => {
    setSaveTimestamp(savedAt);
    setSaveError(null);
    setSaveState(savedAt ? "saved" : "idle");
  }, []);

  const resetAutosaveState = useCallback(() => {
    setSaveState("idle");
    setSaveTimestamp(null);
    setSaveError(null);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        clearTimeout(resumeTimerRef.current);
      }

      clearAllAutosaveTimers();
    };
  }, [clearAllAutosaveTimers]);

  return {
    retryAutosave,
    resumeAutosave,
    saveError,
    saveState,
    saveTimestamp,
    scheduleAutosave,
    suspendAutosave,
    resetAutosaveState,
    syncSaveTimestamp,
  };
}
