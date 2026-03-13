
"use client";

import Image from "next/image";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { CampaignAssetLightbox } from "@/components/campaigns/campaign-asset-lightbox";
import { CostEstimate } from "@/components/campaigns/cost-estimate";
import { DropZone } from "@/components/campaigns/drop-zone";
import { GenerationProgress } from "@/components/campaigns/generation-progress";
import { ResolutionPicker } from "@/components/campaigns/resolution-picker";
import { PageHeader } from "@/components/layout/page-header";
import { useBreadcrumb } from "@/components/providers/breadcrumb-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChipInput } from "@/components/ui/chip-input";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Input } from "@/components/ui/input";
import { OptionCardGrid } from "@/components/ui/option-card-grid";
import { SelectField } from "@/components/ui/select";
import { SliderWithPreview } from "@/components/ui/slider-with-preview";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { XpProgressBar } from "@/components/ui/xp-progress-bar";
import { FormField } from "@/components/workspace/form-field";
import { TableShell, type TableShellColumn } from "@/components/workspace/table-shell";
import { apiFormRequest, apiRequest } from "@/lib/client-api";
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
	anchor_asset_id?: string | null;
	prompt_text: string | null;
	image_model_provider: ImageProvider;
	image_model_id: string | null;
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
	};
	assets: Asset[];
	generation_jobs: Job[];
	batch_size?: number;
	resolution_width?: number;
	resolution_height?: number;
};

type ReferenceBoardResponse = {
	items?: ReferenceItem[];
};

