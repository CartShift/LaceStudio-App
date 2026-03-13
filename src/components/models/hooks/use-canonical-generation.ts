"use client";

import { useState } from "react";
import { apiRequest } from "@/lib/client-api";
import { sleep } from "@/lib/utils";
import type { CanonicalPackSummary } from "@/components/models/types";
import type { ImageModelProvider } from "@/server/schemas/creative";

const CANONICAL_POLL_MAX_ATTEMPTS = 180;
const CANONICAL_POLL_FAST_DELAY_MS = 1_500;
const CANONICAL_POLL_MEDIUM_DELAY_MS = 3_000;
const CANONICAL_POLL_SLOW_DELAY_MS = 5_000;
const CANONICAL_TERMINAL_STATUSES = new Set<CanonicalPackSummary["status"]>(["READY", "APPROVED", "FAILED"]);

function canonicalPollDelayMs(attempt: number): number {
	if (attempt < 40) return CANONICAL_POLL_FAST_DELAY_MS;
	if (attempt < 100) return CANONICAL_POLL_MEDIUM_DELAY_MS;
	return CANONICAL_POLL_SLOW_DELAY_MS;
}

export type UseCanonicalGenerationReturn = {
	generating: boolean;
	summary: CanonicalPackSummary | null;
	setSummary: React.Dispatch<React.SetStateAction<CanonicalPackSummary | null>>;
	loadSummary: (modelId: string, packVersion?: number) => Promise<CanonicalPackSummary>;
	startGeneration: (input: {
		modelId: string;
		mode: "front_only" | "remaining" | "full";
		provider: ImageModelProvider;
		providerModelId?: string;
		candidatesPerShot?: number;
		packVersion?: number;
	}) => Promise<CanonicalPackSummary["status"]>;
};

/**
 * F1: Extracted useCanonicalGeneration hook.
 * Encapsulates: polling logic (adaptive delay), summary loading, generation start.
 * The wizard component consumes this to render status without knowing the poll timing.
 */
export function useCanonicalGeneration(onSummaryUpdated: (summary: CanonicalPackSummary) => void, setError: (error: string | null) => void): UseCanonicalGenerationReturn {
	const [generating, setGenerating] = useState(false);
	const [summary, setSummary] = useState<CanonicalPackSummary | null>(null);

	async function loadSummary(modelId: string, packVersion?: number): Promise<CanonicalPackSummary> {
		const url = `/api/models/${modelId}/workflow/canonical-pack${packVersion && packVersion > 0 ? `?pack_version=${packVersion}` : ""}`;
		const payload = await apiRequest<CanonicalPackSummary>(url);
		setSummary(payload);
		onSummaryUpdated(payload);
		return payload;
	}

	async function pollUntilDone(modelId: string, packVersion: number): Promise<CanonicalPackSummary["status"]> {
		let latestStatus: CanonicalPackSummary["status"] | null = null;

		for (let attempt = 0; attempt < CANONICAL_POLL_MAX_ATTEMPTS; attempt += 1) {
			const payload = await apiRequest<CanonicalPackSummary>(`/api/models/${modelId}/workflow/canonical-pack?pack_version=${packVersion}`);

			latestStatus = payload.status;
			setSummary(payload);
			onSummaryUpdated(payload);

			if (CANONICAL_TERMINAL_STATUSES.has(payload.status)) {
				return payload.status;
			}

			await sleep(canonicalPollDelayMs(attempt));
		}

		throw new Error(
			latestStatus
				? `Reference Set creation is taking longer than expected (currently ${latestStatus.toLowerCase()}). Please refresh and continue.`
				: "Reference Set creation is taking longer than expected. Please refresh and continue."
		);
	}

	async function startGeneration(input: {
		modelId: string;
		mode: "front_only" | "remaining" | "full";
		provider: ImageModelProvider;
		providerModelId?: string;
		candidatesPerShot?: number;
		packVersion?: number;
	}): Promise<CanonicalPackSummary["status"]> {
		setGenerating(true);
		setError(null);
		try {
			const started = await apiRequest<{ pack_version: number; job_id: string }>(`/api/models/${input.modelId}/workflow/canonical-pack/generate`, {
				method: "POST",
				body: JSON.stringify({
					provider: input.provider,
					model_id: input.providerModelId || undefined,
					pack_template: "balanced_8",
					candidates_per_shot: input.candidatesPerShot ?? 1,
					style: "strict_studio",
					generation_mode: input.mode,
					pack_version: input.packVersion
				})
			});

			return await pollUntilDone(input.modelId, started.pack_version);
		} catch (err) {
			setError(err instanceof Error ? err.message : "We couldn't create the Reference Set. Please try again.");
			return "FAILED";
		} finally {
			setGenerating(false);
		}
	}

	return { generating, summary, setSummary, loadSummary, startGeneration };
}
