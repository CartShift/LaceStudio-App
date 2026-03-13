"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { StateBlock } from "@/components/ui/state-block";
import { Badge } from "@/components/ui/badge";
import { EditorialCard } from "@/components/ui/editorial-card";
import { StepCelebration } from "@/components/ui/step-celebration";
import { FormField } from "@/components/workspace/form-field";
import { apiRequest } from "@/lib/client-api";
import { clamp, sleep } from "@/lib/utils";
import { ModelStepper } from "@/components/models/model-stepper";
import { StepCharacterDesign } from "@/components/models/step-character-design";
import { StepPersonality } from "@/components/models/step-personality";
import { StepSocialStrategy } from "@/components/models/step-social-strategy";
import { StepReferenceStudio } from "@/components/models/step-reference-studio";
import { StepReviewFinalize } from "@/components/models/step-review-finalize";
import { ModelPhotoImporter, type ModelPhotoImportApplyResponse } from "@/components/models/model-photo-importer";
import { useModelWizardAutosave, type DraftWorkflowStep } from "@/components/models/use-model-wizard-autosave";
import type { CanonicalPackSummary, CharacterDesignDraft, PersonalityDraft, SocialTracksDraft, WorkflowStep } from "@/components/models/types";
import { createDefaultCharacterDraft, createDefaultPersonalityDraft, createDefaultSocialTracksDraft } from "@/components/models/types";
import type { ImageModelProvider } from "@/server/schemas/creative";

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

type DraftModel = {
	id: string;
	name: string;
	description: string | null;
	status: "DRAFT" | "ACTIVE" | "ARCHIVED";
};

const CANONICAL_POLL_MAX_ATTEMPTS = 180;
const CANONICAL_POLL_FAST_DELAY_MS = 1_500;
const CANONICAL_POLL_MEDIUM_DELAY_MS = 3_000;
const CANONICAL_POLL_SLOW_DELAY_MS = 5_000;
const CANONICAL_TERMINAL_STATUSES = new Set<CanonicalPackSummary["status"]>(["READY", "APPROVED", "FAILED"]);
const FRONT_SHOT_CODE = "frontal_closeup";