export default function CampaignDetailPage() {
	const params = useParams<{ id: string }>();
	const pathname = usePathname();
	const { setSegmentTitle } = useBreadcrumb();
	const campaignId = params.id;
	const segmentIndex = pathname.split("/").filter(Boolean).indexOf(campaignId);

	const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
	const [references, setReferences] = useState<ReferenceItem[]>([]);

	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);
	const [savingStyle, setSavingStyle] = useState(false);
	const [savingSettings, setSavingSettings] = useState(false);
	const [runningGeneration, setRunningGeneration] = useState(false);
	const [submittingReference, setSubmittingReference] = useState(false);
	const [settingAnchorId, setSettingAnchorId] = useState<string | null>(null);

	const [error, setError] = useState<string | null>(null);
	const [info, setInfo] = useState<string | null>(null);

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

				setPosePreset(nextPose);
				setExpressionPreset(nextExpression);
				setSilhouette(nextSilhouette);
				setLensSimulation(nextLens);
				setMoodTags(nextMoodTags.slice(0, 12));

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

	useEffect(() => {
		void load("initial");
	}, [load]);

	useEffect(() => {
		return () => {
			if (segmentIndex >= 0) setSegmentTitle(segmentIndex, null);
		};
	}, [segmentIndex, setSegmentTitle]);

	const isBusy = savingStyle || savingSettings || runningGeneration || submittingReference || Boolean(settingAnchorId);
	const hasAnchor = Boolean(campaign?.anchor_asset_id);
	const anchorBatchSize = Math.max(1, (campaign?.batch_size ?? 8) - 1);
	const isGenerating = campaign?.generation_jobs.some(job => job.status === "IN_PROGRESS" || job.status === "DISPATCHED");
	const generationProgressBatchSize = lastRequestedBatchSize || (campaign?.batch_size ?? 8);

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

	useEffect(() => {
		if (!expandedAssetId) return;
		if (!campaign?.assets.some(asset => asset.id === expandedAssetId)) {
			setExpandedAssetId(null);
		}
	}, [campaign?.assets, expandedAssetId]);

	async function saveStyle() {
		if (!campaign) return;
		const prompt = promptText.trim();
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
						creative_controls: {
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
							}
						}
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

	async function saveImageSettings() {
		if (!campaign) return;

		setSavingSettings(true);
		setError(null);
		setInfo(null);

		const nextBatchSize = Math.max(1, Math.min(12, Math.trunc(Number(editBatchSize) || 8)));
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
			setInfo("Image settings saved.");
			await load();
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't save image settings.");
		} finally {
			setSavingSettings(false);
		}
	}

	async function generateByMode(mode: "anchor" | "batch") {
		if (!campaign) return;

		const prompt = promptText.trim();
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
			await apiRequest(`/api/campaigns/${campaignId}/generate`, {
				method: "POST",
				body: JSON.stringify({
					prompt_text: prompt,
					generation_mode: mode,
					...(mode === "batch" && campaign.anchor_asset_id ? { anchor_asset_id: campaign.anchor_asset_id } : {})
				})
			});

			setLastRequestedBatchSize(mode === "anchor" ? 1 : anchorBatchSize);
			setInfo(mode === "anchor" ? "Anchor generation started." : "Campaign generation started.");
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
			cell: (asset: Asset) =>
				asset.raw_gcs_uri ? (
					<button
						type="button"
						onClick={() => setExpandedAssetId(asset.id)}
						className="block h-16 w-16 overflow-hidden rounded-md border border-border bg-muted hover:opacity-80 transition-opacity"
						aria-label={`Open asset ${asset.sequence_number}`}>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img src={asset.raw_gcs_uri} alt={`Seed ${asset.seed}`} className="h-full w-full object-cover" />
					</button>
				) : (
					<div className="h-16 w-16 rounded-md border border-border bg-muted" />
				)
		},
		{ key: "sequence", header: "#", cell: (asset: Asset) => <span>#{asset.sequence_number}</span> },
		{ key: "seed", header: "Seed", cell: (asset: Asset) => <code className="text-xs">{asset.seed}</code> },
		{
			key: "status",
			header: "Status",
			cell: (asset: Asset) => <Badge tone={asset.status === "APPROVED" ? "success" : asset.status === "REJECTED" ? "danger" : "warning"}>{asset.status === "PENDING" ? "NEEDS REVIEW" : asset.status}</Badge>
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
				<StateBlock tone="error" title="Couldn't load campaign" description={error ?? "Please refresh and try again."} />
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<PageHeader
				title={`🎬 ${campaign.name}`}
				description="Refine references, tune creative controls, and generate campaign-ready assets."
				action={
					<Button variant="secondary" type="button" onClick={() => void load("refresh")} disabled={refreshing || isBusy} aria-label="Refresh campaign">
						<RefreshCw className={`h-4 w-4 ${refreshing || loading ? "animate-spin" : ""}`} />
						Refresh
					</Button>
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

			<div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-card/40 px-4 py-2.5">
				<Badge tone={toneForCampaignStatus(campaign.status)}>{humanizeStatusLabel(campaign.status)}</Badge>
				<Badge tone="neutral">⚡ {campaign.image_model_provider}</Badge>
				<Badge tone="success">✓ {approvedCount} approved</Badge>
				<Badge tone="warning">⏳ {pendingCount} pending</Badge>
				{flaggedCount > 0 ? <Badge tone="danger">⚠ {flaggedCount} flagged</Badge> : null}
				{driftAverage != null && driftAverage > 0.15 ? <Badge tone="warning">Look Mismatch {driftAverage.toFixed(2)}</Badge> : null}
				<Badge tone={hasAnchor ? "success" : "warning"}>{hasAnchor ? "⚓ Anchor ready" : "⚓ Anchor missing"}</Badge>
				<Badge tone="neutral">🖼️ {references.length} refs</Badge>
				{campaign.status === "REVIEW" ? (
					<Link href={`/campaigns/${campaignId}/review`} className="ml-auto">
						<Button size="sm" variant="secondary" type="button">
							Open Review →
						</Button>
					</Link>
				) : null}
			</div>

			{info ? <StateBlock tone="success" title="Done" description={info} /> : null}
			{error ? <StateBlock tone="error" title="Action failed" description={error} /> : null}

			<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
				<div className="space-y-4">
					<EditorialCard className="space-y-4">
						<div>
							<h2 className="font-display text-xl font-semibold">🖼️ Inspiration Board</h2>
							<p className="text-sm text-muted-foreground">Drop references to stabilize identity before generating campaign shots.</p>
						</div>

						<DropZone onFilesAdded={handleDroppedFiles} />

						<div className="grid gap-3 md:grid-cols-2">
							<form className="space-y-2" onSubmit={addReference}>
								<FormField label="Reference URL" id="campaign-reference-url">
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
								<FormField label="Upload reference" id="campaign-reference-upload">
									<div className="flex gap-2">
										<Input
											key={uploadInputKey}
											type="file"
											accept="image/jpeg,image/png,image/webp"
											onChange={event => setUploadReferenceFile(event.target.files?.[0] ?? null)}
										/>
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

						{references.length ? (
							<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
								{references.map(reference => {
									const preview = toReferencePreview(reference);
									return (
										<div key={`${reference.url}-${reference.id ?? ""}`} className="flex items-center gap-3 rounded-lg border border-input bg-card px-3 py-2 text-sm">
											{preview ? (
												<div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md border border-border">
													<Image src={preview} alt={reference.title ?? "Reference"} fill sizes="40px" className="object-cover" unoptimized />
												</div>
											) : (
												<div className="h-10 w-10 shrink-0 rounded-md border border-border bg-muted" />
											)}
											<div className="min-w-0 flex-1">
												<p className="truncate font-medium">{reference.title ?? reference.url}</p>
												<div className="mt-0.5 flex gap-1">
													<Badge tone={reference.weight === "primary" ? "warning" : "neutral"}>{reference.weight}</Badge>
													{reference.source === "pinterest_upload" ? <Badge tone="success">uploaded</Badge> : null}
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
						<div>
							<h2 className="font-display text-xl font-semibold">🎨 Creative Direction</h2>
							<p className="text-sm text-muted-foreground">Dial pose, styling, and realism; then save once to persist the full direction.</p>
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

						<div className="space-y-2">
							<div className="flex items-center justify-between">
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
									<span className="text-xs text-muted-foreground">Editing turns this into a custom prompt.</span>
								)}
							</div>

							<Textarea
								rows={4}
								value={promptText}
								onChange={event => {
									setPromptText(event.target.value);
									setPromptCustomized(true);
								}}
								placeholder="Describe the exact shot style…"
								className={promptCustomized ? "border-primary/40 bg-primary/5" : ""}
							/>
						</div>

						<div className="flex justify-end">
							<Button type="button" variant="secondary" onClick={() => void saveStyle()} disabled={savingStyle || isBusy}>
								{savingStyle ? "Saving…" : "Save Creative Direction"}
							</Button>
						</div>
					</EditorialCard>
				</div>

				<div className="space-y-4 xl:sticky xl:top-5 xl:self-start">
					<EditorialCard className="space-y-3">
						<div>
							<h3 className="font-display text-lg font-semibold">⚙️ Image + Generate</h3>
							<p className="text-xs text-muted-foreground">Set the engine first, then launch anchor-first generation.</p>
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
								<FormField label="Run Size" description={`${Math.max(1, Math.min(12, Math.trunc(Number(editBatchSize) || 8)))} images`}>
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

						<div className="h-px bg-border/60" />

						<div className="space-y-3 rounded-xl border border-border/50 bg-card/40 p-3">
							<div className="flex items-start justify-between gap-2">
								<div>
									<p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Generate</p>
									<p className="text-xs text-muted-foreground">Anchor-first workflow keeps campaign outputs coherent.</p>
								</div>
								<Badge tone={hasAnchor ? "success" : "warning"}>{hasAnchor ? "Anchor ready" : "No anchor"}</Badge>
							</div>

							<div className="space-y-2">
								<Button type="button" size="sm" onClick={() => void generateByMode("anchor")} disabled={runningGeneration || campaign.status === "GENERATING" || isBusy} className="w-full">
									{runningGeneration ? "Working…" : "Generate Anchor Shot"}
								</Button>
								<Button
									type="button"
									size="sm"
									variant="secondary"
									onClick={() => void generateByMode("batch")}
									disabled={runningGeneration || campaign.status === "GENERATING" || !hasAnchor || campaign.image_model_provider === "gpu" || isBusy}
									className="w-full">
									{runningGeneration ? "Working…" : `Generate Campaign Shots (${anchorBatchSize})`}
								</Button>
							</div>

							{!hasAnchor ? <p className="text-xs text-muted-foreground">Generate and set an anchor before running campaign shots.</p> : null}
							{campaign.image_model_provider === "gpu" ? <p className="text-xs text-muted-foreground">Batch mode with anchor is unavailable for the GPU image engine.</p> : null}

							<CostEstimate
								batchSize={anchorBatchSize}
								width={campaign.resolution_width ?? 1024}
								height={campaign.resolution_height ?? 1024}
								provider={campaign.image_model_provider}
								referenceCount={references.length}
								promptLength={promptText.length}
							/>

							<GenerationProgress batchSize={generationProgressBatchSize} isGenerating={isGenerating ?? false} onPollComplete={() => void load()} />
						</div>
					</EditorialCard>
				</div>
			</div>

			<TableShell
				title="Asset Queue"
				description="Generated outputs. Click any preview to inspect at full size."
				rows={campaign.assets}
				columns={assetColumns}
				rowKey={row => row.id}
				emptyMessage="No assets yet. Generate an anchor shot to begin."
			/>

			<TableShell title="Generation Jobs" description="Recent dispatch and completion states." rows={campaign.generation_jobs} columns={jobColumns} rowKey={row => row.id} emptyMessage="No generation jobs yet." />

			<CampaignAssetLightbox
				assets={campaign.assets}
				activeAssetId={expandedAssetId}
				onClose={() => setExpandedAssetId(null)}
				onSelectAsset={setExpandedAssetId}
			/>
		</div>
	);
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
