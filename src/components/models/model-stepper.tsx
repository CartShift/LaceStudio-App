"use client";

import { XpProgressBar } from "@/components/ui/xp-progress-bar";
import type { WorkflowStep } from "@/components/models/types";

const STEP_ORDER: Array<{ key: WorkflowStep; label: string }> = [
	{ key: "character_design", label: "Character" },
	{ key: "personality", label: "Personality" },
	{ key: "social_strategy", label: "Strategy" },
	{ key: "reference_studio", label: "References" },
	{ key: "review", label: "Launch" }
];

export function ModelStepper({ activeStep, completedSteps, onStepSelect }: { activeStep: WorkflowStep; completedSteps: WorkflowStep[]; onStepSelect: (step: WorkflowStep) => void }) {
	const segments = STEP_ORDER.map(step => ({
		key: step.key,
		label: step.label,
		done: completedSteps.includes(step.key),
		active: activeStep === step.key
	}));

	return <XpProgressBar segments={segments} onSegmentClick={key => onStepSelect(key as WorkflowStep)} />;
}
