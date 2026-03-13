import type { AiModel, ModelStatus } from "@prisma/client";
import type { ModelWorkflowStep } from "@/types/domain";

export const REQUIRED_CANONICAL_SHOT_CODES = [
  "frontal_closeup",
  "left45_closeup",
  "right45_closeup",
  "neutral_head_shoulders",
  "half_body_front",
  "full_body_front",
  "soft_smile_closeup",
  "serious_closeup",
] as const;
export const MIN_ACCEPTED_IMPORTED_REFERENCES_FOR_ACTIVATION = 3;

export type RequiredCanonicalShotCode = (typeof REQUIRED_CANONICAL_SHOT_CODES)[number];

export type WorkflowCompleteness = {
  has_character_design: boolean;
  has_personality: boolean;
  has_social_strategy: boolean;
  has_canonical_pack: boolean;
  can_finalize: boolean;
};

export function isCharacterDesignComplete(model: Pick<AiModel, "body_profile" | "face_profile">): boolean {
  return Boolean(model.body_profile && model.face_profile);
}

export function isPersonalityComplete(model: Pick<AiModel, "personality_profile">): boolean {
  return Boolean(model.personality_profile);
}

export function isSocialStrategyComplete(model: Pick<AiModel, "social_tracks_profile">): boolean {
  return Boolean(model.social_tracks_profile);
}

export function hasApprovedCanonicalPack(
 model: Pick<AiModel, "canonical_pack_status" | "active_canonical_pack_version">,
 selectedCanonicalCount: number,
): boolean {
  return (
    model.canonical_pack_status === "APPROVED" &&
    model.active_canonical_pack_version > 0 &&
    selectedCanonicalCount >= REQUIRED_CANONICAL_SHOT_CODES.length
  );
}

export function hasSufficientImportedReferences(
  acceptedImportedReferenceCount: number,
): boolean {
  return acceptedImportedReferenceCount >= MIN_ACCEPTED_IMPORTED_REFERENCES_FOR_ACTIVATION;
}

function hasActivationReferenceSet(
  model: Pick<AiModel, "canonical_pack_status" | "active_canonical_pack_version">,
  selectedCanonicalCount: number,
  acceptedImportedReferenceCount: number,
): boolean {
  return (
    hasApprovedCanonicalPack(model, selectedCanonicalCount) ||
    hasSufficientImportedReferences(acceptedImportedReferenceCount)
  );
}

export function deriveModelStatusForWorkflow(
  model: Pick<
    AiModel,
    | "status"
    | "body_profile"
    | "face_profile"
    | "canonical_pack_status"
    | "active_canonical_pack_version"
  >,
  selectedCanonicalCount: number,
  acceptedImportedReferenceCount = 0,
): ModelStatus {
  if (model.status === "ARCHIVED") {
    return "ARCHIVED";
  }

  return isCharacterDesignComplete(model) &&
    hasActivationReferenceSet(model, selectedCanonicalCount, acceptedImportedReferenceCount)
    ? "ACTIVE"
    : "DRAFT";
}

export function deriveWorkflowCompleteness(
  model: Pick<
    AiModel,
    | "body_profile"
    | "face_profile"
    | "personality_profile"
    | "social_tracks_profile"
    | "canonical_pack_status"
    | "active_canonical_pack_version"
  >,
  selectedCanonicalCount: number,
  acceptedImportedReferenceCount = 0,
): WorkflowCompleteness {
  const has_character_design = isCharacterDesignComplete(model);
  const has_personality = isPersonalityComplete(model);
  const has_social_strategy = isSocialStrategyComplete(model);
  const has_canonical_pack = hasActivationReferenceSet(
    model,
    selectedCanonicalCount,
    acceptedImportedReferenceCount,
  );

  return {
    has_character_design,
    has_personality,
    has_social_strategy,
    has_canonical_pack,
    can_finalize: has_character_design && has_canonical_pack,
  };
}

export function defaultWorkflowState(): {
  current_step: ModelWorkflowStep;
  completed_steps: ModelWorkflowStep[];
  last_saved_at: string;
} {
  return {
    current_step: "character_design",
    completed_steps: [],
    last_saved_at: new Date().toISOString(),
  };
}

export function mergeWorkflowState(
  existing: Record<string, unknown> | null | undefined,
  step: ModelWorkflowStep,
): {
  current_step: ModelWorkflowStep;
  completed_steps: ModelWorkflowStep[];
  last_saved_at: string;
} {
  const base = defaultWorkflowState();
  const rawCompleted = existing?.completed_steps;
  const completed_steps = Array.isArray(rawCompleted)
    ? Array.from(
        new Set(
          rawCompleted.filter(
            (item): item is ModelWorkflowStep =>
              item === "character_design" || item === "personality" || item === "social_strategy",
          ),
        ),
      )
    : [];

  if (!completed_steps.includes(step)) {
    completed_steps.push(step);
  }

  const current_step = nextStepFor(step);

  return {
    ...base,
    ...existing,
    current_step,
    completed_steps,
    last_saved_at: new Date().toISOString(),
  };
}

function nextStepFor(step: ModelWorkflowStep): ModelWorkflowStep {
  if (step === "character_design") return "personality";
  if (step === "personality") return "social_strategy";
  return "social_strategy";
}

export function buildModelCapabilityFlags(hasActiveLora: boolean): {
  gpu_available: boolean;
  openai_available: true;
  nano_available: true;
} {
  return {
    gpu_available: hasActiveLora,
    openai_available: true,
    nano_available: true,
  };
}
