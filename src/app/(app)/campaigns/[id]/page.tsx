"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { type ReactNode, FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clapperboard, ImagePlus, RefreshCw, ScanFace, SlidersHorizontal, Sparkles, WandSparkles } from "lucide-react";
import { CampaignAssetLightbox } from "@/components/campaigns/campaign-asset-lightbox";
import { CampaignModelPicker, type CampaignModelPickerItem } from "@/components/campaigns/campaign-model-picker";
import { CostEstimate } from "@/components/campaigns/cost-estimate";
import { DropZone } from "@/components/campaigns/drop-zone";
import { GenerationProgress } from "@/components/campaigns/generation-progress";
import { PromptSuggestions } from "@/components/campaigns/prompt-suggestions";
import { ResolutionPicker } from "@/components/campaigns/resolution-picker";
import { PageHeader } from "@/components/layout/page-header";
import { useBreadcrumb } from "@/components/providers/breadcrumb-provider";
import { useNotice } from "@/components/providers/notice-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorialCard } from "@/components/ui/editorial-card";
import { ImageGenerationSurface } from "@/components/ui/image-generation-surface";
import { Input } from "@/components/ui/input";
import { OptionCardGrid } from "@/components/ui/option-card-grid";
import { SelectField } from "@/components/ui/select";
import { SliderWithPreview } from "@/components/ui/slider-with-preview";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { ToggleRow } from "@/components/ui/toggle-row";
import { XpProgressBar } from "@/components/ui/xp-progress-bar";
import { FormField } from "@/components/workspace/form-field";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiFormRequest, apiRequest } from "@/lib/client-api";
import { CAMPAIGN_VIDEO_DURATION_VALUES, type CampaignVideoDurationSeconds, type CampaignVideoGenerationScope, DEFAULT_CAMPAIGN_VIDEO_SETTINGS } from "@/lib/campaign-video";
import { humanizeStatusLabel, toneForCampaignStatus } from "@/lib/status-labels";
import { clampFloat } from "@/lib/utils";

const POSE_VALUES = ["editorial", "casual", "jewelry_focus", "seated", "walking"] as const;
const EXPRESSION_VALUES = ["neutral", "soft_smile", "intense_gaze", "contemplative", "distant"] as const;
const SILHOUETTE_VALUES = ["fitted", "oversized", "structured", "flowing"] as const;
const LENS_VALUES = ["35mm_doc", "50mm_portrait", "85mm_editorial", "105mm_beauty"] as const;

type PosePreset = (typeof POSE_VALUES)[number];
type ExpressionPreset = (typeof EXPRESSION_VALUES)[number];
type Silhouette = (typeof SILHOUETTE_VALUES)[number];
type LensSimulation = (typeof LENS_VALUES)[number];
type ImageProvider = "gpu" | "openai" | "nano_banana_2" | "zai_glm";
type CampaignStatus = "DRAFT" | "GENERATING" | "REVIEW" | "APPROVED" | "REJECTED" | "SCHEDULED" | "PUBLISHED" | "FAILED";

const POSE_LABELS: Record<PosePreset, string> = {
	editorial: "editorial fashion pose",
	casual: "relaxed casual stance",
	jewelry_focus: "hands-forward jewelry focus",
	seated: "elegantly seated",
	walking: "confident walking stride"
};

const EXPRESSION_LABELS: Record<ExpressionPreset, string> = {
	neutral: "neutral expression",
	soft_smile: "soft natural smile",
	intense_gaze: "intense direct gaze",
	contemplative: "thoughtful contemplative look",
	distant: "dreamy distant expression"
};

const SILHOUETTE_LABELS: Record<Silhouette, string> = {
	fitted: "fitted silhouette",
	oversized: "oversized relaxed fit",
	structured: "structured tailored look",
	flowing: "flowing draping fabric"
};

const LENS_LABELS: Record<LensSimulation, string> = {
	"35mm_doc": "35mm documentary lens",
	"50mm_portrait": "50mm portrait lens",
	"85mm_editorial": "85mm editorial lens",
	"105mm_beauty": "105mm beauty lens"
};

const POSE_OPTIONS = [
	{ value: "editorial" as const, label: "Editorial", emoji: "📸" },
	{ value: "casual" as const, label: "Casual", emoji: "🚶" },
	{ value: "jewelry_focus" as const, label: "Jewelry", emoji: "💍" },
	{ value: "seated" as const, label: "Seated", emoji: "🪑" },
	{ value: "walking" as const, label: "Walking", emoji: "🏃" }
];

const EXPRESSION_OPTIONS = [
	{ value: "neutral" as const, label: "Neutral", emoji: "😐" },
	{ value: "soft_smile" as const, label: "Soft Smile", emoji: "🙂" },
	{ value: "intense_gaze" as const, label: "Intense", emoji: "👁️" },
	{ value: "contemplative" as const, label: "Thoughtful", emoji: "🤔" },
	{ value: "distant" as const, label: "Distant", emoji: "🌫️" }
];

const SILHOUETTE_OPTIONS = [
	{ value: "fitted" as const, label: "Fitted", emoji: "👔" },
	{ value: "oversized" as const, label: "Oversized", emoji: "🧥" },
	{ value: "structured" as const, label: "Structured", emoji: "🏛️" },
	{ value: "flowing" as const, label: "Flowing", emoji: "🌊" }
];

const LENS_OPTIONS = [
	{ value: "35mm_doc" as const, label: "35mm Doc", emoji: "📹" },
	{ value: "50mm_portrait" as const, label: "50mm Portrait", emoji: "🖼️" },
	{ value: "85mm_editorial" as const, label: "85mm Editorial", emoji: "📷" },
	{ value: "105mm_beauty" as const, label: "105mm Beauty", emoji: "💎" }
];

const SUGGESTED_MOOD_TAGS = ["editorial luxe", "quiet luxury", "runway minimal", "cinematic portrait", "jewelry focus"];

const PROVIDER_MODEL_DEFAULTS: Record<ImageProvider, string> = {
	gpu: "sdxl-1.0",
	openai: "gpt-image-1",
	nano_banana_2: "gemini-3.1-flash-image-preview",
	zai_glm: "glm-image"
};

const PROVIDER_OPTIONS = [
	{ value: "nano_banana_2" as const, label: "Nano Banana", emoji: "🍌", description: "Fast and budget-friendly" },
	{ value: "openai" as const, label: "OpenAI", emoji: "🧠", description: "Strong prompt following" },
	{ value: "zai_glm" as const, label: "Z.AI GLM", emoji: "🔮", description: "GLM-native generation" },
	{ value: "gpu" as const, label: "GPU Pipeline", emoji: "⚡", description: "Custom image flow" }
];

const VIDEO_SCOPE_OPTIONS = [
	{ value: "all_images" as const, label: "Every shot", emoji: "🎞️", description: "Queue a matching vertical reel for each new image in this run." },
	{ value: "anchor_only" as const, label: "Anchor only", emoji: "🧷", description: "Generate motion proof from the anchor and keep the rest as stills." }
];

const VIDEO_DURATION_OPTIONS = [
	{ value: String(CAMPAIGN_VIDEO_DURATION_VALUES[1]), label: "8 sec", emoji: "🎬", description: "Longer editorial movement" },
	{ value: String(CAMPAIGN_VIDEO_DURATION_VALUES[0]), label: "6 sec", emoji: "⚡", description: "Quicker, lighter loop" }
];

type Asset = {
	id: string;
	status: "PENDING" | "APPROVED" | "REJECTED";
	seed: number;
	sequence_number: number;
	quality_score: number | null;
	artifacts_flagged: boolean;
	identity_drift_score?: number | null;
	raw_gcs_uri?: string;
};

type Job = {
	id: string;
	status: "DISPATCHED" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
	dispatched_at: string;
};

type ModelOption = CampaignModelPickerItem;

type ReferenceItem = {
	id?: string;
	source?: "pinterest_upload" | "pinterest_url" | "external_url";
	url: string;
	thumbnail_url?: string;
	title?: string;
	weight: "primary" | "secondary";
	similarity_score?: number;
};

type CampaignDetail = {
	id: string;
	name: string;
	status: CampaignStatus;
	campaign_group_id?: string | null;
	source_campaign_id?: string | null;
	anchor_asset_id?: string | null;
	prompt_text: string | null;
	image_model_provider: ImageProvider;
	image_model_id: string | null;
	model?: { id: string; name: string } | null;
	creative_controls?: {
		reference_board?: {
			items?: ReferenceItem[];
			active_version?: number;
		};
		pose?: {
			preset?: string;
			micro_rotation?: {
				shoulder_angle?: number;
				hip_shift?: number;
				chin_tilt?: number;
			};
		};
		expression?: {
			preset?: string;
			smile_intensity?: number;
		};
		outfit?: {
			silhouette?: string;
			micro_adjustment?: {
				hem_length?: number;
			};
		};
		realism?: {
			lens_simulation?: string;
			skin_texture_realism?: number;
		};
		aesthetic?: {
			mood_tags?: string[];
		};
		video?: {
			enabled?: boolean;
			generation_scope?: CampaignVideoGenerationScope;
			duration_seconds?: CampaignVideoDurationSeconds;
			prompt_text?: string;
		};
	};
	assets: Asset[];
	generation_jobs: Job[];
	batch_size?: number;
	resolution_width?: number;
	resolution_height?: number;
	linked_campaigns?: Array<{
		id: string;
		name: string;
		status: CampaignStatus;
		source_campaign_id?: string | null;
		model?: { id: string; name: string } | null;
	}>;
};

type ReferenceBoardResponse = {
	items?: ReferenceItem[];
};

