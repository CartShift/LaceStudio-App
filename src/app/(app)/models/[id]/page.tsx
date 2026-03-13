"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { SquareImageThumbnail } from "@/components/ui/square-image-thumbnail";
import { Textarea } from "@/components/ui/textarea";
import { FilterShell } from "@/components/workspace/filter-shell";
import { FormField } from "@/components/workspace/form-field";
import { FormShell } from "@/components/workspace/form-shell";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { useBreadcrumb } from "@/components/providers/breadcrumb-provider";
import { ModelPhotoImporter, type ModelPhotoImportApplyResponse } from "@/components/models/model-photo-importer";
import { StepCharacterDesign } from "@/components/models/step-character-design";
import { StepPersonality } from "@/components/models/step-personality";
import { StepSocialStrategy } from "@/components/models/step-social-strategy";
import { apiFormRequest, apiRequest } from "@/lib/client-api";
import { humanizeStatusLabel } from "@/lib/status-labels";
import { clampInt, sleep } from "@/lib/utils";
import { getPhotoImportAnalysisIssue } from "@/components/models/photo-import-analysis";
import {
	type CharacterDesignDraft,
	type ModelPhotoImportSnapshot,
	type PersonalityDraft,
	type SocialTracksDraft,
	createDefaultCharacterDraft,
	createDefaultPersonalityDraft,
	createDefaultSocialTracksDraft
} from "@/components/models/types";

type ProfileTab = "character" | "personality" | "social";
type CanonicalProvider = "openai" | "nano_banana_2" | "zai_glm" | "gpu";

type ModelVersion = {
	id: string;
	version: number;
	is_active: boolean;
	notes: string | null;
	created_at: string;
};

type ModelDetail = {
	id: string;
	name: string;
	status: "DRAFT" | "ACTIVE" | "ARCHIVED";
	description: string | null;
	body_profile: Record<string, unknown> | null;
	face_profile: Record<string, unknown> | null;
	imperfection_fingerprint: Array<Record<string, unknown>> | null;
	personality_profile: Record<string, unknown> | null;
	social_tracks_profile: Record<string, unknown> | null;
	canonical_pack_status: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
	active_canonical_pack_version: number;
	canonical_references: Array<{
		id: string;
		pack_version: number;
		shot_code: string;
		reference_image_url: string;
		notes: string | null;
		sort_order: number;
	}>;
	model_versions: ModelVersion[];
};

type CanonicalPackSummary = {
	pack_version: number;
	status: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
	error?: string | null;
	progress?: {
		completed_shots: number;
		total_shots: number;
		generated_candidates: number;
	};
	shots: Array<{
		shot_code: string;
		recommended_candidate_id?: string;
		candidates: Array<{
			id: string;
			candidate_index: number;
			image_gcs_uri: string;
			preview_image_url?: string | null;
			composite_score: string | number | null;
			status: "CANDIDATE" | "SELECTED" | "REJECTED";
		}>;
	}>;
};

const FRONT_SHOT_CODE = "frontal_closeup";
const PROFILE_TAB_CONFIG: Array<{ key: ProfileTab; label: string; desc: string }> = [
	{ key: "character", label: "Character", desc: "Body, face, signature features" },
	{ key: "personality", label: "Personality", desc: "Voice, tone, interests" },
	{ key: "social", label: "Social Strategy", desc: "Content style and posting goals" }
];

