"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { CampaignModelPicker, type CampaignModelPickerItem } from "@/components/campaigns/campaign-model-picker";
import { PageHeader } from "@/components/layout/page-header";
import { useNotice } from "@/components/providers/notice-provider";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { OptionCardGrid } from "@/components/ui/option-card-grid";
import { StateBlock } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { ToggleRow } from "@/components/ui/toggle-row";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { FormField } from "@/components/workspace/form-field";
import { parseFieldErrors } from "@/lib/api-errors";
import { apiRequest } from "@/lib/client-api";
import {
	CAMPAIGN_VIDEO_DURATION_VALUES,
	type CampaignVideoDurationSeconds,
	type CampaignVideoGenerationScope,
	DEFAULT_CAMPAIGN_VIDEO_SETTINGS
} from "@/lib/campaign-video";
import type { FieldErrorMap } from "@/types/ui";

type Model = CampaignModelPickerItem;

const VIDEO_SCOPE_OPTIONS = [
	{ value: "all_images" as const, label: "Every shot", emoji: "🎞️", description: "Queue a matching vertical reel for each image generated in the run." },
	{ value: "anchor_only" as const, label: "Anchor only", emoji: "🧷", description: "Create one motion proof from the anchor before spending on the rest." }
];

const VIDEO_DURATION_OPTIONS = [
	{ value: String(CAMPAIGN_VIDEO_DURATION_VALUES[1]), label: "8 sec", emoji: "🎬", description: "Longer editorial movement" },
	{ value: String(CAMPAIGN_VIDEO_DURATION_VALUES[0]), label: "6 sec", emoji: "⚡", description: "Quicker loop" }
];