export default function CampaignDetailPage() {
	const router = useRouter();
	const params = useParams<{ id: string }>();
	const pathname = usePathname();
	const { setSegmentTitle } = useBreadcrumb();
	const { notify } = useNotice();
	const campaignId = params.id;
	const segmentIndex = pathname.split("/").filter(Boolean).indexOf(campaignId);

	const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
	const [references, setReferences] = useState<ReferenceItem[]>([]);
	const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [loadingModelOptions, setLoadingModelOptions] = useState(true);
	const [savingStyle, setSavingStyle] = useState(false);
	const [savingSettings, setSavingSettings] = useState(false);
	const [runningGeneration, setRunningGeneration] = useState(false);
	const [submittingReference, setSubmittingReference] = useState(false);
	const [settingAnchorId, setSettingAnchorId] = useState<string | null>(null);
	const [duplicatingCampaigns, setDuplicatingCampaigns] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);
	const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
	const [duplicateName, setDuplicateName] = useState("");
	const [duplicateModelIds, setDuplicateModelIds] = useState<string[]>([]);
	const [duplicateError, setDuplicateError] = useState<string | null>(null);

	const [promptText, setPromptText] = useState("");
	const [promptCustomized, setPromptCustomized] = useState(false);

	const [posePreset, setPosePreset] = useState<PosePreset>("editorial");
	const [expressionPreset, setExpressionPreset] = useState<ExpressionPreset>("soft_smile");
	const [silhouette, setSilhouette] = useState<Silhouette>("structured");
	const [lensSimulation, setLensSimulation] = useState<LensSimulation>("85mm_editorial");
	const [moodTags, setMoodTags] = useState<string[]>(["editorial luxe"]);

	const [shoulderAngle, setShoulderAngle] = useState("0");
	const [hipShift, setHipShift] = useState("0");
	const [chinTilt, setChinTilt] = useState("0");
	const [smileIntensity, setSmileIntensity] = useState("0.2");
	const [hemLength, setHemLength] = useState("0");
	const [skinRealism, setSkinRealism] = useState(0.82);

	const [newReferenceUrl, setNewReferenceUrl] = useState("");
	const [newReferenceWeight, setNewReferenceWeight] = useState<"primary" | "secondary">("secondary");
	const [uploadReferenceFile, setUploadReferenceFile] = useState<File | null>(null);
	const [uploadReferenceWeight, setUploadReferenceWeight] = useState<"primary" | "secondary">("secondary");
	const [uploadInputKey, setUploadInputKey] = useState(0);

	const [editProvider, setEditProvider] = useState<ImageProvider>("zai_glm");
	const [editModelId, setEditModelId] = useState("");
	const [editBatchSize, setEditBatchSize] = useState("8");
	const [editResWidth, setEditResWidth] = useState(1024);
	const [editResHeight, setEditResHeight] = useState(1024);
	const [videoEnabled, setVideoEnabled] = useState(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.enabled);
	const [videoScope, setVideoScope] = useState<CampaignVideoGenerationScope>(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.generation_scope);
	const [videoDurationSeconds, setVideoDurationSeconds] = useState<CampaignVideoDurationSeconds>(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.duration_seconds);
	const [videoPromptText, setVideoPromptText] = useState(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.prompt_text ?? "");

	const [expandedAssetId, setExpandedAssetId] = useState<string | null>(null);
	const [lastRequestedBatchSize, setLastRequestedBatchSize] = useState(0);

	const autoPrompt = useMemo(() => buildAutoPrompt(posePreset, expressionPreset, silhouette, lensSimulation, moodTags), [posePreset, expressionPreset, silhouette, lensSimulation, moodTags]);

	useEffect(() => {
		if (!promptCustomized) {
			setPromptText(autoPrompt);
		}
	}, [autoPrompt, promptCustomized]);

	const load = useCallback(
		async (mode: "initial" | "refresh" = "refresh") => {
			if (mode === "initial") setLoading(true);
			else setRefreshing(true);

			setError(null);

			try {
				const [campaignData, boardData] = await Promise.all([
					apiRequest<CampaignDetail>(`/api/campaigns/${campaignId}`),
					apiRequest<ReferenceBoardResponse>(`/api/campaigns/${campaignId}/references`).catch(() => null)
				]);

				setCampaign(campaignData);
				if (segmentIndex >= 0) setSegmentTitle(segmentIndex, campaignData.name);

				const boardItems = boardData?.items ?? campaignData.creative_controls?.reference_board?.items ?? [];
				setReferences(boardItems);

				const nextPose = coerceValue(campaignData.creative_controls?.pose?.preset, POSE_VALUES, "editorial");
				const nextExpression = coerceValue(campaignData.creative_controls?.expression?.preset, EXPRESSION_VALUES, "soft_smile");
				const nextSilhouette = coerceValue(campaignData.creative_controls?.outfit?.silhouette, SILHOUETTE_VALUES, "structured");
				const nextLens = coerceValue(campaignData.creative_controls?.realism?.lens_simulation, LENS_VALUES, "85mm_editorial");
				const nextMoodTags = campaignData.creative_controls?.aesthetic?.mood_tags?.length ? campaignData.creative_controls.aesthetic.mood_tags : ["editorial luxe"];
				const nextVideoEnabled = campaignData.creative_controls?.video?.enabled ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.enabled;
				const nextVideoScope = campaignData.creative_controls?.video?.generation_scope ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.generation_scope;
				const nextVideoDuration = campaignData.creative_controls?.video?.duration_seconds ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.duration_seconds;
				const nextVideoPrompt = campaignData.creative_controls?.video?.prompt_text?.trim() ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.prompt_text ?? "";

				setPosePreset(nextPose);
				setExpressionPreset(nextExpression);
				setSilhouette(nextSilhouette);
				setLensSimulation(nextLens);
				setMoodTags(nextMoodTags.slice(0, 12));
				setVideoEnabled(nextVideoEnabled);
				setVideoScope(nextVideoScope);
				setVideoDurationSeconds(nextVideoDuration);
				setVideoPromptText(nextVideoPrompt);

				setShoulderAngle(String(clampFloat(campaignData.creative_controls?.pose?.micro_rotation?.shoulder_angle ?? 0, 0, -1, 1)));
				setHipShift(String(clampFloat(campaignData.creative_controls?.pose?.micro_rotation?.hip_shift ?? 0, 0, -1, 1)));
				setChinTilt(String(clampFloat(campaignData.creative_controls?.pose?.micro_rotation?.chin_tilt ?? 0, 0, -1, 1)));
				setSmileIntensity(String(clampFloat(campaignData.creative_controls?.expression?.smile_intensity ?? 0.2, 0.2, 0, 1)));
				setHemLength(String(clampFloat(campaignData.creative_controls?.outfit?.micro_adjustment?.hem_length ?? 0, 0, -1, 1)));
				setSkinRealism(clampFloat(campaignData.creative_controls?.realism?.skin_texture_realism ?? 0.82, 0.82, 0, 1));

				const inferredAutoPrompt = buildAutoPrompt(nextPose, nextExpression, nextSilhouette, nextLens, nextMoodTags);
				const persistedPrompt = campaignData.prompt_text?.trim() ?? "";
				if (persistedPrompt && persistedPrompt !== inferredAutoPrompt) {
					setPromptCustomized(true);
					setPromptText(persistedPrompt);
				} else {
					setPromptCustomized(false);
					setPromptText(persistedPrompt || inferredAutoPrompt);
				}

				setEditProvider(campaignData.image_model_provider);
				setEditModelId(campaignData.image_model_id ?? PROVIDER_MODEL_DEFAULTS[campaignData.image_model_provider]);
				setEditBatchSize(String(campaignData.batch_size ?? 8));
				setEditResWidth(campaignData.resolution_width ?? 1024);
				setEditResHeight(campaignData.resolution_height ?? 1024);
			} catch (err) {
				setError(err instanceof Error ? err.message : "We couldn't load this campaign.");
			} finally {
				if (mode === "initial") setLoading(false);
				else setRefreshing(false);
			}
		},
		[campaignId, segmentIndex, setSegmentTitle]
	);

	const loadModelOptions = useCallback(async () => {
		setLoadingModelOptions(true);

		try {
			const payload = await apiRequest<{ data: ModelOption[] }>("/api/models?limit=100");
			setModelOptions(payload.data.filter(model => model.status === "ACTIVE"));
		} catch (err) {
			notify({
				tone: "error",
				title: "Model list unavailable",
				description: err instanceof Error ? err.message : "We couldn't load the available models for duplication.",
			});
		} finally {
			setLoadingModelOptions(false);
		}
	}, [notify]);

	useEffect(() => {
		void load("initial");
	}, [load]);

	useEffect(() => {
		void loadModelOptions();
	}, [loadModelOptions]);

	useEffect(() => {
		return () => {
			if (segmentIndex >= 0) setSegmentTitle(segmentIndex, null);
		};
	}, [segmentIndex, setSegmentTitle]);

	useEffect(() => {
		if (!duplicateDialogOpen) {
			setDuplicateError(null);
			setDuplicateName("");
			setDuplicateModelIds([]);
		}
	}, [duplicateDialogOpen]);

	const isBusy = savingStyle || savingSettings || runningGeneration || submittingReference || Boolean(settingAnchorId);
	const hasAnchor = Boolean(campaign?.anchor_asset_id);
	const plannedBatchSize = Math.max(1, Math.min(12, Math.trunc(Number(editBatchSize) || campaign?.batch_size || 8)));
	const anchorBatchSize = Math.max(1, plannedBatchSize - 1);
	const isGenerating = campaign?.generation_jobs.some(job => job.status === "IN_PROGRESS" || job.status === "DISPATCHED");
	const generationProgressBatchSize = lastRequestedBatchSize || plannedBatchSize;
	const promptTextTrimmed = promptText.trim();
	const promptWordCount = promptTextTrimmed ? promptTextTrimmed.split(/\s+/).filter(Boolean).length : 0;
	const activeProviderLabel = PROVIDER_OPTIONS.find(option => option.value === editProvider)?.label ?? editProvider;
	const motionPromptTrimmed = videoPromptText.trim();
	const videoCoverageLabel = videoScope === "all_images" ? "Every generated shot" : "Anchor only";
	const videoPlanLabel = videoEnabled ? `${videoCoverageLabel} · ${videoDurationSeconds}s vertical reel` : "Images only";
	const videoPlanHint = videoEnabled
		? videoScope === "all_images"
			? `Anchor pass queues 1 video. Batch runs queue ${anchorBatchSize} more from the new campaign images.`
			: "Only the anchor pass will queue a matching vertical video."
		: "Turn motion on if you want reel-ready video variants to auto-queue with new images.";
	const linkedCampaigns = campaign?.linked_campaigns ?? [];
	const linkedCampaignCount = linkedCampaigns.length;
	const duplicateReady = duplicateModelIds.length > 0 && !duplicatingCampaigns;

	const { approvedCount, pendingCount, flaggedCount } = useMemo(() => {
		let approved = 0;
		let pending = 0;
		let flagged = 0;

		for (const asset of campaign?.assets ?? []) {
			if (asset.status === "APPROVED") approved += 1;
			if (asset.status === "PENDING") pending += 1;
			if (asset.artifacts_flagged) flagged += 1;
		}

		return { approvedCount: approved, pendingCount: pending, flaggedCount: flagged };
	}, [campaign?.assets]);

	const driftAverage = useMemo(() => {
		const scores = campaign?.assets.map(asset => asset.identity_drift_score).filter((score): score is number => score != null) ?? [];
		if (scores.length === 0) return null;
		return scores.reduce((sum, score) => sum + score, 0) / scores.length;
	}, [campaign?.assets]);

	const sortedReferences = useMemo(
		() =>
			[...references].sort((left, right) => {
				if (left.weight !== right.weight) return left.weight === "primary" ? -1 : 1;
				if (left.source !== right.source) return left.source === "pinterest_upload" ? -1 : 1;
				return (right.similarity_score ?? 0) - (left.similarity_score ?? 0);
			}),
		[references]
	);

	const referenceSummary = useMemo(() => {
		let primaryCount = 0;
		let uploadedCount = 0;

		for (const reference of references) {
			if (reference.weight === "primary") primaryCount += 1;
			if (reference.source === "pinterest_upload") uploadedCount += 1;
		}

		const totalCount = references.length;
		const secondaryCount = Math.max(0, totalCount - primaryCount);
		const linkedCount = Math.max(0, totalCount - uploadedCount);
		const readinessTone: WorkflowTone = totalCount >= 4 && primaryCount >= 1 ? "success" : totalCount > 0 ? "warning" : "neutral";
		const readinessLabel = readinessTone === "success" ? "Ready for generation" : readinessTone === "warning" ? "Needs stronger anchors" : "No references yet";

		return { totalCount, primaryCount, secondaryCount, uploadedCount, linkedCount, readinessTone, readinessLabel };
	}, [references]);

	const currentCreativeControls = useMemo(
		() =>
			buildCreativeControlsPayload({
				posePreset,
				expressionPreset,
				silhouette,
				lensSimulation,
				moodTags,
				videoEnabled,
				videoScope,
				videoDurationSeconds,
				videoPromptText,
				shoulderAngle,
				hipShift,
				chinTilt,
				smileIntensity,
				hemLength,
				skinRealism
			}),
		[
			posePreset,
			expressionPreset,
			silhouette,
			lensSimulation,
			moodTags,
			videoEnabled,
			videoScope,
			videoDurationSeconds,
			videoPromptText,
			shoulderAngle,
			hipShift,
			chinTilt,
			smileIntensity,
			hemLength,
			skinRealism
		]
	);

	const savedStyleSnapshot = useMemo(() => {
		if (!campaign) return null;
		const savedPose = coerceValue(campaign.creative_controls?.pose?.preset, POSE_VALUES, "editorial");
		const savedExpression = coerceValue(campaign.creative_controls?.expression?.preset, EXPRESSION_VALUES, "soft_smile");
		const savedSilhouette = coerceValue(campaign.creative_controls?.outfit?.silhouette, SILHOUETTE_VALUES, "structured");
		const savedLens = coerceValue(campaign.creative_controls?.realism?.lens_simulation, LENS_VALUES, "85mm_editorial");
		const savedMoodTags = campaign.creative_controls?.aesthetic?.mood_tags?.length ? campaign.creative_controls.aesthetic.mood_tags.slice(0, 12) : ["editorial luxe"];
		const savedVideoEnabled = campaign.creative_controls?.video?.enabled ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.enabled;
		const savedVideoScope = campaign.creative_controls?.video?.generation_scope ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.generation_scope;
		const savedVideoDuration = campaign.creative_controls?.video?.duration_seconds ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.duration_seconds;
		const savedVideoPrompt = campaign.creative_controls?.video?.prompt_text?.trim() ?? DEFAULT_CAMPAIGN_VIDEO_SETTINGS.prompt_text ?? "";
		const inferredPrompt = buildAutoPrompt(savedPose, savedExpression, savedSilhouette, savedLens, savedMoodTags);
		return {
			posePreset: savedPose,
			expressionPreset: savedExpression,
			silhouette: savedSilhouette,
			lensSimulation: savedLens,
			moodTags: savedMoodTags,
			videoEnabled: savedVideoEnabled,
			videoScope: savedVideoScope,
			videoDurationSeconds: savedVideoDuration,
			videoPromptText: savedVideoPrompt,
			shoulderAngle: String(clampFloat(campaign.creative_controls?.pose?.micro_rotation?.shoulder_angle ?? 0, 0, -1, 1)),
			hipShift: String(clampFloat(campaign.creative_controls?.pose?.micro_rotation?.hip_shift ?? 0, 0, -1, 1)),
			chinTilt: String(clampFloat(campaign.creative_controls?.pose?.micro_rotation?.chin_tilt ?? 0, 0, -1, 1)),
			smileIntensity: String(clampFloat(campaign.creative_controls?.expression?.smile_intensity ?? 0.2, 0.2, 0, 1)),
			hemLength: String(clampFloat(campaign.creative_controls?.outfit?.micro_adjustment?.hem_length ?? 0, 0, -1, 1)),
			skinRealism: clampFloat(campaign.creative_controls?.realism?.skin_texture_realism ?? 0.82, 0.82, 0, 1),
			promptText: campaign.prompt_text?.trim() || inferredPrompt
		};
	}, [campaign]);

	const hasUnsavedStyleChanges = useMemo(() => {
		if (!savedStyleSnapshot) return false;
		return (
			posePreset !== savedStyleSnapshot.posePreset ||
			expressionPreset !== savedStyleSnapshot.expressionPreset ||
			silhouette !== savedStyleSnapshot.silhouette ||
			lensSimulation !== savedStyleSnapshot.lensSimulation ||
			!arrayEquals(moodTags, savedStyleSnapshot.moodTags) ||
			videoEnabled !== savedStyleSnapshot.videoEnabled ||
			videoScope !== savedStyleSnapshot.videoScope ||
			videoDurationSeconds !== savedStyleSnapshot.videoDurationSeconds ||
			videoPromptText.trim() !== savedStyleSnapshot.videoPromptText ||
			shoulderAngle !== savedStyleSnapshot.shoulderAngle ||
			hipShift !== savedStyleSnapshot.hipShift ||
			chinTilt !== savedStyleSnapshot.chinTilt ||
			smileIntensity !== savedStyleSnapshot.smileIntensity ||
			hemLength !== savedStyleSnapshot.hemLength ||
			skinRealism !== savedStyleSnapshot.skinRealism ||
			promptTextTrimmed !== savedStyleSnapshot.promptText
		);
	}, [
		savedStyleSnapshot,
		posePreset,
		expressionPreset,
		silhouette,
		lensSimulation,
		moodTags,
		videoEnabled,
		videoScope,
		videoDurationSeconds,
		videoPromptText,
		shoulderAngle,
		hipShift,
		chinTilt,
		smileIntensity,
		hemLength,
		skinRealism,
		promptTextTrimmed
	]);

	const hasUnsavedImageSettings = useMemo(() => {
		if (!campaign) return false;
		const nextModelId = editModelId.trim() || PROVIDER_MODEL_DEFAULTS[editProvider];
		const savedModelId = campaign.image_model_id ?? PROVIDER_MODEL_DEFAULTS[campaign.image_model_provider];
		return (
			editProvider !== campaign.image_model_provider ||
			nextModelId !== savedModelId ||
			plannedBatchSize !== (campaign.batch_size ?? 8) ||
			editResWidth !== (campaign.resolution_width ?? 1024) ||
			editResHeight !== (campaign.resolution_height ?? 1024)
		);
	}, [campaign, editProvider, editModelId, plannedBatchSize, editResWidth, editResHeight]);

	const anchorAsset = useMemo(() => campaign?.assets.find(asset => asset.id === campaign?.anchor_asset_id) ?? null, [campaign?.assets, campaign?.anchor_asset_id]);

	const generatedSetCount = useMemo(() => (campaign?.assets ?? []).filter(asset => asset.id !== campaign?.anchor_asset_id).length, [campaign?.assets, campaign?.anchor_asset_id]);

	useEffect(() => {
		if (!expandedAssetId) return;
		if (!campaign?.assets.some(asset => asset.id === expandedAssetId)) {
			setExpandedAssetId(null);
		}
	}, [campaign?.assets, expandedAssetId]);

	async function saveStyle() {
		if (!campaign) return;
		const prompt = promptTextTrimmed;
		if (!prompt) {
			setError("Prompt text is required before saving.");
			return;
		}

		setSavingStyle(true);
		setError(null);
		setInfo(null);

		try {
			await Promise.all([
				apiRequest(`/api/campaigns/${campaignId}/creative-controls`, {
					method: "PATCH",
					body: JSON.stringify({
						creative_controls: currentCreativeControls
					})
				}),
				apiRequest(`/api/campaigns/${campaignId}`, {
					method: "PATCH",
					body: JSON.stringify({ prompt_text: prompt })
				})
			]);

			setInfo("Creative direction saved.");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't save creative direction.");
		} finally {
			setSavingStyle(false);
		}
	}

	async function persistImageSettings({ silent = false }: { silent?: boolean } = {}): Promise<boolean> {
		if (!campaign) return false;

		setSavingSettings(true);
		setError(null);
		if (!silent) setInfo(null);

		const nextBatchSize = plannedBatchSize;
		const nextModelId = editModelId.trim() || PROVIDER_MODEL_DEFAULTS[editProvider];

		try {
			await apiRequest(`/api/campaigns/${campaignId}`, {
				method: "PATCH",
				body: JSON.stringify({
					image_model_provider: editProvider,
					image_model_id: nextModelId,
					batch_size: nextBatchSize,
					resolution_width: editResWidth,
					resolution_height: editResHeight
				})
			});

			setEditBatchSize(String(nextBatchSize));
			setEditModelId(nextModelId);
			setCampaign(current =>
				current
					? {
							...current,
							image_model_provider: editProvider,
							image_model_id: nextModelId,
							batch_size: nextBatchSize,
							resolution_width: editResWidth,
							resolution_height: editResHeight
						}
					: current
			);
			if (!silent) {
				setInfo("Image settings saved.");
			}
			return true;
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't save image settings.");
			return false;
		} finally {
			setSavingSettings(false);
		}
	}

	async function saveImageSettings() {
		await persistImageSettings();
	}

	async function generateByMode(mode: "anchor" | "batch") {
		if (!campaign) return;

		const prompt = promptTextTrimmed;
		if (!prompt) {
			setError("Prompt text is required before generation.");
			return;
		}
		if (mode === "batch" && !campaign.anchor_asset_id) {
			setError("Set an anchor first, then run campaign shots.");
			return;
		}

		setRunningGeneration(true);
		setError(null);
		setInfo(null);

		try {
			if (hasUnsavedImageSettings) {
				const saved = await persistImageSettings({ silent: true });
				if (!saved) return;
			}

			const response = await apiRequest<{
				job_id: string;
				campaign_status: CampaignStatus;
				video_generation_planned?: boolean;
				video_generation_jobs_created?: number;
			}>(`/api/campaigns/${campaignId}/generate`, {
				method: "POST",
				body: JSON.stringify({
					prompt_text: prompt,
					creative_controls_override: currentCreativeControls,
					generation_mode: mode,
					...(mode === "batch" && campaign.anchor_asset_id ? { anchor_asset_id: campaign.anchor_asset_id } : {})
				})
			});

			setLastRequestedBatchSize(mode === "anchor" ? 1 : anchorBatchSize);
			const shouldMentionVideo = response.video_generation_planned;
			if (mode === "anchor") {
				setInfo(shouldMentionVideo ? "Anchor generation started. A matching vertical video will queue automatically when the anchor frame lands." : "Anchor generation started.");
			} else {
				setInfo(shouldMentionVideo ? "Campaign generation started. Matching vertical videos will queue automatically for the new campaign shots." : "Campaign generation started.");
			}
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Generation request failed.");
		} finally {
			setRunningGeneration(false);
		}
	}

	async function setAnchor(assetId: string) {
		setSettingAnchorId(assetId);
		setError(null);
		setInfo(null);

		try {
			await apiRequest(`/api/campaigns/${campaignId}/anchor`, {
				method: "PATCH",
				body: JSON.stringify({ asset_id: assetId })
			});
			setInfo("Anchor updated.");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't set this anchor.");
		} finally {
			setSettingAnchorId(null);
		}
	}

	async function duplicateCampaign() {
		if (!campaign || duplicateModelIds.length === 0) {
			setDuplicateError("Select at least one model.");
			return;
		}

		setDuplicatingCampaigns(true);
		setDuplicateError(null);

		try {
			const duplicated = await apiRequest<{
				id: string;
				primary_campaign_id?: string;
				campaigns?: Array<{ id: string }>;
			}>(`/api/campaigns/${campaignId}/duplicate`, {
				method: "POST",
				body: JSON.stringify({
					name: duplicateName.trim() || undefined,
					model_ids: duplicateModelIds,
				}),
			});

			const createdCount = duplicated.campaigns?.length ?? duplicateModelIds.length;
			notify({
				tone: "success",
				title: createdCount > 1 ? "Campaigns duplicated" : "Campaign duplicated",
				description:
					createdCount > 1
						? `${createdCount} linked drafts were created from this setup.`
						: "A new draft was created from this setup.",
			});
			setDuplicateDialogOpen(false);
			router.push(`/campaigns/${duplicated.primary_campaign_id ?? duplicated.id}`);
		} catch (err) {
			setDuplicateError(err instanceof Error ? err.message : "We couldn't duplicate this campaign.");
		} finally {
			setDuplicatingCampaigns(false);
		}
	}

	async function addReference(event: FormEvent) {
		event.preventDefault();
		const referenceUrl = newReferenceUrl.trim();
		if (!referenceUrl || !isValidUrl(referenceUrl)) {
			setError("Enter a valid reference URL.");
			return;
		}

		setSubmittingReference(true);
		setError(null);

		try {
			await apiRequest(`/api/campaigns/${campaignId}/references`, {
				method: "POST",
				body: JSON.stringify({
					source: "external_url",
					url: referenceUrl,
					weight: newReferenceWeight
				})
			});
			setNewReferenceUrl("");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't add that reference.");
		} finally {
			setSubmittingReference(false);
		}
	}

	async function uploadReferenceImage(event: FormEvent) {
		event.preventDefault();
		if (!uploadReferenceFile) {
			setError("Choose an image to upload.");
			return;
		}

		setSubmittingReference(true);
		setError(null);

		try {
			const formData = new FormData();
			formData.append("image", uploadReferenceFile);
			formData.append("weight", uploadReferenceWeight);
			await apiFormRequest(`/api/campaigns/${campaignId}/references`, formData);
			setUploadReferenceFile(null);
			setUploadInputKey(key => key + 1);
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Upload failed.");
		} finally {
			setSubmittingReference(false);
		}
	}

	const handleDroppedFiles = useCallback(
		async (files: File[]) => {
			if (files.length === 0) return;
			setSubmittingReference(true);
			setError(null);

			try {
				for (const file of files) {
					const formData = new FormData();
					formData.append("image", file);
					formData.append("weight", "secondary");
					await apiFormRequest(`/api/campaigns/${campaignId}/references`, formData);
				}
				await load();
			} catch (err) {
				setError(err instanceof Error ? err.message : "Upload failed.");
			} finally {
				setSubmittingReference(false);
			}
		},
		[campaignId, load]
	);

	const assetColumns: TableShellColumn<Asset>[] = [
		{
			key: "thumbnail",
			header: "Preview",
			cell: (asset: Asset) => {
				const preview = (
					<ImageGenerationSurface
						src={asset.raw_gcs_uri}
						alt={`Seed ${asset.seed}`}
						className="h-16 w-16 rounded-md"
						placeholder={null}
						loading={campaign?.status === "GENERATING" && !asset.raw_gcs_uri}
						loadingTitle="Rendering"
						loadingBadge={`#${asset.sequence_number}`}
						loadingVariant="compact"
					/>
				);

				return asset.raw_gcs_uri ? (
					<button type="button" onClick={() => setExpandedAssetId(asset.id)} className="block transition-opacity hover:opacity-85" aria-label={`Open asset ${asset.sequence_number}`}>
						{preview}
					</button>
				) : (
					preview
				);
			}
		},
		{ key: "sequence", header: "#", cell: (asset: Asset) => <span>#{asset.sequence_number}</span> },
		{ key: "seed", header: "Seed", cell: (asset: Asset) => <code className="text-xs">{asset.seed}</code> },
		{
			key: "status",
			header: "Status",
			cell: (asset: Asset) => (
				<Badge tone={asset.status === "APPROVED" ? "success" : asset.status === "REJECTED" ? "danger" : "warning"}>{asset.status === "PENDING" ? "NEEDS REVIEW" : asset.status}</Badge>
			)
		},
		{
			key: "quality",
			header: "Quality",
			cell: (asset: Asset) => (asset.quality_score != null ? <Badge tone="neutral">Q {asset.quality_score}</Badge> : <span className="text-xs text-muted-foreground">—</span>)
		},
		{
			key: "anchor",
			header: "Anchor",
			cell: (asset: Asset) =>
				campaign?.anchor_asset_id === asset.id ? (
					<Badge tone="success">⚓ Active</Badge>
				) : (
					<Button type="button" size="sm" variant="ghost" onClick={() => void setAnchor(asset.id)} disabled={settingAnchorId === asset.id || isBusy}>
						{settingAnchorId === asset.id ? "Saving…" : "Set as Anchor"}
					</Button>
				)
		}
	];

	const jobColumns = useMemo<TableShellColumn<Job>[]>(
		() => [
			{ key: "id", header: "Job ID", cell: (job: Job) => <code className="text-xs">{job.id.slice(0, 8)}…</code> },
			{ key: "status", header: "Status", cell: (job: Job) => <Badge tone={job.status === "COMPLETED" ? "success" : job.status === "FAILED" ? "danger" : "warning"}>{job.status}</Badge> },
			{
				key: "dispatched",
				header: "Dispatched",
				cell: (job: Job) => <span className="text-xs text-muted-foreground">{new Date(job.dispatched_at).toLocaleString()}</span>
			}
		],
		[]
	);

	if (loading && !campaign) {
		return (
			<div className="space-y-4">
				<PageHeader title="Campaign" description="Loading campaign workspace…" />
				<StateBlock title="Loading campaign…" description="Fetching campaign details and references." />
			</div>
		);
	}

	if (!campaign) {
		return (
			<div className="space-y-4">
				<PageHeader title="Campaign" description="Campaign workspace" />
				<StateBlock tone="danger" title="Couldn't load campaign" description={error ?? "Please refresh and try again."} />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<PageHeader
				title={`🎬 ${campaign.name}`}
				description="Refine references, tune creative controls, and generate campaign-ready assets."
				action={
					<div className="flex flex-wrap gap-2">
						<Button type="button" onClick={() => setDuplicateDialogOpen(true)} disabled={duplicatingCampaigns || loadingModelOptions}>
							Duplicate Setup
						</Button>
						<Button variant="secondary" type="button" onClick={() => void load("refresh")} disabled={refreshing || isBusy} aria-label="Refresh campaign">
							<RefreshCw className={`h-4 w-4 ${refreshing || loading ? "animate-spin" : ""}`} />
							Refresh
						</Button>
					</div>
				}
			/>

			<XpProgressBar
				segments={[
					{ key: "draft", label: "Draft", done: !["DRAFT", "FAILED"].includes(campaign.status), active: ["DRAFT", "FAILED"].includes(campaign.status) },
					{ key: "generating", label: "Generating", done: ["REVIEW", "APPROVED", "SCHEDULED", "PUBLISHED"].includes(campaign.status), active: campaign.status === "GENERATING" },
					{ key: "review", label: "Review", done: ["APPROVED", "SCHEDULED", "PUBLISHED"].includes(campaign.status), active: campaign.status === "REVIEW" },
					{ key: "approved", label: "Approved", done: ["SCHEDULED", "PUBLISHED"].includes(campaign.status), active: ["APPROVED", "SCHEDULED"].includes(campaign.status) },
					{ key: "published", label: "Published", done: false, active: campaign.status === "PUBLISHED" }
				]}
			/>

			{linkedCampaignCount > 1 ? (
				<EditorialCard className="space-y-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Linked Campaign Set</p>
							<h2 className="mt-2 font-display text-xl font-semibold">One setup, {linkedCampaignCount} model-specific workspaces.</h2>
							<p className="mt-2 text-sm text-muted-foreground">
								Each linked campaign keeps the same direction and settings, but runs against its own model identity.
							</p>
						</div>
						<Badge tone="neutral">{linkedCampaignCount} linked campaigns</Badge>
					</div>

					<div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
						{linkedCampaigns.map(linkedCampaign => (
							<Link
								key={linkedCampaign.id}
								href={`/campaigns/${linkedCampaign.id}`}
								className={`rounded-2xl border p-3 transition-colors ${
									linkedCampaign.id === campaign.id
										? "border-primary/55 bg-primary/7 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary),transparent_65%)]"
										: "border-border/70 bg-card/55 hover:border-border"
								}`}
							>
								<div className="flex flex-wrap items-center gap-2">
									<p className="font-medium">{linkedCampaign.model?.name ?? linkedCampaign.name}</p>
									{linkedCampaign.id === campaign.id ? <Badge tone="success">Current</Badge> : null}
									{campaign.source_campaign_id && linkedCampaign.id === campaign.source_campaign_id ? <Badge tone="neutral">Source</Badge> : null}
								</div>
								<p className="mt-2 text-sm text-muted-foreground">{linkedCampaign.name}</p>
								<div className="mt-3 flex flex-wrap gap-2">
									<Badge tone={toneForCampaignStatus(linkedCampaign.status)}>{humanizeStatusLabel(linkedCampaign.status)}</Badge>
								</div>
							</Link>
						))}
					</div>
				</EditorialCard>
			) : null}

			<EditorialCard className="overflow-hidden">
				<div className="grid gap-4 xl:grid-cols-[minmax(0,1.18fr)_minmax(18rem,0.82fr)]">
					<div className="space-y-4">
						<div>
							<p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Campaign Generation Studio</p>
							<h2 className="mt-2 font-display text-3xl leading-none">Reference first. Lock direction. Expand from one anchor.</h2>
							<p className="mt-3 max-w-2xl text-sm text-muted-foreground">
								This flow is optimized for character consistency: build a stronger reference board, keep the direction readable, then grow the campaign from a single anchor shot.
							</p>
						</div>

						<div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-4">
							<CampaignStageCard
								icon={<ImagePlus className="size-4" />}
								label="Reference Board"
								description={
									referenceSummary.totalCount === 0
										? "Add 4-8 references with at least one primary identity anchor."
										: `${referenceSummary.primaryCount} primary · ${referenceSummary.secondaryCount} support refs`
								}
								tone={referenceSummary.readinessTone}
							/>
							<CampaignStageCard
								icon={<SlidersHorizontal className="size-4" />}
								label="Creative Lock"
								description={
									hasUnsavedStyleChanges
										? "Live direction changes are ready. Save when you want them persisted."
										: promptWordCount > 0
											? `${promptWordCount} prompt words and styling controls are synced`
											: "Build the shot direction before dispatching generation."
								}
								tone={promptWordCount > 0 ? (hasUnsavedStyleChanges ? "warning" : "success") : "neutral"}
							/>
							<CampaignStageCard
								icon={<ScanFace className="size-4" />}
								label="Anchor Shot"
								description={
									hasAnchor
										? `Anchor #${anchorAsset?.sequence_number ?? "?"} is active for this campaign`
										: isGenerating && generationProgressBatchSize <= 1
											? "Anchor pass is running now"
											: "Generate one lead shot that the rest of the set can follow"
								}
								tone={hasAnchor ? "success" : isGenerating && generationProgressBatchSize <= 1 ? "warning" : "neutral"}
							/>
							<CampaignStageCard
								icon={<Sparkles className="size-4" />}
								label="Expand Set"
								description={
									generatedSetCount > 0
										? `${generatedSetCount} campaign output${generatedSetCount === 1 ? "" : "s"} ready to review`
										: hasAnchor
											? `Run the remaining ${anchorBatchSize} campaign shots`
											: "Unlocks after the anchor shot is set"
								}
								tone={generatedSetCount > 0 ? "success" : hasAnchor ? "warning" : "neutral"}
							/>
						</div>

						<div className="flex flex-wrap items-center gap-2">
							<Badge tone={toneForCampaignStatus(campaign.status)}>{humanizeStatusLabel(campaign.status)}</Badge>
							<Badge tone="neutral">Engine: {activeProviderLabel}</Badge>
							<Badge tone="success">{approvedCount} approved</Badge>
							<Badge tone="warning">{pendingCount} pending</Badge>
							{flaggedCount > 0 ? <Badge tone="danger">{flaggedCount} flagged</Badge> : null}
							{driftAverage != null && driftAverage > 0.15 ? <Badge tone="warning">Look mismatch {driftAverage.toFixed(2)}</Badge> : null}
							<Badge tone={hasUnsavedImageSettings ? "warning" : "neutral"}>{hasUnsavedImageSettings ? "Unsaved engine settings" : "Engine synced"}</Badge>
							{campaign.status === "REVIEW" ? (
								<Link href={`/campaigns/${campaignId}/review`} className="sm:ml-auto">
									<Button size="sm" variant="secondary" type="button">
										Open Review
									</Button>
								</Link>
							) : null}
						</div>
					</div>

					<div className="rounded-3xl border border-border/70 bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card),white_16%),color-mix(in_oklab,var(--accent),transparent_72%))] p-4 shadow-[var(--shadow-soft)]">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Current Anchor</p>
								<p className="mt-1 font-display text-2xl leading-none">{hasAnchor ? "Locked and reusable" : "Waiting for first shot"}</p>
								<p className="mt-2 text-xs text-muted-foreground">
									{hasAnchor
										? "The selected anchor is the identity and scene stabilizer for the next batch."
										: "Generate one strong lead frame first. That image becomes the reference spine for the remaining campaign set."}
								</p>
							</div>
							<Badge tone={hasAnchor ? "success" : "warning"}>{hasAnchor ? "Anchor ready" : "Step 3"}</Badge>
						</div>

						{anchorAsset?.raw_gcs_uri ? (
							<button
								type="button"
								onClick={() => setExpandedAssetId(anchorAsset.id)}
								className="mt-4 block w-full rounded-xl border border-border/70 bg-background/70 p-3 text-left transition hover:border-primary/40">
								<ImageGenerationSurface
									src={anchorAsset.raw_gcs_uri}
									alt={`Anchor asset ${anchorAsset.sequence_number}`}
									aspectClassName="aspect-[4/5] w-full"
									className="rounded-lg border border-border/70 bg-muted/40"
								/>
								<div className="mt-3 flex items-center justify-between gap-3">
									<div>
										<p className="text-sm font-semibold">Anchor #{anchorAsset.sequence_number}</p>
										<p className="text-[11px] text-muted-foreground">Click to inspect the active campaign anchor.</p>
									</div>
									<Badge tone="success">{anchorAsset.status}</Badge>
								</div>
							</button>
						) : isGenerating ? (
							<div className="mt-4 rounded-xl border border-border/70 bg-background/70 p-3">
								<ImageGenerationSurface
									src={null}
									alt="Generating campaign anchor"
									aspectClassName="aspect-[4/5] w-full"
									className="rounded-lg border border-border/70 bg-muted/40"
									loading
									loadingTitle={generationProgressBatchSize <= 1 ? "Crafting anchor shot" : "Preparing anchor preview"}
									loadingDescription="The lead frame appears here first so the rest of the campaign can follow its identity, pose, and scene direction."
									loadingBadge={generationProgressBatchSize <= 1 ? "Anchor pass" : "Rendering"}
								/>
								<div className="mt-3 flex items-center justify-between gap-3">
									<div>
										<p className="text-sm font-semibold">Anchor is on the way</p>
										<p className="text-[11px] text-muted-foreground">This preview updates as soon as the first usable frame lands from the generator.</p>
									</div>
									<Badge tone="warning">Live render</Badge>
								</div>
							</div>
						) : (
							<div className="mt-4 rounded-xl border border-dashed border-border/70 bg-background/55 p-4 text-[11px] text-muted-foreground">
								No anchor is set yet. The first generation pass should produce one image that preserves the face, outfit direction, and scene intent well enough to reuse.
							</div>
						)}

						<div className="mt-4 grid gap-2 sm:grid-cols-3">
							<SignalTile label="Run size" value={`${plannedBatchSize} images`} hint={`${anchorBatchSize} remain after the anchor`} tone="neutral" />
							<SignalTile
								label="Resolution"
								value={`${editResWidth} × ${editResHeight}`}
								hint={`${activeProviderLabel} · ${editModelId.trim() || PROVIDER_MODEL_DEFAULTS[editProvider]}`}
								tone="neutral"
							/>
							<SignalTile label="Motion" value={videoPlanLabel} hint={videoPlanHint} tone={videoEnabled ? "success" : "neutral"} />
						</div>
					</div>
				</div>
			</EditorialCard>

			{info ? <StateBlock tone="success" title="Done" description={info} /> : null}
			{error ? <StateBlock tone="danger" title="Action failed" description={error} /> : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="space-y-4">
					<EditorialCard className="space-y-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 className="font-display text-xl font-semibold">Reference Board</h2>
								<p className="text-sm text-muted-foreground">Anchor the identity here first, then support it with mood and scene references.</p>
							</div>
							<Badge tone={referenceSummary.readinessTone}>{referenceSummary.readinessLabel}</Badge>
						</div>

						<div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
							<SignalTile
								label="Total refs"
								value={String(referenceSummary.totalCount)}
								hint="4-8 works best"
								tone={referenceSummary.totalCount >= 4 ? "success" : referenceSummary.totalCount > 0 ? "warning" : "neutral"}
							/>
							<SignalTile label="Primary" value={String(referenceSummary.primaryCount)} hint="1-3 identity anchors" tone={referenceSummary.primaryCount >= 1 ? "success" : "warning"} />
							<SignalTile
								label="Uploads"
								value={String(referenceSummary.uploadedCount)}
								hint={`${referenceSummary.linkedCount} linked`}
								tone={referenceSummary.uploadedCount > 0 ? "success" : "neutral"}
							/>
							<SignalTile label="Coverage" value={referenceSummary.readinessLabel} hint="Use primary for face fidelity" tone={referenceSummary.readinessTone} />
						</div>

						<DropZone onFilesAdded={handleDroppedFiles} className="min-h-[11rem] bg-card/50" />

						<div className="grid gap-3 md:grid-cols-2">
							<form className="space-y-2" onSubmit={addReference}>
								<FormField label="Paste reference URL" id="campaign-reference-url">
									<div className="flex gap-2">
										<Input value={newReferenceUrl} onChange={event => setNewReferenceUrl(event.target.value)} placeholder="https://…" />
										<SelectField value={newReferenceWeight} onChange={event => setNewReferenceWeight(event.target.value as "primary" | "secondary")}>
											<option value="secondary">Secondary</option>
											<option value="primary">Primary</option>
										</SelectField>
										<Button type="submit" size="sm" disabled={submittingReference || isBusy}>
											Add
										</Button>
									</div>
								</FormField>
							</form>

							<form className="space-y-2" onSubmit={uploadReferenceImage}>
								<FormField label="Upload single reference" id="campaign-reference-upload">
									<div className="flex gap-2">
										<Input key={uploadInputKey} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => setUploadReferenceFile(event.target.files?.[0] ?? null)} />
										<SelectField value={uploadReferenceWeight} onChange={event => setUploadReferenceWeight(event.target.value as "primary" | "secondary")}>
											<option value="secondary">Secondary</option>
											<option value="primary">Primary</option>
										</SelectField>
										<Button type="submit" size="sm" disabled={submittingReference || isBusy}>
											Upload
										</Button>
									</div>
								</FormField>
							</form>
						</div>

						<StateBlock
							tone={referenceSummary.readinessTone === "neutral" ? "neutral" : referenceSummary.readinessTone === "warning" ? "warning" : "success"}
							title="Reference recipe"
							description="Use 1-3 primary identity anchors and 3-6 secondary mood references. Primary references should be the closest facial match and least stylized images in the set."
						/>

						{sortedReferences.length ? (
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
								{sortedReferences.map(reference => {
									const preview = toReferencePreview(reference);
									return (
										<div
											key={`${reference.url}-${reference.id ?? ""}`}
											className={`rounded-xl border p-3 ${reference.weight === "primary" ? "border-primary/35 bg-primary/5" : "border-border/70 bg-card"}`}>
											<div className="relative overflow-hidden rounded-lg border border-border/70 bg-muted/35">
												{preview ? (
													<Image src={preview} alt={reference.title ?? "Reference"} width={640} height={480} className="aspect-[4/3] w-full object-cover" unoptimized />
												) : (
													<div className="aspect-[4/3] w-full bg-muted" />
												)}
											</div>
											<div className="mt-3 space-y-2">
												<div className="flex flex-wrap items-center gap-1.5">
													<Badge tone={reference.weight === "primary" ? "warning" : "neutral"}>{reference.weight}</Badge>
													{reference.source === "pinterest_upload" ? <Badge tone="success">uploaded</Badge> : <Badge tone="neutral">linked</Badge>}
													{reference.similarity_score != null ? <Badge tone="neutral">{reference.similarity_score.toFixed(2)} sim</Badge> : null}
												</div>
												<div>
													<p className="line-clamp-2 text-sm font-medium">{reference.title ?? reference.url}</p>
													<p className="mt-1 text-[11px] text-muted-foreground">
														{reference.weight === "primary" ? "Acts as an identity anchor during generation." : "Supports mood, framing, or scene continuity."}
													</p>
												</div>
											</div>
										</div>
									);
								})}
							</div>
						) : (
							<StateBlock tone="neutral" title="No references yet" description="Add links or upload images to improve identity consistency." />
						)}
					</EditorialCard>

					<EditorialCard className="space-y-5">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 className="font-display text-xl font-semibold">Creative Direction</h2>
								<p className="text-sm text-muted-foreground">Shape pose, styling, and realism, then keep the prompt aligned with those controls.</p>
							</div>
							<Badge tone={hasUnsavedStyleChanges ? "warning" : "success"}>{hasUnsavedStyleChanges ? "Live changes" : "Saved direction"}</Badge>
						</div>

						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground">Pose</p>
								<OptionCardGrid options={POSE_OPTIONS} value={posePreset} onChange={value => setPosePreset(value as PosePreset)} columns={5} size="sm" />
							</div>
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground">Expression</p>
								<OptionCardGrid options={EXPRESSION_OPTIONS} value={expressionPreset} onChange={value => setExpressionPreset(value as ExpressionPreset)} columns={5} size="sm" />
							</div>
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground">Silhouette</p>
								<OptionCardGrid options={SILHOUETTE_OPTIONS} value={silhouette} onChange={value => setSilhouette(value as Silhouette)} columns={4} size="sm" />
							</div>
							<div>
								<p className="mb-2 text-xs font-medium text-muted-foreground">Lens</p>
								<OptionCardGrid options={LENS_OPTIONS} value={lensSimulation} onChange={value => setLensSimulation(value as LensSimulation)} columns={4} size="sm" />
							</div>
						</div>

						<div>
							<p className="mb-2 text-xs font-medium text-muted-foreground">Mood Tags</p>
							<ChipInput value={moodTags} onChange={setMoodTags} suggestions={SUGGESTED_MOOD_TAGS} placeholder="Add mood tags…" max={12} />
						</div>

						<div className="grid gap-3 md:grid-cols-2">
							<SliderField label="Shoulder Angle" value={shoulderAngle} onChange={setShoulderAngle} min={-1} max={1} step={0.05} />
							<SliderField label="Hip Shift" value={hipShift} onChange={setHipShift} min={-1} max={1} step={0.05} />
							<SliderField label="Chin Tilt" value={chinTilt} onChange={setChinTilt} min={-1} max={1} step={0.05} />
							<SliderField label="Smile Intensity" value={smileIntensity} onChange={setSmileIntensity} min={0} max={1} step={0.05} />
							<SliderField label="Hem Length" value={hemLength} onChange={setHemLength} min={-1} max={1} step={0.05} />
							<div className="rounded-xl border border-border/50 bg-muted/20 p-3 pt-4">
								<SliderWithPreview label="Skin Realism" value={skinRealism} onChange={setSkinRealism} min={0} max={1} step={0.01} minEmoji="🧴" maxEmoji="📷" />
							</div>
						</div>

						<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_18rem]">
							<div className="space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{promptCustomized ? "Custom Prompt" : "Auto Prompt"}</p>
									{promptCustomized ? (
										<button
											type="button"
											onClick={() => {
												setPromptCustomized(false);
												setPromptText(autoPrompt);
											}}
											className="text-xs text-primary underline underline-offset-2 hover:text-primary/80">
											Reset to auto
										</button>
									) : (
										<span className="text-xs text-muted-foreground">Edit the prompt directly to customize it.</span>
									)}
								</div>

								<PromptSuggestions
									posePreset={posePreset}
									lensSimulation={lensSimulation}
									moodTags={moodTags}
									onSelect={suggestion => {
										setPromptCustomized(true);
										setPromptText(current => appendPromptSuggestion(current, suggestion));
									}}
								/>

								<Textarea
									rows={5}
									value={promptText}
									onChange={event => {
										setPromptText(event.target.value);
										setPromptCustomized(true);
									}}
									placeholder="Describe the exact shot style…"
									className={promptCustomized ? "border-primary/40 bg-primary/5" : ""}
								/>

								<div className="flex flex-wrap items-center gap-2">
									<Badge tone={promptCustomized ? "warning" : "neutral"}>{promptCustomized ? "Custom prompt" : "Auto prompt"}</Badge>
									<Badge tone="neutral">{promptWordCount} words</Badge>
									<Badge tone={hasUnsavedStyleChanges ? "warning" : "success"}>{hasUnsavedStyleChanges ? "Generate uses live controls" : "Direction saved"}</Badge>
								</div>
							</div>

							<div className="rounded-2xl border border-border/70 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--accent),transparent_78%))] p-4">
								<p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Direction Snapshot</p>
								<p className="mt-2 text-sm text-muted-foreground">Keep these aligned so the prompt, controls, and references all describe the same scene.</p>
								<div className="mt-3 flex flex-wrap gap-2">
									<Badge tone="neutral">{POSE_LABELS[posePreset]}</Badge>
									<Badge tone="neutral">{EXPRESSION_LABELS[expressionPreset]}</Badge>
									<Badge tone="neutral">{SILHOUETTE_LABELS[silhouette]}</Badge>
									<Badge tone="neutral">{LENS_LABELS[lensSimulation]}</Badge>
								</div>
								<p className="mt-3 text-xs text-muted-foreground">{autoPrompt}</p>
							</div>
						</div>

						<div className="flex flex-wrap items-center justify-between gap-3">
							<p className="text-xs text-muted-foreground">Saving locks these controls into the campaign so the direction stays consistent when you come back later.</p>
							<Button type="button" variant="secondary" onClick={() => void saveStyle()} disabled={savingStyle || isBusy}>
								{savingStyle ? "Saving…" : "Save Creative Direction"}
							</Button>
						</div>
					</EditorialCard>
				</div>

				<div className="space-y-4 xl:sticky xl:top-5 xl:self-start">
					<EditorialCard className="space-y-4">
						<div className="flex items-start justify-between gap-3">
							<div>
								<h3 className="font-display text-lg font-semibold">Output Plan</h3>
								<p className="text-xs text-muted-foreground">Lock the image run first, then decide whether matching 9:16 videos should auto-queue from the same campaign shots.</p>
							</div>
							<Badge tone={hasUnsavedImageSettings ? "warning" : "success"}>{hasUnsavedImageSettings ? "Unsaved setup" : "Setup synced"}</Badge>
						</div>

						<div className="grid gap-2.5">
							<CampaignStageCard
								icon={<WandSparkles className="size-4" />}
								label="Engine Setup"
								description={hasUnsavedImageSettings ? "The next generation will auto-save the edited engine and resolution settings." : "Provider, version, run size, and resolution are synced."}
								tone={hasUnsavedImageSettings ? "warning" : "success"}
							/>
							<CampaignStageCard
								icon={<ScanFace className="size-4" />}
								label="Anchor Pass"
								description={hasAnchor ? "You can rerun the anchor if you want a stronger lead frame." : "Generate one anchor shot first to lock identity and scene."}
								tone={hasAnchor ? "success" : "warning"}
							/>
							<CampaignStageCard
								icon={<CheckCircle2 className="size-4" />}
								label="Campaign Batch"
								description={
									editProvider === "gpu"
										? "GPU currently supports anchor-only mode here."
										: hasAnchor
											? `Generate ${anchorBatchSize} campaign shots from the anchor.`
											: "Batch unlocks after the anchor is ready."
								}
								tone={editProvider === "gpu" ? "neutral" : hasAnchor ? "warning" : "neutral"}
							/>
							<CampaignStageCard
								icon={<Clapperboard className="size-4" />}
								label="Motion Outputs"
								description={videoEnabled ? videoPlanHint : "Optional. Turn this on when the same campaign run should also produce reel-ready vertical video variants."}
								tone={videoEnabled ? "success" : "neutral"}
							/>
						</div>

						<div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-3">
							<div>
								<p className="mb-2 text-xs font-semibold text-muted-foreground">Image Engine</p>
								<OptionCardGrid
									options={PROVIDER_OPTIONS}
									value={editProvider}
									onChange={value => {
										const provider = value as ImageProvider;
										setEditProvider(provider);
										setEditModelId(PROVIDER_MODEL_DEFAULTS[provider]);
									}}
									columns={2}
									size="sm"
								/>
							</div>

							<div className="grid gap-2 sm:grid-cols-2">
								<FormField label="Run Size" description={`${plannedBatchSize} images`}>
									<Input className="h-9" type="number" min={1} max={12} value={editBatchSize} onChange={event => setEditBatchSize(event.target.value)} />
								</FormField>

								<FormField label="Engine Version">
									<Input className="h-9" value={editModelId} onChange={event => setEditModelId(event.target.value)} />
								</FormField>
							</div>

							<FormField label="Resolution">
								<ResolutionPicker
									width={editResWidth}
									height={editResHeight}
									onResize={(width, height) => {
										setEditResWidth(width);
										setEditResHeight(height);
									}}
								/>
							</FormField>

							<Button type="button" size="sm" variant="secondary" onClick={() => void saveImageSettings()} disabled={savingSettings || isBusy} className="w-full">
								{savingSettings ? "Saving…" : "Save Image Settings"}
							</Button>
						</div>

						<div className="space-y-3 rounded-xl border border-border/50 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_8%),color-mix(in_oklab,var(--accent),transparent_82%))] p-3">
							<div className="flex items-start justify-between gap-2">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Matching Videos</p>
									<p className="text-xs text-muted-foreground">
										Use the newly generated campaign images as the source frames so the video inherits the anchor-locked styling instead of starting from scratch.
									</p>
								</div>
								<Badge tone={videoEnabled ? "success" : "neutral"}>{videoEnabled ? "Auto-queue on" : "Optional"}</Badge>
							</div>

							<ToggleRow
								label="Generate matching reel videos with this campaign"
								description="When enabled, image generation also queues vertical 9:16 videos from the new campaign shots."
								checked={videoEnabled}
								onCheckedChange={setVideoEnabled}
								className="border border-border/70 bg-background/65"
							/>

							{videoEnabled ? (
								<>
									<div>
										<p className="mb-2 text-xs font-semibold text-muted-foreground">Coverage</p>
										<OptionCardGrid options={VIDEO_SCOPE_OPTIONS} value={videoScope} onChange={value => setVideoScope(value as CampaignVideoGenerationScope)} columns={2} size="sm" />
									</div>

									<div>
										<p className="mb-2 text-xs font-semibold text-muted-foreground">Duration</p>
										<OptionCardGrid
											options={VIDEO_DURATION_OPTIONS}
											value={String(videoDurationSeconds)}
											onChange={value => setVideoDurationSeconds(Number(value) as CampaignVideoDurationSeconds)}
											columns={2}
											size="sm"
										/>
									</div>

									<FormField label="Motion Direction" description="Optional. Describe movement, pacing, or camera behavior without changing the visual identity established by the images.">
										<Textarea
											rows={3}
											value={videoPromptText}
											onChange={event => setVideoPromptText(event.target.value)}
											placeholder="e.g. subtle dolly-in, natural hair movement, slow luxury pacing, clean loop finish"
										/>
									</FormField>

									<div className="flex flex-wrap gap-2">
										<Badge tone="neutral">Vertical 9:16</Badge>
										<Badge tone="neutral">{videoCoverageLabel}</Badge>
										<Badge tone="neutral">{videoDurationSeconds}s</Badge>
										{motionPromptTrimmed ? <Badge tone="warning">Custom motion prompt</Badge> : <Badge tone="success">Uses campaign direction</Badge>}
									</div>

									<p className="text-xs text-muted-foreground">
										{videoPlanHint}{" "}
										{hasUnsavedStyleChanges
											? "These motion settings save with Creative Direction, but the next run will still use the live values shown here."
											: "Saved motion settings carry forward for the next run."}
									</p>
								</>
							) : (
								<p className="text-xs text-muted-foreground">Leave this off when you want to review stills first and decide on motion later asset by asset.</p>
							)}
						</div>

						<div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
							<div className="flex items-start justify-between gap-2">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Dispatch</p>
									<p className="text-xs text-muted-foreground">Anchor-first generation keeps campaign outputs visually coherent.</p>
								</div>
								<Badge tone={videoEnabled ? "success" : hasAnchor ? "success" : "warning"}>{videoEnabled ? "Images + motion" : hasAnchor ? "Anchor ready" : "No anchor"}</Badge>
							</div>

							<div className="space-y-2">
								<CostEstimate
									label="Anchor pass"
									batchSize={1}
									width={editResWidth}
									height={editResHeight}
									provider={editProvider}
									referenceCount={references.length}
									promptLength={promptText.length}
								/>
								{editProvider !== "gpu" ? (
									<CostEstimate
										label={`Campaign batch (${anchorBatchSize})`}
										batchSize={anchorBatchSize}
										width={editResWidth}
										height={editResHeight}
										provider={editProvider}
										referenceCount={references.length}
										promptLength={promptText.length}
									/>
								) : null}
							</div>

							<div className="space-y-2">
								<Button type="button" size="sm" onClick={() => void generateByMode("anchor")} disabled={runningGeneration || campaign.status === "GENERATING" || isBusy} className="w-full">
									{runningGeneration ? "Working…" : "1. Generate Anchor Shot"}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={() => void generateByMode("batch")}
									disabled={runningGeneration || campaign.status === "GENERATING" || !hasAnchor || editProvider === "gpu" || isBusy}
									className="w-full">
									{runningGeneration ? "Working…" : `2. Generate Campaign Shots (${anchorBatchSize})`}
								</Button>
							</div>

							{!hasAnchor ? <p className="text-xs text-muted-foreground">Generate and set an anchor before running campaign shots.</p> : null}
							{editProvider === "gpu" ? <p className="text-xs text-muted-foreground">Batch mode with anchor is unavailable for the GPU image engine.</p> : null}
							{hasUnsavedStyleChanges ? <p className="text-xs text-muted-foreground">Generation uses the live creative controls on this page, even before you save them.</p> : null}
							{hasUnsavedImageSettings ? <p className="text-xs text-muted-foreground">The next run will auto-save the engine and resolution settings before dispatching.</p> : null}
							{videoEnabled ? <p className="text-xs text-muted-foreground">{videoPlanHint}</p> : null}

							<GenerationProgress batchSize={generationProgressBatchSize} isGenerating={isGenerating ?? false} onPollComplete={() => void load()} />

							{campaign.status === "REVIEW" ? (
								<Link href={`/campaigns/${campaignId}/review`}>
									<Button type="button" size="sm" variant="secondary" className="w-full">
										Open Review Queue
									</Button>
								</Link>
							) : null}
						</div>
					</EditorialCard>
				</div>
			</div>

			<TableShell
				title="Asset Queue"
				description="Generated outputs. Inspect previews, set the strongest anchor, then move the queue into review."
				rows={campaign.assets}
				columns={assetColumns}
				rowKey={row => row.id}
				emptyMessage={isGenerating ? "Images are rendering now. The live slots above stay animated until the queue fills in." : "No assets yet. Generate an anchor shot to begin."}
			/>

			<TableShell
				title="Generation Jobs"
				description="Recent dispatch and completion activity for this campaign."
				rows={campaign.generation_jobs}
				columns={jobColumns}
				rowKey={row => row.id}
				emptyMessage="No generation jobs yet."
			/>

			<Dialog open={duplicateDialogOpen} onOpenChange={setDuplicateDialogOpen}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Duplicate Campaign Setup</DialogTitle>
						<DialogDescription>
							Create one new draft per selected model. Assets, anchor frames, and review history stay behind.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-4">
						<FormField
							label="Base Name"
							description="Optional. Leave blank to reuse the current campaign name and adapt it for each selected model."
						>
							<Input
								value={duplicateName}
								onChange={event => setDuplicateName(event.target.value)}
								placeholder={campaign.name}
							/>
						</FormField>

						<FormField
							label="Target Models"
							description="Choose the models that should receive a fresh linked draft from this setup."
						>
							<CampaignModelPicker
								models={modelOptions}
								selectedModelIds={duplicateModelIds}
								onSelectedModelIdsChange={setDuplicateModelIds}
								currentModelId={campaign.model?.id}
								disabled={loadingModelOptions || duplicatingCampaigns}
								error={duplicateError ?? undefined}
								emptyMessage="No active models are available to duplicate into."
							/>
						</FormField>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => setDuplicateDialogOpen(false)} disabled={duplicatingCampaigns}>
							Cancel
						</Button>
						<Button type="button" onClick={() => void duplicateCampaign()} disabled={!duplicateReady}>
							{duplicatingCampaigns ? "Duplicating…" : duplicateModelIds.length > 1 ? `Create ${duplicateModelIds.length} Linked Drafts` : "Create Duplicate"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<CampaignAssetLightbox assets={campaign.assets} activeAssetId={expandedAssetId} onClose={() => setExpandedAssetId(null)} onSelectAsset={setExpandedAssetId} />
		</div>
	);
}

