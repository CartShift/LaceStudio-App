import { createHash, randomUUID } from "node:crypto";
import { clamp } from "@/lib/utils";
import type { CreativeControls } from "@/server/schemas/creative";
import { creativeControlsSchema, referenceBoardSchema } from "@/server/schemas/creative";

type ReferenceWeight = "primary" | "secondary";
type DeepPartial<T> = {
	[K in keyof T]?: T[K] extends Array<infer U> ? Array<DeepPartial<U>> : T[K] extends Record<string, unknown> ? DeepPartial<T[K]> : T[K];
};

export function createDefaultCreativeControls(): CreativeControls {
	return creativeControlsSchema.parse({});
}

export function mergeCreativeControls(base: CreativeControls | null | undefined, patch: DeepPartial<CreativeControls> | null | undefined): CreativeControls {
	const baseControls = base ? creativeControlsSchema.parse(base) : createDefaultCreativeControls();
	if (!patch) return baseControls;

	const merged = deepMerge(baseControls, patch as Partial<Record<keyof CreativeControls, unknown>>);
	return creativeControlsSchema.parse(merged);
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<Record<keyof T, unknown>>): T {
	const output: Record<string, unknown> = { ...base };

	for (const [key, value] of Object.entries(patch)) {
		const current = output[key];

		if (Array.isArray(value)) {
			output[key] = [...value];
			continue;
		}

		if (value && typeof value === "object" && current && typeof current === "object" && !Array.isArray(current)) {
			output[key] = deepMerge(current as Record<string, unknown>, value as Record<string, unknown>);
			continue;
		}

		output[key] = value;
	}

	return output as T;
}

export function enrichReferenceBoard(controls: CreativeControls, options?: { label?: string; versionOverride?: number }): CreativeControls {
	const now = new Date().toISOString();
	const board = referenceBoardSchema.parse(controls.reference_board);
	const activeVersion = options?.versionOverride ?? board.active_version + (board.items.length > 0 ? 1 : 0);

	const items = board.items.map(item => {
		const embedding = item.embedding && item.embedding.length > 0 ? item.embedding : deriveEmbedding(item.url);
		return {
			...item,
			id: item.id ?? randomUUID(),
			created_at: item.created_at ?? now,
			version: activeVersion,
			embedding
		};
	});

	const primary = items.find(item => item.weight === "primary");
	const primaryEmbedding = primary?.embedding;
	const withSimilarity = items.map(item => ({
		...item,
		similarity_score: primaryEmbedding && item.embedding ? cosineSimilarity(primaryEmbedding, item.embedding) : (item.similarity_score ?? (item.weight === "primary" ? 1 : 0.5))
	}));

	const historyEntry = {
		version: activeVersion,
		label: options?.label ?? `Reference Update v${activeVersion}`,
		created_at: now,
		reference_ids: withSimilarity.flatMap(item => (item.id ? [item.id] : []))
	};

	return {
		...controls,
		reference_board: {
			...board,
			active_version: activeVersion,
			items: withSimilarity,
			history: [historyEntry, ...board.history]
		}
	};
}