export default function ModelDetailPage() {
	const params = useParams<{ id: string }>();
	const pathname = usePathname();
	const { setSegmentTitle } = useBreadcrumb();
	const modelId = params.id;
	const segmentIndex = pathname.split("/").filter(Boolean).indexOf(modelId);

	const [model, setModel] = useState<ModelDetail | null>(null);
	const [modelName, setModelName] = useState("");
	const [modelDescription, setModelDescription] = useState("");
	const [profileTab, setProfileTab] = useState<ProfileTab>("character");
	const [characterDraft, setCharacterDraft] = useState<CharacterDesignDraft>(createDefaultCharacterDraft());
	const [personalityDraft, setPersonalityDraft] = useState<PersonalityDraft>(createDefaultPersonalityDraft());
	const [socialDraft, setSocialDraft] = useState<SocialTracksDraft>(createDefaultSocialTracksDraft());
	const [savedCharacterDraft, setSavedCharacterDraft] = useState<CharacterDesignDraft>(createDefaultCharacterDraft());
	const [savedPersonalityDraft, setSavedPersonalityDraft] = useState<PersonalityDraft>(createDefaultPersonalityDraft());
	const [savedSocialDraft, setSavedSocialDraft] = useState<SocialTracksDraft>(createDefaultSocialTracksDraft());
	const [savedModelName, setSavedModelName] = useState("");
	const [savedModelDescription, setSavedModelDescription] = useState("");
	const [notes, setNotes] = useState("");
	const [strength, setStrength] = useState("0.8");
	const canonicalProviderModelDefaults: Record<CanonicalProvider, string> = useMemo(
		() => ({ openai: "gpt-image-1", nano_banana_2: "gemini-3.1-flash-image-preview", zai_glm: "glm-image", gpu: "sdxl-1.0" }),
		[]
	);
	const [canonicalProvider, setCanonicalProvider] = useState<CanonicalProvider>("nano_banana_2");
	const [canonicalModelId, setCanonicalModelId] = useState(canonicalProviderModelDefaults.nano_banana_2);
	const [canonicalCandidatesPerShot, setCanonicalCandidatesPerShot] = useState("1");
	const [canonicalSummary, setCanonicalSummary] = useState<CanonicalPackSummary | null>(null);
	const [selectedCanonicalByShot, setSelectedCanonicalByShot] = useState<Record<string, string>>({});
	const [previewIndex, setPreviewIndex] = useState<number | null>(null);
	const [generatingCanonical, setGeneratingCanonical] = useState(false);
	const [approvingFrontCanonical, setApprovingFrontCanonical] = useState(false);
	const [approvingCanonical, setApprovingCanonical] = useState(false);
	const [canonicalBusy, setCanonicalBusy] = useState(false);
	const [canonicalInfo, setCanonicalInfo] = useState<string | null>(null);
	const [photoImportSnapshot, setPhotoImportSnapshot] = useState<ModelPhotoImportSnapshot | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setCanonicalModelId(canonicalProviderModelDefaults[canonicalProvider]);
	}, [canonicalProvider, canonicalProviderModelDefaults]);

	useEffect(() => {
		if (model && segmentIndex >= 0) setSegmentTitle(segmentIndex, model.name);
		return () => (segmentIndex >= 0 ? setSegmentTitle(segmentIndex, null) : undefined);
	}, [model, segmentIndex, setSegmentTitle]);

	const statusTone = useMemo(() => {
		if (!model) return "neutral" as const;
		if (model.status === "ACTIVE") return "success" as const;
		if (model.status === "DRAFT") return "warning" as const;
		return "danger" as const;
	}, [model]);

	const refreshCanonicalSummary = useCallback(
		async (packVersion?: number, mergeSelection = true) => {
			const suffix = typeof packVersion === "number" && packVersion > 0 ? `?pack_version=${packVersion}` : "";
			const summary = await apiRequest<CanonicalPackSummary | null>(`/api/models/${modelId}/workflow/canonical-pack${suffix}`);
			setCanonicalSummary(summary);
			setSelectedCanonicalByShot(current => {
				if (summary == null || !Array.isArray(summary.shots)) {
					return mergeSelection ? current : {};
				}
				const recommended = buildSelectionMap(summary);
				return mergeSelection ? { ...recommended, ...current } : recommended;
			});
			return summary;
		},
		[modelId]
	);

	const load = useCallback(async () => {
		setError(null);
		try {
			const payload = await apiRequest<ModelDetail>(`/api/models/${modelId}`);
			setModel(payload);
			setModelName(payload.name);
			setModelDescription(payload.description ?? "");
			setSavedModelName(payload.name);
			setSavedModelDescription(payload.description ?? "");

			// Populate character draft
			const loadedBody = (payload.body_profile ?? {}) as Record<string, unknown>;
			const loadedFace = (payload.face_profile ?? {}) as Record<string, unknown>;
			const loadedImps = ((payload.imperfection_fingerprint ?? []) as Array<Record<string, unknown>>).map(item => ({
				type: String(item.type ?? "feature"),
				location: String(item.location ?? "unknown"),
				intensity: Number(item.intensity ?? 0.3)
			}));
			const defaultChar = createDefaultCharacterDraft();
			const nextCharacterDraft: CharacterDesignDraft = {
				body_profile: {
					...defaultChar.body_profile,
					height_cm: Number((loadedBody.height_cm as number | undefined) ?? 172),
					build: (loadedBody.build as CharacterDesignDraft["body_profile"]["build"]) ?? "athletic",
					skin_tone: String((loadedBody.skin_tone as string | undefined) ?? "light olive"),
					hair_color: String((loadedBody.hair_color as string | undefined) ?? "dark brown"),
					hair_length: (loadedBody.hair_length as CharacterDesignDraft["body_profile"]["hair_length"]) ?? "long",
					hair_style: String((loadedBody.hair_style as string | undefined) ?? "soft wave"),
					eye_color: String((loadedBody.eye_color as string | undefined) ?? "brown"),
					distinguishing_features: Array.isArray(loadedBody.distinguishing_features) ? (loadedBody.distinguishing_features as string[]) : [],
					advanced_traits: (loadedBody.advanced_traits as CharacterDesignDraft["body_profile"]["advanced_traits"]) ?? defaultChar.body_profile.advanced_traits
				},
				face_profile: {
					...defaultChar.face_profile,
					face_shape: (loadedFace.face_shape as CharacterDesignDraft["face_profile"]["face_shape"]) ?? "oval",
					jawline: (loadedFace.jawline as CharacterDesignDraft["face_profile"]["jawline"]) ?? "defined",
					cheekbones: (loadedFace.cheekbones as CharacterDesignDraft["face_profile"]["cheekbones"]) ?? "defined"
				},
				imperfection_fingerprint: loadedImps
			};
			setCharacterDraft(cloneForState(nextCharacterDraft));
			setSavedCharacterDraft(cloneForState(nextCharacterDraft));

			// Populate personality draft
			const loadedP = (payload.personality_profile ?? {}) as Record<string, unknown>;
			const loadedComm = (loadedP.communication_style ?? {}) as Record<string, unknown>;
			const nextPersonalityDraft: PersonalityDraft = {
				social_voice: (loadedP.social_voice as PersonalityDraft["social_voice"]) ?? "warm",
				temperament: (loadedP.temperament as PersonalityDraft["temperament"]) ?? "confident",
				interests: Array.isArray(loadedP.interests) ? (loadedP.interests as string[]) : [],
				boundaries: Array.isArray(loadedP.boundaries) ? (loadedP.boundaries as string[]) : [],
				communication_style: {
					caption_tone: (loadedComm.caption_tone as PersonalityDraft["communication_style"]["caption_tone"]) ?? "aspirational",
					emoji_usage: (loadedComm.emoji_usage as PersonalityDraft["communication_style"]["emoji_usage"]) ?? "minimal",
					language_style: (loadedComm.language_style as PersonalityDraft["communication_style"]["language_style"]) ?? "balanced"
				},
				notes: String((loadedP.notes as string | undefined) ?? "")
			};
			setPersonalityDraft(cloneForState(nextPersonalityDraft));
			setSavedPersonalityDraft(cloneForState(nextPersonalityDraft));

			// Populate social tracks draft
			const loadedTracks = (payload.social_tracks_profile ?? {}) as Record<string, unknown>;
			const loadedReality = (loadedTracks.reality_like_daily ?? {}) as Record<string, unknown>;
			const loadedEditorial = (loadedTracks.fashion_editorial ?? {}) as Record<string, unknown>;
			const defaultSocial = createDefaultSocialTracksDraft();
			const nextSocialDraft: SocialTracksDraft = {
				reality_like_daily: {
					enabled: true,
					style_brief: String((loadedReality.style_brief as string | undefined) ?? defaultSocial.reality_like_daily.style_brief),
					prompt_bias: String((loadedReality.prompt_bias as string | undefined) ?? defaultSocial.reality_like_daily.prompt_bias ?? ""),
					target_ratio_percent: Number((loadedReality.target_ratio_percent as number | undefined) ?? 60),
					weekly_post_goal: Number((loadedReality.weekly_post_goal as number | undefined) ?? 3)
				},
				fashion_editorial: {
					enabled: true,
					style_brief: String((loadedEditorial.style_brief as string | undefined) ?? defaultSocial.fashion_editorial.style_brief),
					prompt_bias: String((loadedEditorial.prompt_bias as string | undefined) ?? defaultSocial.fashion_editorial.prompt_bias ?? ""),
					target_ratio_percent: Number((loadedEditorial.target_ratio_percent as number | undefined) ?? 40),
					weekly_post_goal: Number((loadedEditorial.weekly_post_goal as number | undefined) ?? 2)
				}
			};
			setSocialDraft(cloneForState(nextSocialDraft));
			setSavedSocialDraft(cloneForState(nextSocialDraft));

			try {
				await refreshCanonicalSummary(undefined, false);
			} catch {
				setCanonicalSummary(null);
				setSelectedCanonicalByShot({});
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't load this Model. Please refresh and try again.");
		}
	}, [modelId, refreshCanonicalSummary]);

	useEffect(() => {
		void load();
	}, [load]);

	async function handlePhotoImportApplied(payload: ModelPhotoImportApplyResponse) {
		setCharacterDraft(payload.draft.character_design);
		setPersonalityDraft(payload.draft.personality);
		setSocialDraft(payload.draft.social_strategy);
		setCanonicalInfo(
			payload.canonical_job
				? `Reference generation started from imported photos (set v${payload.canonical_job.pack_version}).`
				: (payload.canonical_warning ?? "Model details were updated from your imported photos.")
		);
		await load();
	}

	useEffect(() => {
		if (!canonicalSummary || canonicalSummary.pack_version <= 0 || canonicalSummary.status !== "GENERATING") {
			return;
		}

		const timer = setInterval(() => {
			void refreshCanonicalSummary(canonicalSummary.pack_version)
				.then(summary => {
					if (summary == null || !Array.isArray(summary.shots)) return;
					const completedShots = summary.progress?.completed_shots ?? summary.shots.filter(shot => shot.candidates.length > 0).length;
					const totalShots = summary.progress?.total_shots ?? summary.shots.length;
					const generatedCandidates = summary.progress?.generated_candidates ?? summary.shots.reduce((count, shot) => count + shot.candidates.length, 0);
					setCanonicalInfo(`Generating set v${summary.pack_version}: ${completedShots}/${totalShots} angles, ${generatedCandidates} options ready.`);

					if (summary.status !== "GENERATING") {
						setGeneratingCanonical(false);
						setCanonicalBusy(false);
						if (summary.status === "FAILED") {
							const failMessage = summary.error ? `Generation failed: ${summary.error}` : "Generation failed. Check image engine settings and try again.";
							setCanonicalInfo(failMessage);
							setError(failMessage);
						} else {
							setCanonicalInfo("Generation complete. Review and approve one option per angle.");
						}
						void load();
					}
				})
				.catch(() => {
					// Keep silent in background poll; user can use refresh/retry if needed.
				});
		}, 2500);

		return () => {
			clearInterval(timer);
		};
	}, [canonicalSummary, load, refreshCanonicalSummary]);

	async function saveModelPatch(patch: Record<string, unknown>, fallbackMessage: string) {
		setSaving(true);
		setError(null);
		try {
			await apiRequest(`/api/models/${modelId}`, {
				method: "PUT",
				body: JSON.stringify(patch)
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : fallbackMessage);
		} finally {
			setSaving(false);
		}
	}

	async function saveMetadata() {
		const trimmedName = modelName.trim();
		if (trimmedName.length < 2) {
			setError("Model name must have at least 2 characters.");
			return;
		}

		await saveModelPatch(
			{
				name: trimmedName,
				description: modelDescription.trim()
			},
			"We couldn't save Model basics. Please try again."
		);
	}

	async function saveCharacter() {
		await saveModelPatch(
			{
				body_profile: characterDraft.body_profile,
				face_profile: characterDraft.face_profile,
				imperfection_fingerprint: characterDraft.imperfection_fingerprint
			},
			"We couldn't save Character details. Please try again."
		);
	}

	async function savePersonality() {
		await saveModelPatch(
			{
				personality_profile: personalityDraft
			},
			"We couldn't save Personality details. Please try again."
		);
	}

	async function saveSocialTracks() {
		await saveModelPatch(
			{
				social_tracks_profile: socialDraft
			},
			"We couldn't save Social Strategy details. Please try again."
		);
	}

	async function saveActiveProfileTab() {
		if (profileTab === "character") {
			await saveCharacter();
			return;
		}
		if (profileTab === "personality") {
			await savePersonality();
			return;
		}
		await saveSocialTracks();
	}

	function resetMetadataChanges() {
		setModelName(savedModelName);
		setModelDescription(savedModelDescription);
	}

	function resetActiveProfileTab() {
		if (profileTab === "character") {
			setCharacterDraft(cloneForState(savedCharacterDraft));
			return;
		}
		if (profileTab === "personality") {
			setPersonalityDraft(cloneForState(savedPersonalityDraft));
			return;
		}
		setSocialDraft(cloneForState(savedSocialDraft));
	}

	async function uploadVersion(event: React.FormEvent) {
		event.preventDefault();
		const normalizedStrength = Number(strength);
		if (!Number.isFinite(normalizedStrength) || normalizedStrength < 0.1 || normalizedStrength > 1) {
			setError("Style strength must be a number between 0.1 and 1.");
			return;
		}

		setSaving(true);
		setError(null);

		try {
			const formData = new FormData();
			formData.set("notes", notes);
			formData.set("lora_strength", String(normalizedStrength));
			await apiFormRequest(`/api/models/${modelId}/versions`, formData);
			setNotes("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't upload this version. Please try again.");
		} finally {
			setSaving(false);
		}
	}

	async function activateVersion(versionId: string) {
		setSaving(true);
		setError(null);

		try {
			await apiRequest(`/api/models/${modelId}/versions/${versionId}/activate`, {
				method: "POST"
			});
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't activate this version. Please try again.");
		} finally {
			setSaving(false);
		}
	}

	async function generateCanonicalReferences(input: { mode: "front_only" | "remaining" | "full"; packVersion?: number }) {
		const photoImportIssue = getPhotoImportAnalysisIssue(photoImportSnapshot);
		const frontGenerationBlockReason =
			photoImportSnapshot?.status === "UPLOADING" || photoImportSnapshot?.status === "ANALYZING"
				? "Wait for photo analysis to finish before generating."
				: photoImportIssue?.blocking
					? photoImportIssue.description
					: null;
		if (input.mode === "front_only" && frontGenerationBlockReason) {
			setError(frontGenerationBlockReason);
			setCanonicalInfo(null);
			return;
		}

		setGeneratingCanonical(true);
		setCanonicalBusy(true);
		setError(null);
		setCanonicalInfo(
			input.mode === "front_only" ? "Generating front look options..." : input.mode === "remaining" ? "Generating the remaining reference looks..." : "Starting reference generation..."
		);

		try {
			const started = await apiRequest<{ job_id: string; pack_version: number }>(`/api/models/${modelId}/workflow/canonical-pack/generate`, {
				method: "POST",
				body: JSON.stringify({
					provider: canonicalProvider,
					model_id: canonicalModelId || undefined,
					pack_template: "balanced_8",
					candidates_per_shot: clampInt(canonicalCandidatesPerShot, 1, 1, 5),
					style: "strict_studio",
					generation_mode: input.mode,
					pack_version: input.packVersion
				})
			});
			setCanonicalInfo(`Generation started (set v${started.pack_version}).`);

			let finalStatus: CanonicalPackSummary["status"] = "GENERATING";
			for (let attempt = 0; attempt < 240; attempt += 1) {
				const summary = await refreshCanonicalSummary(started.pack_version);
				if (summary != null && Array.isArray(summary.shots)) {
					finalStatus = summary.status;
					const completedShots = summary.progress?.completed_shots ?? summary.shots.filter(shot => shot.candidates.length > 0).length;
					const totalShots = summary.progress?.total_shots ?? summary.shots.length;
					const generatedCandidates = summary.progress?.generated_candidates ?? summary.shots.reduce((count, shot) => count + shot.candidates.length, 0);
					setCanonicalInfo(`Generating set v${started.pack_version}: ${completedShots}/${totalShots} angles, ${generatedCandidates} options ready.`);

					if (summary.status === "READY" || summary.status === "APPROVED" || summary.status === "FAILED") {
						break;
					}
				}
				await sleep(1500);
			}

			if (finalStatus === "READY" || finalStatus === "APPROVED") {
				setCanonicalInfo(
					input.mode === "front_only" ? "Front look ready. Approve one front option, then generate the remaining looks." : "Generation complete. Review and approve one option per angle."
				);
			} else if (finalStatus === "FAILED") {
				// Try to get the actual error from the latest summary
				try {
					const failSummary = await refreshCanonicalSummary(started.pack_version);
					const failMessage = failSummary?.error ? `Generation failed: ${failSummary.error}` : "Generation failed. Check image engine settings and try again.";
					setCanonicalInfo(failMessage);
					setError(failMessage);
				} catch {
					setCanonicalInfo("Generation failed. Check image engine settings and try again.");
					setError("Generation failed. Check image engine settings and try again.");
				}
			} else {
				setCanonicalInfo("Generation is still running. The gallery will refresh automatically.");
			}

			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't generate references. Please try again.");
			setCanonicalInfo(null);
		} finally {
			setGeneratingCanonical(false);
			setCanonicalBusy(false);
		}
	}

	async function generateFrontCanonicalReferences() {
		await generateCanonicalReferences({ mode: "front_only" });
	}

	async function generateRemainingCanonicalReferences() {
		if (!canonicalSummary || canonicalSummary.pack_version <= 0) {
			setError("Generate and approve a front look option first.");
			return;
		}
		const frontShot = canonicalSummary.shots.find(shot => shot.shot_code === FRONT_SHOT_CODE);
		const frontApproved = (frontShot?.candidates ?? []).some(candidate => candidate.status === "SELECTED");
		if (!frontApproved) {
			setError("Approve a front look option first.");
			return;
		}

		await generateCanonicalReferences({
			mode: "remaining",
			packVersion: canonicalSummary.pack_version
		});
	}

	async function approveFrontCanonicalCandidate() {
		if (!canonicalSummary || canonicalSummary.pack_version <= 0) return;
		const frontShot = canonicalSummary.shots.find(shot => shot.shot_code === FRONT_SHOT_CODE);
		if (!frontShot || frontShot.candidates.length === 0) {
			setError("Generate front look options first.");
			return;
		}
		const candidateId = selectedCanonicalByShot[FRONT_SHOT_CODE] ?? frontShot.candidates.find(candidate => candidate.status === "SELECTED")?.id ?? frontShot.recommended_candidate_id ?? "";
		if (!candidateId) {
			setError("Select a front look option before approving.");
			return;
		}

		setApprovingFrontCanonical(true);
		setCanonicalBusy(true);
		setError(null);
		try {
			await apiRequest(`/api/models/${modelId}/workflow/canonical-pack/approve-front`, {
				method: "POST",
				body: JSON.stringify({
					pack_version: canonicalSummary.pack_version,
					candidate_id: candidateId
				})
			});
			setCanonicalInfo("Front look approved. Generate the remaining looks when you're ready.");
			setSelectedCanonicalByShot(current => ({ ...current, [FRONT_SHOT_CODE]: candidateId }));
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't approve the front look option.");
		} finally {
			setApprovingFrontCanonical(false);
			setCanonicalBusy(false);
		}
	}

	function applyRecommendedSelections() {
		if (!canonicalSummary) return;
		const next: Record<string, string> = {};
		for (const shot of canonicalSummary.shots) {
			next[shot.shot_code] = shot.recommended_candidate_id ?? "";
		}
		setSelectedCanonicalByShot(next);
	}

	async function approveSelectedCanonicalPack() {
		if (!canonicalSummary || canonicalSummary.pack_version <= 0) return;

		const selections = canonicalSummary.shots.map(shot => ({
			shot_code: shot.shot_code,
			candidate_id: selectedCanonicalByShot[shot.shot_code] ?? ""
		}));

		if (selections.some(item => item.candidate_id.length === 0)) {
			setError("You need to choose one option for every angle before approval.");
			return;
		}

		setApprovingCanonical(true);
		setCanonicalBusy(true);
		setError(null);

		try {
			await apiRequest(`/api/models/${modelId}/workflow/canonical-pack/approve`, {
				method: "POST",
				body: JSON.stringify({
					pack_version: canonicalSummary.pack_version,
					selections
				})
			});

			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't approve this Reference Set. Please try again.");
		} finally {
			setApprovingCanonical(false);
			setCanonicalBusy(false);
		}
	}

	const versionColumns: TableShellColumn<ModelVersion>[] = [
		{
			key: "version",
			header: "Version",
			cell: version => <p className="font-medium">v{version.version}</p>
		},
		{
			key: "created",
			header: "Created",
			cell: version => <p className="text-sm">{new Date(version.created_at).toLocaleString()}</p>
		},
		{
			key: "notes",
			header: "Notes",
			cell: version => <p className="line-clamp-2 text-sm text-muted-foreground">{version.notes ?? "-"}</p>
		},
		{
			key: "status",
			header: "Status",
			cell: version =>
				version.is_active ? (
					<Badge tone="success">Active</Badge>
				) : (
					<Button size="sm" variant="secondary" onClick={() => void activateVersion(version.id)} disabled={saving}>
						Activate
					</Button>
				)
		}
	];

	const fallbackReferenceGroups = useMemo(() => {
		const entries = model?.canonical_references ?? [];
		const map = new Map<
			string,
			{
				key: string;
				packVersion: number;
				shotCode: string;
				label: string;
				references: typeof entries;
			}
		>();

		for (const entry of entries) {
			const key = `${entry.pack_version}:${entry.shot_code}`;
			const current = map.get(key);
			if (!current) {
				map.set(key, {
					key,
					packVersion: entry.pack_version,
					shotCode: entry.shot_code,
					label: `Set v${entry.pack_version} · ${formatShotLabel(entry.shot_code)}`,
					references: [entry]
				});
				continue;
			}
			current.references.push(entry);
		}

		return Array.from(map.values())
			.map(group => ({
				...group,
				references: group.references.sort((a, b) => a.sort_order - b.sort_order)
			}))
			.sort((a, b) => b.packVersion - a.packVersion || a.shotCode.localeCompare(b.shotCode));
	}, [model?.canonical_references]);

	const canApproveSelectedPack = useMemo(() => {
		if (!canonicalSummary || canonicalSummary.status !== "READY") return false;
		return canonicalSummary.shots.every(shot => (selectedCanonicalByShot[shot.shot_code] ?? "").length > 0);
	}, [canonicalSummary, selectedCanonicalByShot]);
	const frontShot = useMemo(() => canonicalSummary?.shots.find(shot => shot.shot_code === FRONT_SHOT_CODE) ?? null, [canonicalSummary]);
	const frontShotApproved = useMemo(() => (frontShot?.candidates ?? []).some(candidate => candidate.status === "SELECTED"), [frontShot]);
	const canApproveFrontShot = useMemo(() => {
		if (!canonicalSummary || canonicalSummary.status !== "READY" || !frontShot || frontShotApproved) return false;
		const candidateId = selectedCanonicalByShot[FRONT_SHOT_CODE] ?? frontShot.candidates.find(candidate => candidate.status === "SELECTED")?.id ?? frontShot.recommended_candidate_id ?? "";
		return candidateId.length > 0;
	}, [canonicalSummary, frontShot, frontShotApproved, selectedCanonicalByShot]);
	const hasRemainingCandidates = useMemo(() => Boolean(canonicalSummary?.shots.some(shot => shot.shot_code !== FRONT_SHOT_CODE && shot.candidates.length > 0)), [canonicalSummary]);
	const photoImportIssue = useMemo(() => getPhotoImportAnalysisIssue(photoImportSnapshot), [photoImportSnapshot]);
	const frontGenerationBlockReason = useMemo(() => {
		if (photoImportSnapshot?.status === "UPLOADING" || photoImportSnapshot?.status === "ANALYZING") {
			return "Wait for photo analysis to finish before generating.";
		}
		return photoImportIssue?.blocking ? photoImportIssue.description : null;
	}, [photoImportIssue, photoImportSnapshot?.status]);

	const canonicalProgress = useMemo(() => {
		if (!canonicalSummary) return null;
		const completedShots = canonicalSummary.progress?.completed_shots ?? canonicalSummary.shots.filter(shot => shot.candidates.length > 0).length;
		const totalShots = canonicalSummary.progress?.total_shots ?? canonicalSummary.shots.length;
		const generatedCandidates = canonicalSummary.progress?.generated_candidates ?? canonicalSummary.shots.reduce((count, shot) => count + shot.candidates.length, 0);
		const ratio = totalShots > 0 ? completedShots / totalShots : 0;
		return {
			completedShots,
			totalShots,
			generatedCandidates,
			ratio
		};
	}, [canonicalSummary]);

	const canonicalStatus = canonicalSummary?.status ?? model?.canonical_pack_status ?? "NOT_STARTED";
	const metadataDirty = useMemo(
		() => modelName.trim() !== savedModelName.trim() || modelDescription.trim() !== savedModelDescription.trim(),
		[modelDescription, modelName, savedModelDescription, savedModelName]
	);
	const characterDirty = useMemo(() => !isDraftEqual(characterDraft, savedCharacterDraft), [characterDraft, savedCharacterDraft]);
	const personalityDirty = useMemo(() => !isDraftEqual(personalityDraft, savedPersonalityDraft), [personalityDraft, savedPersonalityDraft]);
	const socialDirty = useMemo(() => !isDraftEqual(socialDraft, savedSocialDraft), [savedSocialDraft, socialDraft]);
	const dirtyByTab: Record<ProfileTab, boolean> = useMemo(
		() => ({
			character: characterDirty,
			personality: personalityDirty,
			social: socialDirty
		}),
		[characterDirty, personalityDirty, socialDirty]
	);
	const activeProfileLabel = PROFILE_TAB_CONFIG.find(tab => tab.key === profileTab)?.label ?? "Profile";
	const activeProfileDirty = dirtyByTab[profileTab];
	const pendingSectionCount = [metadataDirty, characterDirty, personalityDirty, socialDirty].filter(Boolean).length;
	const selectedCanonicalCount = useMemo(
		() => (canonicalSummary ? canonicalSummary.shots.filter(shot => (selectedCanonicalByShot[shot.shot_code] ?? "").length > 0).length : 0),
		[canonicalSummary, selectedCanonicalByShot]
	);
	const totalCanonicalShots = canonicalSummary?.shots.length ?? 0;
	const referenceSnapshotCards = useMemo(() => {
		if (!canonicalSummary) return [];

		return canonicalSummary.shots
			.map(shot => {
				const selectedCandidateId =
					selectedCanonicalByShot[shot.shot_code] ??
					shot.candidates.find(candidate => candidate.status === "SELECTED")?.id ??
					shot.recommended_candidate_id ??
					"";
				if (!selectedCandidateId) return null;

				const selectedCandidate = shot.candidates.find(candidate => candidate.id === selectedCandidateId);
				if (!selectedCandidate) return null;

				const matchingReference = (model?.canonical_references ?? []).find(
					reference => reference.pack_version === canonicalSummary.pack_version && reference.shot_code === shot.shot_code
				);
				const previewUri = resolveCandidatePreviewUri(selectedCandidate) ?? resolveAssetPreviewUri(matchingReference?.reference_image_url);

				return {
					key: `${canonicalSummary.pack_version}:${shot.shot_code}`,
					shotCode: shot.shot_code,
					candidateIndex: selectedCandidate.candidate_index,
					score: Number(selectedCandidate.composite_score ?? 0),
					previewUri,
					sourceUri: matchingReference?.reference_image_url ?? selectedCandidate.image_gcs_uri,
					notes: matchingReference?.notes ?? null
				};
			})
			.filter(
				(
					item
				): item is {
					key: string;
					shotCode: string;
					candidateIndex: number;
					score: number;
					previewUri: string | null;
					sourceUri: string;
					notes: string | null;
				} => Boolean(item)
			);
	}, [canonicalSummary, model?.canonical_references, selectedCanonicalByShot]);
	const referenceSnapshotHeading = canonicalStatus === "APPROVED" ? "Approved Reference Snapshot" : "Current Reference Snapshot";

	const previewCandidates = useMemo(() => {
		if (!canonicalSummary) return [];
		return canonicalSummary.shots.flatMap(shot =>
			shot.candidates
				.map(candidate => {
					const uri = resolveCandidatePreviewUri(candidate);
					if (!uri) return null;
					return {
						id: candidate.id,
						uri,
						shotCode: shot.shot_code,
						candidateIndex: candidate.candidate_index,
						score: Number(candidate.composite_score ?? 0)
					};
				})
				.filter((item): item is { id: string; uri: string; shotCode: string; candidateIndex: number; score: number } => Boolean(item))
		);
	}, [canonicalSummary]);
	const activePreview = typeof previewIndex === "number" ? previewCandidates[previewIndex] : null;
	const candidateGroups = useMemo(() => {
		if (!canonicalSummary) return [];
		const indices = new Set<number>();
		for (const shot of canonicalSummary.shots) {
			for (const candidate of shot.candidates) {
				indices.add(candidate.candidate_index);
			}
		}

		return Array.from(indices)
			.sort((a, b) => a - b)
			.map(candidateIndex => ({
				candidateIndex,
				types: canonicalSummary.shots.map(shot => {
					const candidate = shot.candidates.find(item => item.candidate_index === candidateIndex);
					return {
						shotCode: shot.shot_code,
						candidate,
						isRecommended: candidate ? shot.recommended_candidate_id === candidate.id : false
					};
				})
			}));
	}, [canonicalSummary]);
	const candidateNumbers = useMemo(() => Array.from(new Set(previewCandidates.map(item => item.candidateIndex))).sort((a, b) => a - b), [previewCandidates]);
	const activeCandidateNumber = activePreview?.candidateIndex ?? candidateNumbers[0] ?? null;
	const activeCandidateItems = useMemo(
		() => (activeCandidateNumber == null ? [] : previewCandidates.filter(item => item.candidateIndex === activeCandidateNumber)),
		[activeCandidateNumber, previewCandidates]
	);
	const activeTypeShotCodes = useMemo(() => Array.from(new Set(activeCandidateItems.map(item => item.shotCode))), [activeCandidateItems]);
	const activeShotCode = activePreview?.shotCode ?? activeTypeShotCodes[0] ?? null;
	const activeCandidatePosition = activeCandidateNumber == null ? -1 : candidateNumbers.indexOf(activeCandidateNumber);
	const activeShotPosition = activeShotCode == null ? -1 : activeTypeShotCodes.indexOf(activeShotCode);
	const totalShotTypes = candidateGroups[0]?.types.length ?? canonicalSummary?.shots.length ?? 0;
	const canGoPrevCandidate = activeCandidatePosition > 0;
	const canGoNextCandidate = activeCandidatePosition >= 0 && activeCandidatePosition < candidateNumbers.length - 1;
	const canGoPrevType = activeShotPosition > 0;
	const canGoNextType = activeShotPosition >= 0 && activeShotPosition < activeTypeShotCodes.length - 1;
	const setPreviewByCandidateAndType = (candidateNumber: number, shotCode?: string) => {
		const pool = previewCandidates.filter(item => item.candidateIndex === candidateNumber);
		if (pool.length === 0) return;
		const first = pool[0];
		if (!first) return;
		const target = shotCode ? (pool.find(item => item.shotCode === shotCode) ?? first) : first;
		const idx = previewCandidates.findIndex(item => item.id === target.id);
		if (idx >= 0) {
			setPreviewIndex(idx);
		}
	};

	useEffect(() => {
		if (!activePreview) return;

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setPreviewIndex(null);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			document.body.style.overflow = previousOverflow;
		};
	}, [activePreview]);

	return (
		<div className="space-y-4">
			<PageHeader
				title={model ? `${model.name} · Model Editor` : "Model Profile"}
				description="Update identity, personality, strategy, versions, and references from one place."
				action={
					<Button type="button" variant="secondary" onClick={() => void load()} disabled={saving || canonicalBusy}>
						<RefreshCw className={`h-4 w-4 ${saving || canonicalBusy ? "animate-spin" : ""}`} />
						Refresh Data
					</Button>
				}
			/>

			{!model && !error ? <StateBlock title="Loading Model profile..." /> : null}
			{error ? <StateBlock tone="error" title="Model update issue" description={error} /> : null}

			{model ? (
				<>
					<FilterShell className="flex flex-wrap items-center justify-between gap-2">
						<div className="flex items-center gap-2">
							<Badge tone={statusTone}>{humanizeStatusLabel(model.status)}</Badge>
							<Badge tone={pendingSectionCount > 0 ? "warning" : "success"}>{pendingSectionCount > 0 ? "Unsaved edits" : "In sync"}</Badge>
						</div>
						<p className="max-w-3xl text-sm text-muted-foreground">{model.description ?? "No description yet."}</p>
					</FilterShell>
				</>
			) : null}

			<FormShell title="Model Basics" description="Keep this model profile up to date for your team and setup flow.">
				<div className="space-y-4">
					<div className="grid gap-3 md:grid-cols-[1fr_1.2fr]">
						<FormField label="Model Name" required>
							<Input value={modelName} onChange={event => setModelName(event.target.value)} minLength={2} maxLength={50} placeholder="Model name" />
						</FormField>
						<FormField label="Description">
							<Textarea
								value={modelDescription}
								onChange={event => setModelDescription(event.target.value)}
								rows={2}
								maxLength={500}
								placeholder="Describe the model's style and positioning..."
							/>
						</FormField>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">{metadataDirty ? "Metadata has unsaved changes." : "Metadata is saved."}</p>
						<div className="flex items-center gap-2">
							<Button type="button" variant="ghost" onClick={resetMetadataChanges} disabled={saving || !metadataDirty}>
								Reset
							</Button>
							<Button type="button" onClick={() => void saveMetadata()} disabled={saving || !model || !metadataDirty}>
								{saving ? "Saving..." : "Save Basics"}
							</Button>
						</div>
					</div>
				</div>
			</FormShell>

			<div className="space-y-4">
				<div className="flex gap-1 rounded-2xl border border-border/60 bg-muted/40 p-1.5">
					{PROFILE_TAB_CONFIG.map(tab => (
						<button
							key={tab.key}
							type="button"
							onClick={() => setProfileTab(tab.key)}
							className={`flex-1 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-150 ${
								profileTab === tab.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
							}`}>
							<span className="inline-flex items-center gap-1.5">
								{tab.label}
								{dirtyByTab[tab.key] ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--status-warning)]" aria-hidden="true" /> : null}
							</span>
							<p className="mt-0.5 text-[10px] font-normal opacity-70">{tab.desc}</p>
						</button>
					))}
				</div>

				{profileTab === "character" ? <StepCharacterDesign value={characterDraft} showAdvanced={false} onChange={setCharacterDraft} /> : null}
				{profileTab === "personality" ? <StepPersonality value={personalityDraft} showAdvanced={false} onChange={setPersonalityDraft} /> : null}
				{profileTab === "social" ? <StepSocialStrategy value={socialDraft} showAdvanced={false} onChange={setSocialDraft} /> : null}

				<FilterShell className="flex flex-wrap items-center justify-between gap-2">
					<p className="text-xs text-muted-foreground">{activeProfileDirty ? `${activeProfileLabel} has unsaved changes.` : `${activeProfileLabel} is saved.`}</p>
					<div className="flex items-center gap-2">
						<Button type="button" variant="ghost" onClick={resetActiveProfileTab} disabled={saving || !activeProfileDirty}>
							Reset
						</Button>
						<Button type="button" onClick={() => void saveActiveProfileTab()} disabled={saving || !model || !activeProfileDirty}>
							{saving ? "Saving..." : `Save ${activeProfileLabel}`}
						</Button>
					</div>
				</FilterShell>
			</div>

			<FormShell title="Model Versions" description="Upload and activate versions for this Model.">
				<form className="grid gap-3 md:grid-cols-[1fr_160px_160px] md:items-end" onSubmit={uploadVersion}>
					<FormField label="Version Notes">
						<Input value={notes} onChange={event => setNotes(event.target.value)} placeholder="What changed in this version?" />
					</FormField>
					<FormField label="Style Strength">
						<Input type="number" value={strength} onChange={event => setStrength(event.target.value)} inputMode="decimal" step="0.05" min={0.1} max={1} />
					</FormField>
					<Button type="submit" disabled={saving || !model}>
						Add Version
					</Button>
				</form>
			</FormShell>

			<TableShell
				title="Version History"
				description="Activate a version to use it by default for new image creation."
				rows={model?.model_versions ?? []}
				columns={versionColumns}
				rowKey={row => row.id}
				emptyMessage="No versions uploaded yet."
			/>

			<FormShell title="Reference Studio" description="Imported photos and reference set curation are managed together here.">
				{model ? (
					<div className="mb-4 rounded-xl border border-border bg-card/75 p-3">
						<ModelPhotoImporter
							modelId={modelId}
							onApplied={handlePhotoImportApplied}
							onSnapshotChange={setPhotoImportSnapshot}
							embedded
							canonicalSettings={{
								provider: canonicalProvider,
								providerModelId: canonicalModelId,
								candidatesPerShot: Math.max(1, Math.min(5, Number(canonicalCandidatesPerShot || "1"))),
								onProviderChange: provider => setCanonicalProvider(provider),
								onProviderModelIdChange: modelId => setCanonicalModelId(modelId),
								onCandidatesPerShotChange: count => setCanonicalCandidatesPerShot(String(Math.max(1, Math.min(5, Math.trunc(count || 1)))))
							}}
						/>
					</div>
				) : null}

				{frontGenerationBlockReason || photoImportIssue ? (
					<StateBlock
						tone={photoImportSnapshot?.status === "UPLOADING" || photoImportSnapshot?.status === "ANALYZING" ? "neutral" : photoImportIssue?.tone === "danger" ? "warning" : "neutral"}
						title={
							photoImportSnapshot?.status === "UPLOADING" || photoImportSnapshot?.status === "ANALYZING"
								? "Photo analysis is still running"
								: photoImportIssue?.title ?? "Photo analysis needs attention"
						}
						description={frontGenerationBlockReason ?? photoImportIssue?.description ?? "Review the imported photos before generating."}
					/>
				) : null}

				<div className="mb-3 grid gap-3 md:grid-cols-4 items-end rounded-xl border border-border bg-card/55 p-3">
					<FormField label="Image Engine">
						<SelectField value={canonicalProvider} onChange={event => setCanonicalProvider(event.target.value as CanonicalProvider)}>
							<option value="openai">OpenAI</option>
							<option value="nano_banana_2">Nano Banana 2</option>
							<option value="zai_glm">Z.AI GLM</option>
							<option value="gpu">GPU</option>
						</SelectField>
					</FormField>
					<FormField label="Engine Version">
						<Input value={canonicalModelId} onChange={event => setCanonicalModelId(event.target.value)} />
					</FormField>
					<FormField label="Options per Angle">
						<Input value={canonicalCandidatesPerShot} onChange={event => setCanonicalCandidatesPerShot(event.target.value)} inputMode="numeric" />
					</FormField>
					<div>
						<Button className="w-full" type="button" onClick={() => void generateFrontCanonicalReferences()} disabled={canonicalBusy || Boolean(frontGenerationBlockReason)}>
							{generatingCanonical ? "Generating..." : frontShot?.candidates.length ? "Regenerate Front Look" : "Generate Front Look"}
						</Button>
					</div>
				</div>

				<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
					<p className="text-xs text-muted-foreground">
						{totalCanonicalShots > 0
							? `Selection progress: ${selectedCanonicalCount}/${totalCanonicalShots} angles picked`
							: "Generate a set to start selecting one option per angle."}
					</p>
					<Badge tone={canonicalStatus === "APPROVED" ? "success" : canonicalStatus === "FAILED" ? "danger" : "warning"}>{humanizeStatusLabel(canonicalStatus)}</Badge>
				</div>

				<div className="mb-4 flex flex-wrap items-center gap-2">
					{canonicalSummary?.status === "READY" && frontShot && frontShot.candidates.length > 0 && !frontShotApproved ? (
						<Button type="button" variant="secondary" onClick={() => void approveFrontCanonicalCandidate()} disabled={canonicalBusy || !canApproveFrontShot}>
							{approvingFrontCanonical ? "Approving Front..." : "Approve Front Option"}
						</Button>
					) : null}
					{frontShotApproved && canonicalSummary?.status === "READY" ? (
						<Button type="button" variant="secondary" onClick={() => void generateRemainingCanonicalReferences()} disabled={canonicalBusy}>
							{generatingCanonical ? "Generating..." : hasRemainingCandidates ? "Regenerate Remaining Looks" : "Generate Remaining Looks"}
						</Button>
					) : null}
					{canonicalSummary?.status === "READY" ? (
						<Button type="button" variant="ghost" onClick={applyRecommendedSelections} disabled={canonicalBusy}>
							Use Recommended
						</Button>
					) : null}
					{canonicalSummary?.status === "READY" ? (
						<Button type="button" variant="secondary" onClick={() => void approveSelectedCanonicalPack()} disabled={canonicalBusy || !canApproveSelectedPack}>
							{approvingCanonical ? "Approving..." : "Approve Selected Set"}
						</Button>
					) : null}
					<Button type="button" variant="ghost" onClick={() => void (canonicalSummary?.pack_version ? refreshCanonicalSummary(canonicalSummary.pack_version) : load())} disabled={canonicalBusy}>
						Refresh
					</Button>
				</div>

				{canonicalSummary?.status === "GENERATING" || generatingCanonical ? (
					<StateBlock tone="neutral" title="Reference generation is running" description={canonicalInfo ?? "The gallery refreshes every few seconds while options are generated."} />
				) : null}

				{canonicalStatus === "FAILED" ? (
					<StateBlock
						tone="error"
						title="Reference set generation failed"
						description={canonicalSummary?.error || canonicalInfo || "Something went wrong. Check image engine settings and try again."}
					/>
				) : null}

				{canonicalSummary && canonicalSummary.pack_version > 0 ? (
					<div className="mb-4 space-y-2 rounded-xl border border-border bg-card p-3">
						<p className="text-xs font-subheader">{`Reference Set v${canonicalSummary.pack_version} (${humanizeStatusLabel(canonicalSummary.status)})`}</p>
						{canonicalProgress ? (
								<div className="rounded-md border border-border bg-card/75 p-2">
								<p className="text-[11px] text-muted-foreground">{`${canonicalProgress.completedShots}/${canonicalProgress.totalShots} angles ready · ${canonicalProgress.generatedCandidates} options ready`}</p>
								<div className="mt-2 h-2 overflow-hidden rounded-full bg-muted/60">
									<div className="h-full rounded-full bg-[var(--color-primary)] transition-all duration-500" style={{ width: `${Math.max(6, Math.min(100, canonicalProgress.ratio * 100))}%` }} />
								</div>
							</div>
						) : null}
						<div className="space-y-3">
							{candidateGroups.map(group => (
								<div key={`candidate-group-${group.candidateIndex}`} className="rounded-lg border border-border bg-card/85 p-2">
									<p className="text-xs font-medium">{`Option #${group.candidateIndex}`}</p>
									<p className="text-[11px] text-muted-foreground">{`${group.types.filter(item => Boolean(item.candidate)).length}/${group.types.length} angles ready`}</p>
									<div className="mt-2 grid gap-2 md:grid-cols-2 lg:grid-cols-4">
										{group.types.map(typeItem => {
											const candidate = typeItem.candidate;
											if (!candidate) {
												return (
													<div key={`${group.candidateIndex}-${typeItem.shotCode}`} className="rounded-md border border-dashed border-border bg-card/70 p-3 text-[11px] text-muted-foreground">
														<p className="font-medium">{formatShotLabel(typeItem.shotCode)}</p>
														<p className="mt-1">{canonicalSummary.status === "GENERATING" ? "Still generating this angle..." : "No image for this angle."}</p>
													</div>
												);
											}

											const selected = selectedCanonicalByShot[typeItem.shotCode] === candidate.id;
											const score = Number(candidate.composite_score ?? 0);
											const previewUri = resolveCandidatePreviewUri(candidate);

											return (
												<button
													key={candidate.id}
													type="button"
													onClick={() =>
														setSelectedCanonicalByShot(current => ({
															...current,
															[typeItem.shotCode]: candidate.id
														}))
													}
													className={`rounded-md border p-2 text-left transition ${
									selected ? "border-[var(--color-primary)] bg-[color:color-mix(in_oklab,var(--color-primary),transparent_88%)]" : "border-border bg-card hover:border-[var(--color-primary)]"
													}`}>
													<p className="mb-1 text-[10px] font-medium text-muted-foreground">{formatShotLabel(typeItem.shotCode)}</p>
													<SquareImageThumbnail
														src={previewUri}
														alt={`Option ${candidate.candidate_index} ${formatShotLabel(typeItem.shotCode)}`}
														placeholder="Preview unavailable"
														containerClassName="mb-1"
														expandButton={{
															"aria-label": "Expand image",
															onExpand: () => {
																const idx = previewCandidates.findIndex(item => item.id === candidate.id);
																if (idx >= 0) setPreviewIndex(idx);
															}
														}}
													/>
													<div className="flex items-center justify-between gap-2">
														<p className="text-[10px] text-muted-foreground">{`Score: ${score.toFixed(3)}`}</p>
														<div className="flex items-center gap-1.5">
															{typeItem.isRecommended ? <Badge tone="success">Recommended</Badge> : null}
															{selected ? <Badge tone="warning">Selected</Badge> : null}
														</div>
													</div>
												</button>
											);
										})}
									</div>
								</div>
							))}
						</div>
					</div>
				) : null}

				{referenceSnapshotCards.length > 0 ? (
					<section className="space-y-2">
						<p className="text-xs font-subheader">{referenceSnapshotHeading}</p>
						<div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
							{referenceSnapshotCards.map(card => (
								<article key={card.key} className="rounded-xl border border-border bg-card/85 p-3">
									<div className="mb-2 flex items-center justify-between gap-2">
										<p className="text-[11px] font-semibold">{formatShotLabel(card.shotCode)}</p>
										<Badge tone="warning">{`Option #${card.candidateIndex}`}</Badge>
									</div>
									{card.previewUri ? (
										<SquareImageThumbnail
											src={card.previewUri}
											alt={`${formatShotLabel(card.shotCode)} selected reference`}
											containerClassName="rounded-lg border-border"
										/>
									) : (
										<div className="rounded-lg border border-dashed border-border bg-card p-3 text-xs text-muted-foreground">Preview unavailable for this angle.</div>
									)}
									<div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
										<p>{`Score ${card.score.toFixed(3)}`}</p>
										{card.notes ? <p>{card.notes}</p> : null}
										{!card.previewUri ? <p className="break-all">{compactPathLabel(card.sourceUri)}</p> : null}
									</div>
								</article>
							))}
						</div>
					</section>
				) : fallbackReferenceGroups.length === 0 ? (
					<StateBlock title="No approved reference set yet." description="Generate a reference set, choose one option per angle, then approve to fill this gallery." />
				) : (
					<div className="grid gap-3 md:grid-cols-2">
						{fallbackReferenceGroups.map(group => (
							<div key={group.key} className="space-y-2 rounded-xl border border-border bg-card/85 p-3">
								<p className="font-subheader text-[11px]">{group.label}</p>
								{group.references.map(reference => (
									<div key={reference.id} className="rounded-lg border border-border bg-card p-2">
										<p className="break-all text-xs text-muted-foreground/80">{compactPathLabel(reference.reference_image_url)}</p>
										{reference.notes ? <p className="mt-1 text-xs text-muted-foreground/70">{reference.notes}</p> : null}
									</div>
								))}
							</div>
						))}
					</div>
				)}
			</FormShell>

			{activePreview ? (
				<div className="fixed inset-0 z-50 bg-background/85 p-3 backdrop-blur-sm sm:p-4" onClick={() => setPreviewIndex(null)}>
					<div
						className="mx-auto flex h-full w-full max-w-[1600px] flex-col overflow-hidden rounded-3xl border border-border/70 bg-card text-foreground shadow-[var(--shadow-lift)]"
						onClick={event => event.stopPropagation()}>
						<div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/70 p-3 sm:p-4">
							<div>
								<p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Expanded Preview</p>
								<p className="text-sm font-semibold">{`${formatShotLabel(activePreview.shotCode)} · Option #${activePreview.candidateIndex}`}</p>
								<p className="text-xs text-muted-foreground">{`Score ${activePreview.score.toFixed(3)} · ${activeCandidateItems.length}/${totalShotTypes} angles ready`}</p>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<p className="rounded-full border border-border/80 bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground">
									{`Option ${Math.max(activeCandidatePosition + 1, 1)}/${Math.max(candidateNumbers.length, 1)}`}
								</p>
								<Button type="button" size="sm" variant="secondary" onClick={() => setPreviewIndex(null)}>
									Close
								</Button>
							</div>
						</div>

						<div className="grid min-h-0 flex-1 gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
							<div className="relative min-h-[46vh] min-w-0 overflow-hidden rounded-2xl border border-border/70 bg-muted/60 lg:min-h-0">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src={activePreview.uri} alt={`Expanded option ${activePreview.candidateIndex}`} className="h-full w-full object-contain p-1.5 sm:p-2.5 lg:p-3" />
								<div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-3 sm:p-4">
									<div className="flex items-end justify-between gap-2">
										<p className="text-sm font-medium">{formatShotLabel(activePreview.shotCode)}</p>
										<p className="text-[11px] text-muted-foreground">{`Type ${Math.max(activeShotPosition + 1, 1)}/${Math.max(activeTypeShotCodes.length, 1)}`}</p>
									</div>
								</div>
							</div>

							<aside className="flex min-h-0 flex-col gap-3 rounded-2xl border border-border/70 bg-muted/45 p-2.5 sm:p-3">
								<section className="rounded-xl border border-border/70 bg-muted/30 p-2.5">
									<div className="mb-2 flex items-center justify-between gap-2">
										<p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Options</p>
										<div className="flex items-center gap-2">
											<Button
												type="button"
												size="sm"
												variant="secondary"
												onClick={() => {
													if (!canGoPrevCandidate || activeCandidateNumber == null) return;
													setPreviewByCandidateAndType(candidateNumbers[activeCandidatePosition - 1] ?? activeCandidateNumber, activeShotCode ?? undefined);
												}}
												disabled={!canGoPrevCandidate}>
												Prev
											</Button>
											<Button
												type="button"
												size="sm"
												variant="secondary"
												onClick={() => {
													if (!canGoNextCandidate || activeCandidateNumber == null) return;
													setPreviewByCandidateAndType(candidateNumbers[activeCandidatePosition + 1] ?? activeCandidateNumber, activeShotCode ?? undefined);
												}}
												disabled={!canGoNextCandidate}>
												Next
											</Button>
										</div>
									</div>
									<div className="grid max-h-[26vh] gap-2 overflow-y-auto pr-1">
										{candidateNumbers.map(candidateNumber => {
											const group = candidateGroups.find(item => item.candidateIndex === candidateNumber);
											const readyTypes = group ? group.types.filter(item => Boolean(item.candidate)).length : 0;
											const isActive = candidateNumber === activeCandidateNumber;
											return (
												<button
													key={`candidate-modal-${candidateNumber}`}
													type="button"
													className={`w-full rounded-xl border px-3 py-2 text-left transition ${
														isActive
															? "border-primary/70 bg-primary/20 text-primary-foreground"
															: "border-border/70 bg-muted/60 text-muted-foreground hover:border-primary/30 hover:bg-muted/70"
													}`}
													onClick={() => setPreviewByCandidateAndType(candidateNumber, activeShotCode ?? undefined)}>
													<p className="text-xs font-semibold">{`Option #${candidateNumber}`}</p>
													<p className="text-[11px] text-muted-foreground/85">{`${readyTypes}/${totalShotTypes} angles ready`}</p>
												</button>
											);
										})}
									</div>
								</section>

								<section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border/70 bg-muted/35 p-2.5">
									<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
										<p className="text-xs font-medium text-foreground/85">{`Angles for Option #${activeCandidateNumber ?? "-"}`}</p>
										<div className="flex items-center gap-2">
											<Button
												type="button"
												size="sm"
												variant="secondary"
												onClick={() => {
													if (!canGoPrevType || activeCandidateNumber == null) return;
													const prevShotCode = activeTypeShotCodes[activeShotPosition - 1];
													if (!prevShotCode) return;
													setPreviewByCandidateAndType(activeCandidateNumber, prevShotCode);
												}}
												disabled={!canGoPrevType}>
												Prev Type
											</Button>
											<Button
												type="button"
												size="sm"
												variant="secondary"
												onClick={() => {
													if (!canGoNextType || activeCandidateNumber == null) return;
													const nextShotCode = activeTypeShotCodes[activeShotPosition + 1];
													if (!nextShotCode) return;
													setPreviewByCandidateAndType(activeCandidateNumber, nextShotCode);
												}}
												disabled={!canGoNextType}>
												Next Type
											</Button>
										</div>
									</div>
									<div className="grid min-h-0 flex-1 auto-rows-max gap-2 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
										{activeCandidateItems.map(item => {
											const isActive = item.shotCode === activeShotCode;
											return (
												<button
													key={`type-modal-${item.id}`}
													type="button"
													className={`rounded-xl border p-1.5 text-left transition ${
														isActive
															? "border-primary/75 bg-primary/20 text-primary-foreground"
															: "border-border/70 bg-muted/60 text-foreground hover:border-primary/35 hover:bg-muted/70"
													}`}
													onClick={() => {
														if (activeCandidateNumber == null) return;
														setPreviewByCandidateAndType(activeCandidateNumber, item.shotCode);
													}}>
													<div className="h-20 overflow-hidden rounded-lg border border-border/70 bg-muted/70">
														{/* eslint-disable-next-line @next/next/no-img-element */}
														<img src={item.uri} alt={`Option ${item.candidateIndex} ${formatShotLabel(item.shotCode)}`} className="h-full w-full object-contain p-1" />
													</div>
													<div className="mt-1 flex items-center justify-between gap-2 px-1">
														<p className="truncate text-[11px] text-foreground/85">{formatShotLabel(item.shotCode)}</p>
														<p className="text-[10px] text-muted-foreground">{item.score.toFixed(3)}</p>
													</div>
												</button>
											);
										})}
									</div>
								</section>
							</aside>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}

function cloneForState<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isDraftEqual<T>(a: T, b: T): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function formatShotLabel(shotCode: string): string {
	return shotCode
		.split("_")
		.map(token => token.charAt(0).toUpperCase() + token.slice(1))
		.join(" ");
}

function compactPathLabel(path: string, maxLength = 82): string {
	if (path.length <= maxLength) return path;
	const head = path.slice(0, Math.max(24, Math.floor(maxLength / 2)));
	const tail = path.slice(-Math.max(24, Math.floor(maxLength / 2) + (maxLength % 2)));
	return `${head}...${tail}`;
}

function buildSelectionMap(summary: CanonicalPackSummary | null): Record<string, string> {
	if (summary == null || !Array.isArray(summary.shots)) return {};
	const selected: Record<string, string> = {};
	for (const shot of summary.shots) {
		const selectedCandidate = shot.candidates.find(candidate => candidate.status === "SELECTED");
		selected[shot.shot_code] = selectedCandidate?.id ?? shot.recommended_candidate_id ?? "";
	}
	return selected;
}

function resolveCandidatePreviewUri(candidate: { image_gcs_uri: string; preview_image_url?: string | null }): string | null {
	const preview = candidate.preview_image_url?.trim();
	if (preview) return preview;

	return resolveAssetPreviewUri(candidate.image_gcs_uri);
}

function resolveAssetPreviewUri(source: string | null | undefined): string | null {
	const normalized = source?.trim();
	if (!normalized) return null;

	if (normalized.startsWith("data:image/")) return normalized;
	if (normalized.startsWith("http://") || normalized.startsWith("https://")) return normalized;
	return null;
}