type WorkflowTone = "neutral" | "warning" | "success";

function buildCreativeControlsPayload({
	posePreset,
	expressionPreset,
	silhouette,
	lensSimulation,
	moodTags,
	videoEnabled,
	videoScope,
	videoDurationSeconds,
	videoPromptText,
	shoulderAngle,
	hipShift,
	chinTilt,
	smileIntensity,
	hemLength,
	skinRealism
}: {
	posePreset: PosePreset;
	expressionPreset: ExpressionPreset;
	silhouette: Silhouette;
	lensSimulation: LensSimulation;
	moodTags: string[];
	videoEnabled: boolean;
	videoScope: CampaignVideoGenerationScope;
	videoDurationSeconds: CampaignVideoDurationSeconds;
	videoPromptText: string;
	shoulderAngle: string;
	hipShift: string;
	chinTilt: string;
	smileIntensity: string;
	hemLength: string;
	skinRealism: number;
}) {
	return {
		pose: {
			preset: posePreset,
			micro_rotation: {
				shoulder_angle: clampFloat(shoulderAngle, 0, -1, 1),
				hip_shift: clampFloat(hipShift, 0, -1, 1),
				chin_tilt: clampFloat(chinTilt, 0, -1, 1)
			}
		},
		expression: {
			preset: expressionPreset,
			smile_intensity: clampFloat(smileIntensity, 0.2, 0, 1)
		},
		outfit: {
			silhouette,
			micro_adjustment: {
				hem_length: clampFloat(hemLength, 0, -1, 1)
			}
		},
		realism: {
			lens_simulation: lensSimulation,
			skin_texture_realism: clampFloat(skinRealism, 0.82, 0, 1)
		},
		aesthetic: {
			mood_tags: moodTags.slice(0, 12)
		},
		video: {
			enabled: videoEnabled,
			generation_scope: videoScope,
			duration_seconds: videoDurationSeconds,
			prompt_text: videoPromptText.trim()
		}
	};
}