export default function NewCampaignPage() {
	const router = useRouter();
	const { notify } = useNotice();

	const [models, setModels] = useState<Model[]>([]);
	const [loadingDependencies, setLoadingDependencies] = useState(true);

	const [name, setName] = useState("");
	const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
	const [videoEnabled, setVideoEnabled] = useState(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.enabled);
	const [videoScope, setVideoScope] = useState<CampaignVideoGenerationScope>(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.generation_scope);
	const [videoDurationSeconds, setVideoDurationSeconds] = useState<CampaignVideoDurationSeconds>(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.duration_seconds);
	const [videoPromptText, setVideoPromptText] = useState(DEFAULT_CAMPAIGN_VIDEO_SETTINGS.prompt_text ?? "");

	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
	const [saving, setSaving] = useState(false);

	const videoPlanSummary = videoEnabled
		? videoScope === "all_images"
			? `Anchor pass plus every new campaign image will auto-queue an ${videoDurationSeconds}s vertical video.`
			: `Only the anchor pass will auto-queue an ${videoDurationSeconds}s vertical video.`
		: "This campaign will start as images only.";

	const loadDependencies = useCallback(async () => {
		setLoadingDependencies(true);
		setError(null);
		try {
			const modelPayload = await apiRequest<{ data: Model[] }>("/api/models");
			const activeModels = modelPayload.data.filter(item => item.status === "ACTIVE");
			setModels(activeModels);
			setSelectedModelIds(current => {
				const validSelections = current.filter(modelId => activeModels.some(item => item.id === modelId));
				if (validSelections.length > 0) return validSelections;
				return activeModels[0]?.id ? [activeModels[0].id] : [];
			});
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't load models");
		} finally {
			setLoadingDependencies(false);
		}
	}, []);

	useEffect(() => {
		void loadDependencies();
	}, [loadDependencies]);

	const hasActiveModels = models.length > 0;
	const selectedModelCount = selectedModelIds.length;
	const canSubmit = !loadingDependencies && !saving && selectedModelCount > 0;

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		setSaving(true);
		setError(null);
		setFieldErrors({});

		try {
			const created = await apiRequest<{
				id: string;
				primary_campaign_id?: string;
				campaigns?: Array<{ id: string }>;
			}>("/api/campaigns", {
				method: "POST",
				body: JSON.stringify({
					name: name.trim() || undefined,
					model_ids: selectedModelIds,
					batch_size: 8,
					resolution_width: 1024,
					resolution_height: 1024,
					upscale: true,
					image_model: { provider: "zai_glm", model_id: "glm-image" },
					creative_controls: {
						pose: { preset: "editorial", controlnet_pose_lock: true, protect_body_proportions: true },
						expression: { preset: "soft_smile", smile_intensity: 0.18, consistency_across_campaign: true },
						identity: { face_embedding_lock: true, body_ratio_enforcement: true, imperfection_persistence: true },
						realism: { lens_simulation: "85mm_editorial", skin_texture_realism: 0.82, artifact_detection: true },
						aesthetic: { mood_tags: ["editorial luxe"], lock_aesthetic_for_campaign: true },
						moderation: { require_approval: true, quality_score_threshold: 82, auto_flag_artifacts: true },
						video: {
							enabled: videoEnabled,
							generation_scope: videoScope,
							duration_seconds: videoDurationSeconds,
							prompt_text: videoPromptText.trim()
						}
					}
				})
			});

			const createdCount = created.campaigns?.length ?? 1;
			notify({
				tone: "success",
				title: createdCount > 1 ? "Linked campaign set created" : "Campaign created",
				description:
					createdCount > 1
						? `${createdCount} linked drafts are ready across the selected models.`
						: "The campaign workspace is ready.",
			});
			router.push(`/campaigns/${created.primary_campaign_id ?? created.id}`);
		} catch (err) {
			const parsed = parseFieldErrors(err);
			setFieldErrors(parsed);
			setError(err instanceof Error ? err.message : "We couldn't create this campaign.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-4">
			<PageHeader title="New Campaign" description="Set the visual run, decide whether matching videos should be part of it, then open the workspace." />

			{loadingDependencies ? <StateBlock title="Loading models…" /> : null}
			{error ? <StateBlock tone="danger" title="Campaign setup issue" description={error} /> : null}
			<FormErrorSummary errors={fieldErrors} />

			<form onSubmit={onSubmit}>
				<EditorialCard className="space-y-5 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
					<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
						<div className="space-y-5">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Campaign Setup</p>
								<h2 className="mt-2 font-display text-2xl font-semibold">Start the image run and decide whether motion comes with it.</h2>
								<p className="mt-2 text-sm text-muted-foreground">The campaign workspace still uses the anchor-first flow. This step just decides whether matching reel-ready videos should auto-queue from those same anchor-aligned images.</p>
							</div>

							<FormField label="Campaign Name" id="campaign-name" hint="Optional - auto-generated if empty">
								<Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. SS26 Jewelry Drop" />
							</FormField>

							<FormField
								label="Models"
								id="campaign-model"
								required
								error={fieldErrors.model_ids?.[0] ?? fieldErrors.model_id?.[0]}
								hint="Pick one model for a single campaign, or pick several to create one linked draft per model."
							>
								<CampaignModelPicker
									models={models}
									selectedModelIds={selectedModelIds}
									onSelectedModelIdsChange={setSelectedModelIds}
									disabled={loadingDependencies || !hasActiveModels}
									error={fieldErrors.model_ids?.[0] ?? fieldErrors.model_id?.[0]}
									emptyMessage="Create and activate a model first."
								/>
							</FormField>
						</div>

						<div className="rounded-2xl border border-border/70 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--accent),transparent_78%))] p-4">
							<p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">What Happens Next</p>
							<div className="mt-3 space-y-3 text-sm text-muted-foreground">
								<p>1. Create {selectedModelCount > 1 ? `${selectedModelCount} linked campaign drafts` : "the campaign"} and open the first workspace.</p>
								<p>2. Generate one anchor image first.</p>
								<p>3. Run the remaining campaign shots from that anchor.</p>
								<p>4. If motion is enabled, matching 9:16 videos auto-queue from the new images in the same style.</p>
							</div>
						</div>
					</div>

					<div className="space-y-3 rounded-2xl border border-border/70 bg-card/55 p-4">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Motion Outputs</p>
								<h3 className="mt-2 font-display text-lg font-semibold">Optional matching video generation</h3>
								<p className="mt-1 text-sm text-muted-foreground">Use this when the campaign should leave the image run with reel-ready vertical videos instead of asking you to generate them one asset at a time later.</p>
							</div>
						</div>

						<ToggleRow
							label="Generate matching reel videos with the campaign"
							description="The workspace will auto-queue vertical 9:16 videos from the same anchor-aligned images you generate."
							checked={videoEnabled}
							onCheckedChange={setVideoEnabled}
							className="border border-border/70 bg-background/70"
						/>

						{videoEnabled ? (
							<div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
								<div className="space-y-4">
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
								</div>

								<FormField label="Motion Direction" description="Optional. Add movement or pacing instructions without changing the look of the campaign.">
									<Textarea
										rows={5}
										value={videoPromptText}
										onChange={event => setVideoPromptText(event.target.value)}
										placeholder="e.g. slow luxury pacing, soft camera drift, natural hair movement, loop-friendly ending"
									/>
								</FormField>
							</div>
						) : null}

						<StateBlock
							tone={videoEnabled ? "success" : "neutral"}
							title={videoEnabled ? "Motion is part of the plan" : "Images only for now"}
							description={videoPlanSummary}
						/>
					</div>

					{!hasActiveModels && !loadingDependencies ? (
						<StateBlock
							tone="neutral"
							title="Setup Required"
							description="Create and activate a model first."
							action={
								<Button asChild size="sm">
									<Link href="/models/new">Create Model</Link>
								</Button>
							}
						/>
					) : null}

					<Button type="submit" disabled={!canSubmit} className={`w-full text-base py-3 ${canSubmit ? "shadow-[0_0_20px_rgba(var(--color-primary-rgb,99,102,241),0.3)]" : ""}`}>
						{saving ? "Creating…" : selectedModelCount > 1 ? `Create ${selectedModelCount} Linked Campaigns` : "Create & Open Workspace"}
					</Button>
				</EditorialCard>
			</form>
		</div>
	);
}