export function buildCreativePromptFragments(controls: CreativeControls): string[] {
	const outfit = controls.outfit;
	const pose = controls.pose;
	const expression = controls.expression;
	const realism = controls.realism;
	const aesthetic = controls.aesthetic;
	const identity = controls.identity;
	const reference = controls.reference_board;

	const fragments: string[] = [];

	// Outfit — descriptive sentence instead of terse list
	const outfitParts = [outfit.silhouette, outfit.fabric, outfit.color, outfit.fit, outfit.texture].filter(Boolean);
	fragments.push(`Wearing a ${outfitParts.join(", ")} outfit`);
	if (outfit.accessories.length > 0) {
		fragments.push(`accessorized with ${outfit.accessories.join(", ")}`);
	}
	if (outfit.movement_preset !== "still") {
		fragments.push(`fabric reacting naturally to ${outfit.movement_preset} movement`);
	}

	// Pose — only add micro-rotation when it deviates from neutral
	fragments.push(`${pose.preset} pose`);
	const hasNonTrivialRotation = Math.abs(pose.micro_rotation.shoulder_angle) > 0.05 || Math.abs(pose.micro_rotation.hip_shift) > 0.05 || Math.abs(pose.micro_rotation.chin_tilt) > 0.05;
	if (hasNonTrivialRotation) {
		const parts: string[] = [];
		if (Math.abs(pose.micro_rotation.shoulder_angle) > 0.05)
			parts.push(`shoulders ${pose.micro_rotation.shoulder_angle > 0 ? "tilted right" : "tilted left"} ${Math.abs(pose.micro_rotation.shoulder_angle * 100).toFixed(0)}%`);
		if (Math.abs(pose.micro_rotation.hip_shift) > 0.05) parts.push(`hips shifted ${pose.micro_rotation.hip_shift > 0 ? "right" : "left"} ${Math.abs(pose.micro_rotation.hip_shift * 100).toFixed(0)}%`);
		if (Math.abs(pose.micro_rotation.chin_tilt) > 0.05) parts.push(`chin ${pose.micro_rotation.chin_tilt > 0 ? "raised" : "lowered"} ${Math.abs(pose.micro_rotation.chin_tilt * 100).toFixed(0)}%`);
		fragments.push(`subtle body language: ${parts.join(", ")}`);
	}

	// Expression — natural language
	if (expression.preset !== "neutral" || expression.smile_intensity > 0.25) {
		const parts: string[] = [];
		if (expression.preset !== "neutral") parts.push(`${expression.preset} expression`);
		if (expression.smile_intensity > 0.25) parts.push(`${(expression.smile_intensity * 100).toFixed(0)}% smile`);
		if (expression.eye_focus !== "direct_gaze") parts.push(`eyes looking ${expression.eye_focus.replace(/_/g, " ")}`);
		fragments.push(parts.join(", "));
	}

	// Lens & realism — photography-aware description
	const lensName = realism.lens_simulation.replace(/_/g, " ");
	fragments.push(`shot on ${lensName} with ${(realism.depth_of_field * 100).toFixed(0)}% depth of field`);
	if (realism.skin_texture_realism > 0.7) {
		fragments.push(`hyper-realistic skin rendering at ${(realism.skin_texture_realism * 100).toFixed(0)}% fidelity`);
	}
	if (realism.pore_detail > 0.7) {
		fragments.push("visible pore-level skin detail");
	}
	if (realism.fabric_physics_realism > 0.7) {
		fragments.push("physically accurate fabric draping and folds");
	}

	// Identity consistency cues
	if (identity.face_embedding_lock) {
		fragments.push("strict identity lock — preserve exact facial geometry across all generations");
	}
	if (identity.skin_texture_mapping) {
		fragments.push("consistent skin texture mapping");
	}
	if (identity.imperfection_persistence) {
		fragments.push("preserve natural skin imperfections (moles, freckles, fine lines)");
	}

	// Aesthetic mood
	if (aesthetic.mood_tags.length > 0) {
		fragments.push(`mood: ${aesthetic.mood_tags.join(", ")}`);
	}
	if (aesthetic.lighting_profile_name) {
		fragments.push(`lighting: ${aesthetic.lighting_profile_name}`);
	}

	// Reference mentions
	const primaryReferences = reference.items
		.filter(item => item.weight === "primary")
		.map(item => item.title ?? item.url)
		.slice(0, 3);
	const secondaryCount = reference.items.filter(item => item.weight === "secondary").length;

	if (primaryReferences.length > 0) {
		fragments.push(`primary reference: ${primaryReferences.join(" | ")}${secondaryCount > 0 ? `, plus ${secondaryCount} secondary references` : ""}`);
	}

	return fragments;
}

export function estimateIdentityDriftScore(controls: CreativeControls): number {
	let score = 0.35;
	if (controls.identity.face_embedding_lock) score -= 0.09;
	if (controls.identity.body_ratio_enforcement) score -= 0.08;
	if (controls.identity.imperfection_persistence) score -= 0.05;
	score += Math.max(0, 0.2 - controls.realism.skin_texture_realism) * 0.4;
	score += Math.max(0, 0.15 - controls.expression.smile_intensity) * 0.15;
	return clamp(score, 0.01, 0.99, { precision: 4 });
}

export function shouldAlertIdentityDrift(controls: CreativeControls, score: number): { alert: boolean; threshold: number } {
	const threshold = controls.identity.drift_alert_threshold;
	return {
		alert: score >= threshold,
		threshold
	};
}

export function detectArtifactRisk(controls: CreativeControls): number {
	let risk = 0.18;
	risk += Math.max(0, 0.5 - controls.realism.shadow_accuracy) * 0.35;
	risk += Math.max(0, 0.5 - controls.realism.fabric_physics_realism) * 0.25;
	risk += Math.max(0, 0.45 - controls.realism.noise_consistency) * 0.25;
	if (!controls.realism.artifact_detection) risk += 0.2;
	return clamp(risk, 0.01, 0.99, { precision: 4 });
}

export function summarizeReferenceWeights(controls: CreativeControls): { primary: number; secondary: number; dominant: ReferenceWeight | "none" } {
	const primary = controls.reference_board.items.filter(item => item.weight === "primary").length;
	const secondary = controls.reference_board.items.filter(item => item.weight === "secondary").length;

	if (primary === 0 && secondary === 0) {
		return { primary, secondary, dominant: "none" };
	}

	return {
		primary,
		secondary,
		dominant: primary >= secondary ? "primary" : "secondary"
	};
}

function deriveEmbedding(input: string, dimensions = 16): number[] {
	const hash = createHash("sha256").update(input).digest();
	const output: number[] = [];

	for (let i = 0; i < dimensions; i += 1) {
		const value = (hash[i % hash.length] ?? 0) / 255;
		output.push(Number((value * 2 - 1).toFixed(6)));
	}

	return output;
}

function cosineSimilarity(a: number[], b: number[]): number {
	const len = Math.min(a.length, b.length);
	if (len === 0) return 0;

	let dot = 0;
	let magA = 0;
	let magB = 0;

	for (let i = 0; i < len; i += 1) {
		const valueA = a[i] ?? 0;
		const valueB = b[i] ?? 0;
		dot += valueA * valueB;
		magA += valueA * valueA;
		magB += valueB * valueB;
	}

	if (magA === 0 || magB === 0) return 0;
	return clamp(dot / Math.sqrt(magA * magB), 0, 1, { precision: 4 });
}