function buildAutoPrompt(pose: PosePreset, expression: ExpressionPreset, silhouette: Silhouette, lens: LensSimulation, moodTags: string[]): string {
	const parts = [POSE_LABELS[pose], EXPRESSION_LABELS[expression], SILHOUETTE_LABELS[silhouette], LENS_LABELS[lens]];
	if (moodTags.length > 0) parts.push(moodTags.join(", "));
	return parts.join(", ");
}

function coerceValue<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
	return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function SliderField({ label, value, onChange, min, max, step }: { label: string; value: string; onChange: (next: string) => void; min: number; max: number; step: number }) {
	return (
		<div className="rounded-xl border border-border/50 bg-muted/20 p-3 pt-4">
			<SliderWithPreview
				label={label}
				value={Number.parseFloat(value || "0")}
				onChange={next => onChange(String(next))}
				min={min}
				max={max}
				step={step}
				minEmoji={min < 0 ? "➖" : "🌑"}
				maxEmoji={max > 0 ? "➕" : "🌕"}
			/>
		</div>
	);
}

function isValidUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:";
	} catch {
		return false;
	}
}

function toReferencePreview(reference: ReferenceItem): string | null {
	const candidate = reference.thumbnail_url ?? reference.url;
	if (!candidate) return null;
	if (candidate.startsWith("data:image/")) return candidate;
	if (/\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(candidate)) return candidate;
	if (candidate.startsWith("http://") || candidate.startsWith("https://")) return candidate;
	return null;
}

