"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { EditorialCard } from "@/components/ui/editorial-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select";
import { StateBlock } from "@/components/ui/state-block";
import { FormErrorSummary } from "@/components/ui/form-error-summary";
import { FormField } from "@/components/workspace/form-field";
import { parseFieldErrors } from "@/lib/api-errors";
import { apiRequest } from "@/lib/client-api";
import type { FieldErrorMap } from "@/types/ui";

type Model = { id: string; name: string; status: "DRAFT" | "ACTIVE" | "ARCHIVED" };

export default function NewCampaignPage() {
	const router = useRouter();

	const [models, setModels] = useState<Model[]>([]);
	const [loadingDependencies, setLoadingDependencies] = useState(true);

	const [name, setName] = useState("");
	const [modelId, setModelId] = useState("");

	const [error, setError] = useState<string | null>(null);
	const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
	const [saving, setSaving] = useState(false);

	const loadDependencies = useCallback(async () => {
		setLoadingDependencies(true);
		setError(null);
		try {
			const modelPayload = await apiRequest<{ data: Model[] }>("/api/models");
			const activeModels = modelPayload.data.filter(item => item.status === "ACTIVE");
			setModels(activeModels);
			setModelId(current => {
				if (current && activeModels.some(item => item.id === current)) return current;
				return activeModels[0]?.id ?? "";
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
	const canSubmit = !loadingDependencies && !saving && modelId.length > 0;

	async function onSubmit(event: FormEvent) {
		event.preventDefault();
		if (!canSubmit) return;
		setSaving(true);
		setError(null);
		setFieldErrors({});

		try {
			const created = await apiRequest<{ id: string }>("/api/campaigns", {
				method: "POST",
				body: JSON.stringify({
					name: name.trim() || undefined,
					model_id: modelId,
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
						review: { require_approval: true, quality_score_threshold: 82, auto_flag_artifacts: true }
					}
				})
			});

			router.push(`/campaigns/${created.id}`);
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
			<PageHeader title="New Campaign" description="Create a campaign and open the workspace." />

			{loadingDependencies ? <StateBlock title="Loading models…" /> : null}
			{error ? <StateBlock tone="error" title="Campaign setup issue" description={error} /> : null}
			<FormErrorSummary errors={fieldErrors} />

			<form onSubmit={onSubmit}>
				<EditorialCard className="space-y-5 animate-in fade-in-50 slide-in-from-bottom-2 duration-200">
					<FormField label="Campaign Name" id="campaign-name" hint="Optional — auto-generated if empty">
						<Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. SS26 Jewelry Drop" />
					</FormField>

					<FormField label="Model" id="campaign-model" required error={fieldErrors.model_id?.[0]}>
						<SelectField
							value={modelId}
							onChange={e => setModelId(e.target.value)}
							required
							disabled={loadingDependencies || !hasActiveModels}
						>
							{models.length === 0 ? <option value="">No active models</option> : null}
							{models.map(model => (
								<option key={model.id} value={model.id}>
									{model.name}
								</option>
							))}
						</SelectField>
					</FormField>

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
						{saving ? "Creating…" : "Create & Open Workspace"}
					</Button>
				</EditorialCard>
			</form>
		</div>
	);
}