export function ModelWizard() {
	const searchParams = useSearchParams();
	const resumeParam = searchParams.get("resume");
	const [modelId, setModelId] = useState<string | null>(resumeParam);
	const [modelName, setModelName] = useState("");
	const [modelDescription, setModelDescription] = useState("");
	const [modelNameError, setModelNameError] = useState<string | null>(null);
	const [draftModels, setDraftModels] = useState<DraftModel[]>([]);
	const [workflow, setWorkflow] = useState<WorkflowPayload | null>(null);

	const [characterDraft, setCharacterDraft] = useState<CharacterDesignDraft>(createDefaultCharacterDraft());
	const [personalityDraft, setPersonalityDraft] = useState<PersonalityDraft>(createDefaultPersonalityDraft());
	const [socialDraft, setSocialDraft] = useState<SocialTracksDraft>(createDefaultSocialTracksDraft());

	const [activeStep, setActiveStep] = useState<WorkflowStep>("character_design");
	const [advancedMode, setAdvancedMode] = useState(false);
	const [summary, setSummary] = useState<CanonicalPackSummary | null>(null);
	const [selectedByShot, setSelectedByShot] = useState<Record<string, string>>({});

	const providerModelDefaults: Record<ImageModelProvider, string> = useMemo(
		() => ({
			openai: "gpt-image-1",
			nano_banana_2: "gemini-3.1-flash-image-preview",
			zai_glm: "glm-image",
			gpu: "sdxl-1.0"
		}),
		[]
	);
	const [provider, setProvider] = useState<ImageModelProvider>("zai_glm");
	const [providerModelId, setProviderModelId] = useState(providerModelDefaults.zai_glm);
	const [candidatesPerShot, setCandidatesPerShot] = useState(1);

	const [creatingModel, setCreatingModel] = useState(false);
	const [loadingWorkflow, setLoadingWorkflow] = useState(false);
	const [generating, setGenerating] = useState(false);
	const [approvingFront, setApprovingFront] = useState(false);
	const [approving, setApproving] = useState(false);
	const [finalizing, setFinalizing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [celebrationMsg, setCelebrationMsg] = useState<string | null>(null);
	const [showCelebration, setShowCelebration] = useState(false);

	const triggerCelebration = useCallback((msg: string) => {
		setCelebrationMsg(msg);
		setShowCelebration(true);
	}, []);

	const handleDraftStepSaved = useCallback((step: DraftWorkflowStep, savedAt: string) => {
		setWorkflow(prev =>
			prev
				? {
						...prev,
						workflow_state: {
							...prev.workflow_state,
							completed_steps: Array.from(new Set([...prev.workflow_state.completed_steps, step])),
							current_step: step === "character_design" ? "personality" : "social_strategy",
							last_saved_at: savedAt
						}
					}
				: prev
		);
	}, []);
	const {
		resetAutosaveState,
		retryAutosave,
		resumeAutosave,
		saveError,
		saveState,
		saveTimestamp,
		scheduleAutosave,
		suspendAutosave,
		syncSaveTimestamp
	} = useModelWizardAutosave({
		modelId,
		activeStep,
		payloadByStep: {
			character_design: characterDraft,
			personality: personalityDraft,
			social_strategy: socialDraft
		},
		onStepSaved: handleDraftStepSaved
	});
	const loadDraftModelsEffect = useEffectEvent(() => {
		void loadDraftModels();
	});
	const loadWorkflowEffect = useEffectEvent((id: string) => {
		void loadWorkflow(id);
	});
	const handleDraftResume = useCallback((id: string) => {
		resetAutosaveState();
		setModelId(id);
	}, [resetAutosaveState]);

	useEffect(() => {
		loadDraftModelsEffect();
	}, []);

	useEffect(() => {
		if (resumeParam && resumeParam !== modelId) {
			setModelId(resumeParam);
		}
	}, [modelId, resumeParam]);

	useEffect(() => {
		if (!modelId) return;
		loadWorkflowEffect(modelId);
	}, [modelId]);

	useEffect(() => {
		setProviderModelId(providerModelDefaults[provider]);
	}, [provider, providerModelDefaults]);

	useEffect(() => {
		if (!modelId) return;
		scheduleAutosave("character_design", characterDraft);
	}, [characterDraft, modelId, scheduleAutosave]);

	useEffect(() => {
		if (!modelId) return;
		scheduleAutosave("personality", personalityDraft);
	}, [modelId, personalityDraft, scheduleAutosave]);

	useEffect(() => {
		if (!modelId) return;
		scheduleAutosave("social_strategy", socialDraft);
	}, [modelId, scheduleAutosave, socialDraft]);

	const orderedSteps: WorkflowStep[] = ["character_design", "personality", "social_strategy", "reference_studio", "review"];
	const completedSteps = useMemo(() => {
		const base: WorkflowStep[] = [...(workflow?.workflow_state.completed_steps ?? [])];
		if (workflow?.completeness.has_canonical_pack) {
			base.push("reference_studio");
		}
		if (workflow?.status === "ACTIVE") {
			base.push("review");
		}
		return Array.from(new Set(base));
	}, [workflow]);

	async function loadDraftModels() {
		try {
			const payload = await apiRequest<{ data: DraftModel[] }>("/api/models?status=DRAFT&limit=20");
			setDraftModels(payload.data);
		} catch {
			setDraftModels([]);
		}
	}

	async function createDraftModel() {
		if (!modelName.trim()) {
			setModelNameError("Add a model name to continue.");
			return;
		}

		setCreatingModel(true);
		setError(null);
		setModelNameError(null);
		try {
			const created = await apiRequest<{ id: string }>("/api/models", {
				method: "POST",
				body: JSON.stringify({
					name: modelName.trim(),
					description: modelDescription.trim() || undefined
				})
			});
			resetAutosaveState();
			setModelId(created.id);
			await loadDraftModels();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't create the draft model. Please try again.");
		} finally {
			setCreatingModel(false);
		}
	}

	async function loadWorkflow(id: string) {
		suspendAutosave();
		resetAutosaveState();
		setLoadingWorkflow(true);
		setError(null);
		try {
			const payload = await apiRequest<WorkflowPayload>(`/api/models/${id}/workflow`);

			setWorkflow(payload);
			setCharacterDraft(payload.draft.character_design ?? createDefaultCharacterDraft());
			setPersonalityDraft(payload.draft.personality ?? createDefaultPersonalityDraft());
			setSocialDraft(payload.draft.social_strategy ?? createDefaultSocialTracksDraft());
			syncSaveTimestamp(payload.workflow_state.last_saved_at ?? null);
			setActiveStep(
				payload.workflow_state.current_step === "character_design" || payload.workflow_state.current_step === "personality" || payload.workflow_state.current_step === "social_strategy"
					? payload.workflow_state.current_step
					: "reference_studio"
			);

			const canonicalSummary = await apiRequest<CanonicalPackSummary>(
				`/api/models/${id}/workflow/canonical-pack${payload.active_canonical_pack_version > 0 ? `?pack_version=${payload.active_canonical_pack_version}` : ""}`
			);
			setSummary(canonicalSummary);
			setSelectedByShot(toSelectionMap(canonicalSummary));
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't load your setup details. Please refresh and try again.");
			setWorkflow(null);
		} finally {
			setLoadingWorkflow(false);
			resumeAutosave();
		}
	}

	async function generateCanonicalPack(input: { mode: "front_only" | "remaining" | "full"; packVersion?: number }) {
		if (!modelId) return;

		setGenerating(true);
		setError(null);
		try {
			const started = await apiRequest<{ pack_version: number; job_id: string }>(`/api/models/${modelId}/workflow/canonical-pack/generate`, {
				method: "POST",
				body: JSON.stringify({
					provider,
					model_id: providerModelId || undefined,
					pack_template: "balanced_8",
					candidates_per_shot: candidatesPerShot,
					style: "strict_studio",
					generation_mode: input.mode,
					pack_version: input.packVersion
				})
			});

			const finalStatus = await pollCanonicalSummary(modelId, started.pack_version);
			await loadWorkflow(modelId);
			if (finalStatus === "FAILED") {
				throw new Error("The reference set couldn't finish generating. Please review and try again.");
			}
			setActiveStep("reference_studio");
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't generate the reference set. Please try again.");
		} finally {
			setGenerating(false);
		}
	}

	async function generateFrontCanonicalPack() {
		await generateCanonicalPack({ mode: "front_only" });
	}

	async function generateRemainingCanonicalPack() {
		if (!summary || summary.pack_version <= 0) {
			setError("Create and approve a front look option first.");
			return;
		}

		const frontShot = summary.shots.find(shot => shot.shot_code === FRONT_SHOT_CODE);
		const frontApproved = (frontShot?.candidates ?? []).some(candidate => candidate.status === "SELECTED");
		if (!frontApproved) {
			setError("Approve a front look option first.");
			return;
		}

		await generateCanonicalPack({
			mode: "remaining",
			packVersion: summary.pack_version
		});
	}

	async function approveFrontCandidate() {
		if (!modelId || !summary || summary.pack_version <= 0) return;

		const frontShot = summary.shots.find(shot => shot.shot_code === FRONT_SHOT_CODE);
		if (!frontShot || frontShot.candidates.length === 0) {
			setError("Create front look options first.");
			return;
		}

		const candidateId = selectedByShot[FRONT_SHOT_CODE] ?? frontShot.candidates.find(candidate => candidate.status === "SELECTED")?.id ?? frontShot.recommended_candidate_id ?? "";
		if (!candidateId) {
			setError("Select a front look option before approving.");
			return;
		}

		setApprovingFront(true);
		setError(null);
		try {
			await apiRequest(`/api/models/${modelId}/workflow/canonical-pack/approve-front`, {
				method: "POST",
				body: JSON.stringify({
					pack_version: summary.pack_version,
					candidate_id: candidateId
				})
			});

			await loadWorkflow(modelId);
			setSelectedByShot(current => ({ ...current, [FRONT_SHOT_CODE]: candidateId }));
			setActiveStep("reference_studio");
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't approve that front look. Please try again.");
		} finally {
			setApprovingFront(false);
		}
	}

	async function pollCanonicalSummary(id: string, packVersion: number): Promise<CanonicalPackSummary["status"]> {
		let latestStatus: CanonicalPackSummary["status"] | null = null;

		for (let attempt = 0; attempt < CANONICAL_POLL_MAX_ATTEMPTS; attempt += 1) {
			const payload = await apiRequest<CanonicalPackSummary>(`/api/models/${id}/workflow/canonical-pack?pack_version=${packVersion}`);
			latestStatus = payload.status;
			setSummary(payload);
			setSelectedByShot(current => ({
				...toSelectionMap(payload),
				...current
			}));

			if (CANONICAL_TERMINAL_STATUSES.has(payload.status)) {
				return payload.status;
			}

			await sleep(canonicalPollDelayMs(attempt));
		}

		throw new Error(
			latestStatus
				? `Reference set generation is taking longer than expected (currently ${latestStatus.toLowerCase()}). Please refresh and continue.`
				: "Reference set generation is taking longer than expected. Please refresh and continue."
		);
	}

	async function approveCanonicalPack() {
		if (!modelId || !summary || summary.pack_version <= 0) return;

		setApproving(true);
		setError(null);
		try {
			const selections = summary.shots.map(shot => ({
				shot_code: shot.shot_code,
				candidate_id: selectedByShot[shot.shot_code] ?? ""
			}));

			await apiRequest(`/api/models/${modelId}/workflow/canonical-pack/approve`, {
				method: "POST",
				body: JSON.stringify({
					pack_version: summary.pack_version,
					selections
				})
			});

			await loadWorkflow(modelId);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't approve this reference set. Please try again.");
		} finally {
			setApproving(false);
		}
	}

	async function finalizeModel() {
		if (!modelId) return;

		setFinalizing(true);
		setError(null);
		try {
			await apiRequest(`/api/models/${modelId}/workflow/finalize`, {
				method: "POST",
				body: JSON.stringify({})
			});
			await loadWorkflow(modelId);
			setActiveStep("review");
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't finish the model setup. Please try again.");
		} finally {
			setFinalizing(false);
		}
	}

	async function handlePhotoImportApplied(payload: ModelPhotoImportApplyResponse) {
		if (!modelId) return;

		if (payload.canonical_warning) {
			setError(payload.canonical_warning);
		} else {
			setError(null);
		}

		setCharacterDraft(payload.draft.character_design);
		setPersonalityDraft(payload.draft.personality);
		setSocialDraft(payload.draft.social_strategy);

		await loadWorkflow(modelId);

		if (payload.canonical_job) {
			setActiveStep("reference_studio");
			void pollCanonicalSummary(modelId, payload.canonical_job.pack_version)
				.then(async () => {
					await loadWorkflow(modelId);
				})
				.catch(err => {
					setError(err instanceof Error ? err.message : "Reference set generation from photo import didn't finish.");
				});
		}
	}

	if (!modelId) {
		return (
			<div className="space-y-4">
				<EditorialCard className="space-y-5 border-border/80 bg-gradient-to-br from-card via-[color:color-mix(in_oklab,var(--card),var(--background)_15%)] to-[color:color-mix(in_oklab,var(--accent),var(--background)_80%)]">
					<div className="text-center">
						<span className="text-5xl">🎮</span>
						<h2 className="mt-2 font-display text-2xl font-semibold">Create Your Model</h2>
						<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Build your model in five simple steps: shape the look, define the voice, and launch.</p>
					</div>

					<div className="mx-auto max-w-sm space-y-3">
						<FormField label="Model Name" id="wizard-model-name" required error={modelNameError ?? undefined}>
							<Input
								value={modelName}
								onChange={event => {
									setModelName(event.target.value);
									if (modelNameError) setModelNameError(null);
								}}
								minLength={2}
								maxLength={50}
								placeholder="Give your model a name…"
							/>
						</FormField>
						<FormField label="Description (optional)" id="wizard-model-description">
							<Textarea value={modelDescription} onChange={event => setModelDescription(event.target.value)} rows={2} maxLength={500} placeholder="Short style summary…" />
						</FormField>
						<Button type="button" className="w-full" onClick={() => void createDraftModel()} disabled={creatingModel}>
							{creatingModel ? "Creating…" : "Start Setup"}
						</Button>
					</div>
				</EditorialCard>

				{draftModels.length > 0 ? (
					<EditorialCard className="space-y-3">
						<h3 className="font-display text-lg">📂 Resume a Draft</h3>
						<div className="grid gap-2 md:grid-cols-2">
							{draftModels.slice(0, 4).map(draft => (
								<button
								key={draft.id}
								type="button"
								onClick={() => handleDraftResume(draft.id)}
								className="rounded-xl border border-border/60 bg-card/50 p-3 text-left transition-all hover:border-[color:color-mix(in_oklab,var(--color-primary),transparent_50%)] hover:bg-card/80 hover:scale-[1.01]">
									<p className="font-medium">{draft.name}</p>
									<p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{draft.description ?? "No description yet"}</p>
									<span className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary">Continue →</span>
								</button>
							))}
						</div>
					</EditorialCard>
				) : null}

				{error ? <StateBlock tone="error" title="We couldn't start setup" description={error} /> : null}
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 className="font-display text-2xl">{workflow?.model_name ?? "Model Setup"}</h2>
				</div>
				<div className="flex items-center gap-2">
					<Badge tone={saveState === "error" ? "danger" : saveState === "saved" ? "success" : "neutral"}>
						{saveState === "saving"
							? "Saving..."
							: saveState === "saved"
								? `Saved${saveTimestamp ? ` · ${new Date(saveTimestamp).toLocaleTimeString()}` : ""}`
								: saveState === "error"
									? "Needs attention"
									: "Idle"}
					</Badge>
					<Button type="button" variant={advancedMode ? "primary" : "secondary"} onClick={() => setAdvancedMode(prev => !prev)}>
						{advancedMode ? "Advanced Mode On" : "Simple Mode"}
					</Button>
				</div>
			</div>

			{saveError ? (
				<StateBlock
					tone="error"
					title="Auto-save didn't finish"
					description={saveError}
					action={
						<Button type="button" variant="secondary" size="sm" onClick={() => void retryAutosave()}>
							Try Save Again
						</Button>
					}
				/>
			) : null}
			{error ? <StateBlock tone="error" title="Model setup issue" description={error} /> : null}
			{loadingWorkflow ? <StateBlock title="Loading setup..." /> : null}

			<ModelStepper activeStep={activeStep} completedSteps={completedSteps} onStepSelect={setActiveStep} />

			<div className="grid gap-4 xl:grid-cols-[1fr_320px]">
				<div className="space-y-4">
					{activeStep === "character_design" ? (
						<>
							<StepCharacterDesign value={characterDraft} showAdvanced={advancedMode} onChange={setCharacterDraft} />
							<ModelPhotoImporter modelId={modelId} onApplied={handlePhotoImportApplied} />
						</>
					) : null}

					{activeStep === "personality" ? <StepPersonality value={personalityDraft} showAdvanced={advancedMode} onChange={setPersonalityDraft} /> : null}

					{activeStep === "social_strategy" ? <StepSocialStrategy value={socialDraft} showAdvanced={advancedMode} onChange={setSocialDraft} /> : null}

					{activeStep === "reference_studio" ? (
						<StepReferenceStudio
							canonicalPackStatus={workflow?.canonical_pack_status ?? "NOT_STARTED"}
							summary={summary}
							provider={provider}
							providerModelId={providerModelId}
							candidatesPerShot={candidatesPerShot}
							generating={generating}
							approvingFront={approvingFront}
							onProviderChange={setProvider}
							onProviderModelIdChange={setProviderModelId}
							onCandidatesPerShotChange={count => setCandidatesPerShot(clamp(count, 1, 5, { round: true }))}
							onGenerateFront={generateFrontCanonicalPack}
							onGenerateRemaining={generateRemainingCanonicalPack}
							onApproveFront={approveFrontCandidate}
							selectedByShot={selectedByShot}
							onSelectCandidate={(shotCode, candidateId) => setSelectedByShot(current => ({ ...current, [shotCode]: candidateId }))}
						/>
					) : null}

					{activeStep === "review" ? (
						<StepReviewFinalize
							modelStatus={workflow?.status ?? "DRAFT"}
							canonicalPackStatus={workflow?.canonical_pack_status ?? "NOT_STARTED"}
							summary={summary}
							selectedByShot={selectedByShot}
							hasCharacterDesign={workflow?.completeness.has_character_design ?? false}
							hasPersonality={workflow?.completeness.has_personality ?? false}
							hasSocialStrategy={workflow?.completeness.has_social_strategy ?? false}
							hasCanonicalPack={workflow?.completeness.has_canonical_pack ?? false}
							approving={approving}
							finalizing={finalizing}
							onApprovePack={approveCanonicalPack}
							onFinalize={finalizeModel}
							capabilityFlags={
								workflow?.capabilities ?? {
									gpu_available: false,
									openai_available: true,
									nano_available: true
								}
							}
						/>
					) : null}

					<div className="flex flex-wrap gap-2">
						<Button type="button" variant="secondary" onClick={() => setActiveStep(previousStep(activeStep, orderedSteps))} disabled={activeStep === orderedSteps[0]}>
							← Back
						</Button>
						<Button
							type="button"
							disabled={activeStep === orderedSteps[orderedSteps.length - 1]}
							onClick={() => {
								const stepLabels: Record<string, string> = {
									character_design: "Character Design",
									personality: "Personality",
									social_strategy: "Social Strategy",
									reference_studio: "References",
									review: "Launch"
								};
								if (completedSteps.includes(activeStep)) {
									triggerCelebration(`${stepLabels[activeStep] ?? "Step"} complete!`);
								}
								setActiveStep(nextStep(activeStep, orderedSteps));
							}}>
							Next Step →
						</Button>
					</div>
				</div>

				<EditorialCard className="space-y-3 xl:sticky xl:top-5">
					<h3 className="flex items-center gap-2 font-display text-lg">
						<span className="text-xl">🏆</span> Progress
					</h3>
					<p className="text-xs text-muted-foreground">{workflow?.completeness.can_finalize ? "Everything is complete. You can launch now." : "Finish each step to unlock launch."}</p>
					<SummaryFlag emoji="🎨" label="Character" done={workflow?.completeness.has_character_design ?? false} />
					<SummaryFlag emoji="🎭" label="Personality" done={workflow?.completeness.has_personality ?? false} />
					<SummaryFlag emoji="📊" label="Strategy" done={workflow?.completeness.has_social_strategy ?? false} />
					<SummaryFlag emoji="📸" label="References" done={workflow?.completeness.has_canonical_pack ?? false} />
					{!workflow?.completeness.can_finalize ? (
						<div className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">{buildBlockedReason(workflow, selectedByShot, summary)}</div>
					) : null}
				</EditorialCard>
			</div>

			<StepCelebration show={showCelebration} message={celebrationMsg ?? ""} onDone={() => setShowCelebration(false)} />
		</div>
	);
}

function SummaryFlag({ emoji, label, done }: { emoji: string; label: string; done: boolean }) {
	return (
		<div
			className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm transition-all duration-300 ${done ? "border-[var(--status-success-border)] bg-[color:color-mix(in_oklab,var(--status-success-bg),white_8%)]" : "border-border bg-card"}`}>
			<span className="flex items-center gap-1.5">
				<span>{emoji}</span>
				<span className={done ? "text-[var(--status-success)]" : ""}>{label}</span>
			</span>
			<Badge tone={done ? "success" : "warning"}>{done ? "✓ Done" : "To do"}</Badge>
		</div>
	);
}

function buildBlockedReason(workflow: WorkflowPayload | null, selectedByShot: Record<string, string>, summary: CanonicalPackSummary | null): string {
	if (!workflow) return "Setup details are still loading.";
	if (!workflow.completeness.has_character_design) return "Save Character details to continue.";
	if (!workflow.completeness.has_personality) return "Save Personality details to continue.";
	if (!workflow.completeness.has_social_strategy) return "Save Social Strategy to continue.";
	if (!workflow.completeness.has_canonical_pack) {
		const selectedCount = Object.values(selectedByShot).filter(Boolean).length;
		if (summary && summary.status === "READY" && selectedCount < 8) {
			return `Choose one option for each reference angle (${selectedCount}/8 selected).`;
		}
		return "Approve the Reference Set, or keep at least 3 accepted imported photos before finishing.";
	}
	return "You can finish once all checks pass.";
}

function toSelectionMap(summary: CanonicalPackSummary | null): Record<string, string> {
	if (!summary) return {};
	const selection: Record<string, string> = {};

	for (const shot of summary.shots) {
		const selected = shot.candidates.find(candidate => candidate.status === "SELECTED");
		selection[shot.shot_code] = selected?.id ?? shot.recommended_candidate_id ?? "";
	}

	return selection;
}

function canonicalPollDelayMs(attempt: number): number {
	if (attempt < 40) return CANONICAL_POLL_FAST_DELAY_MS;
	if (attempt < 100) return CANONICAL_POLL_MEDIUM_DELAY_MS;
	return CANONICAL_POLL_SLOW_DELAY_MS;
}

function previousStep(active: WorkflowStep, steps: WorkflowStep[]): WorkflowStep {
	const first = steps[0] ?? "character_design";
	const index = steps.indexOf(active);
	if (index <= 0) return first;
	return steps[index - 1] ?? first;
}

function nextStep(active: WorkflowStep, steps: WorkflowStep[]): WorkflowStep {
	const fallback = steps[steps.length - 1] ?? "review";
	const index = steps.indexOf(active);
	if (index < 0 || index >= steps.length - 1) return fallback;
	return steps[index + 1] ?? fallback;
}