function appendPromptSuggestion(prompt: string, suggestion: string): string {
	const trimmedPrompt = prompt.trim();
	const trimmedSuggestion = suggestion.trim();
	if (!trimmedSuggestion) return prompt;
	if (!trimmedPrompt) return trimmedSuggestion;
	return trimmedPrompt.toLowerCase().includes(trimmedSuggestion.toLowerCase()) ? trimmedPrompt : `${trimmedPrompt}, ${trimmedSuggestion}`;
}

function arrayEquals(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}

function CampaignStageCard({ icon, label, description, tone }: { icon: ReactNode; label: string; description: string; tone: WorkflowTone }) {
	const toneClassName = tone === "success" ? "border-emerald-400/30 bg-emerald-500/10" : tone === "warning" ? "border-amber-400/30 bg-amber-500/10" : "border-border/70 bg-card/60";

	return (
		<div className={`rounded-xl border p-3 ${toneClassName}`}>
			<div className="flex items-start gap-3">
				<div className="rounded-full border border-border/70 bg-background/80 p-2 text-muted-foreground">{icon}</div>
				<div className="space-y-1">
					<p className="text-sm font-semibold">{label}</p>
					<p className="text-[11px] leading-5 text-muted-foreground">{description}</p>
				</div>
			</div>
		</div>
	);
}

function SignalTile({ label, value, hint, tone }: { label: string; value: string; hint: string; tone: WorkflowTone }) {
	const valueClassName = tone === "success" ? "text-[var(--status-success)]" : tone === "warning" ? "text-[var(--status-warning)]" : "text-foreground";

	return (
		<div className="rounded-xl border border-border/70 bg-card/55 p-3">
			<p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
			<p className={`mt-2 text-sm font-semibold ${valueClassName}`}>{value}</p>
			<p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
		</div>
	);
}
