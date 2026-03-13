"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StateBlock } from "@/components/ui/state-block";
import { EditorialCard } from "@/components/ui/editorial-card";
import type { CanonicalPackSummary } from "@/components/models/types";

export function StepReviewFinalize({
	modelStatus,
	canonicalPackStatus,
	summary,
	selectedByShot,
	hasCharacterDesign,
	hasPersonality,
	hasSocialStrategy,
	hasCanonicalPack,
	approving,
	finalizing,
	onApprovePack,
	onFinalize,
	capabilityFlags
}: {
	modelStatus: "DRAFT" | "ACTIVE" | "ARCHIVED";
	canonicalPackStatus: "NOT_STARTED" | "GENERATING" | "READY" | "APPROVED" | "FAILED";
	summary: CanonicalPackSummary | null;
	selectedByShot: Record<string, string>;
	hasCharacterDesign: boolean;
	hasPersonality: boolean;
	hasSocialStrategy: boolean;
	hasCanonicalPack: boolean;
	approving: boolean;
	finalizing: boolean;
	onApprovePack: () => Promise<void>;
	onFinalize: () => Promise<void>;
	capabilityFlags: {
		gpu_available: boolean;
		openai_available: boolean;
		nano_available: boolean;
	};
}) {
	const selectedCount = Object.values(selectedByShot).filter(Boolean).length;
	const canApprove = summary && summary.pack_version > 0 && selectedCount === 8;
	const allStepsDone = hasCharacterDesign && hasPersonality && hasSocialStrategy && hasCanonicalPack;

	return (
		<EditorialCard className="space-y-5">
			<div className="text-center">
				<span className="text-4xl">{allStepsDone ? "🚀" : "📋"}</span>
				<h2 className="mt-2 font-display text-2xl">{allStepsDone ? "Ready to Launch" : "Review Before Launch"}</h2>
				<p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
					{allStepsDone ? "Everything is ready. Finish setup to make this model live." : "Complete the remaining items to unlock launch."}
				</p>
			</div>

			{/* Checklist */}
			<div className="grid gap-2 md:grid-cols-2">
				<CheckItem emoji="🎨" label="Character Design" done={hasCharacterDesign} />
				<CheckItem emoji="🎭" label="Personality" done={hasPersonality} />
				<CheckItem emoji="📊" label="Social Strategy" done={hasSocialStrategy} />
				<CheckItem emoji="📸" label="Identity References" done={hasCanonicalPack} />
			</div>

			{/* Status badges */}
			<div className="flex flex-wrap items-center justify-center gap-2">
				<Badge tone={modelStatus === "ACTIVE" ? "success" : "warning"}>{modelStatus}</Badge>
				<Badge tone={canonicalPackStatus === "APPROVED" ? "success" : "neutral"}>{canonicalPackStatus}</Badge>
				<Badge tone="neutral">{`${selectedCount}/8 looks selected`}</Badge>
			</div>

			{/* Capabilities */}
			<div className="flex flex-wrap items-center justify-center gap-3 text-xs text-muted-foreground">
				<CapBadge label="GPU" available={capabilityFlags.gpu_available} />
				<CapBadge label="OpenAI" available={capabilityFlags.openai_available} />
				<CapBadge label="Nano" available={capabilityFlags.nano_available} />
			</div>

			{!hasCanonicalPack && !canApprove ? (
				<StateBlock tone="neutral" title="References Needed" description="Approve the reference set or keep at least 3 accepted imported references before finishing." />
			) : null}

			{/* Action buttons */}
			<div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
				<Button type="button" variant="secondary" onClick={() => void onApprovePack()} disabled={!canApprove || approving}>
					{approving ? "Approving…" : "Approve Reference Set"}
				</Button>
				<Button
					type="button"
					onClick={() => void onFinalize()}
					disabled={finalizing || !hasCharacterDesign}
					className={allStepsDone ? "shadow-[0_0_20px_rgba(var(--color-primary-rgb,99,102,241),0.3)]" : ""}>
					{finalizing ? "Finishing…" : "Launch Model"}
				</Button>
			</div>
		</EditorialCard>
	);
}

function CheckItem({ emoji, label, done }: { emoji: string; label: string; done: boolean }) {
	return (
		<div
			className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-all duration-300 ${
				done ? "border-[var(--status-success-border)] bg-[color:color-mix(in_oklab,var(--status-success-bg),white_8%)]" : "border-border bg-card"
			}`}>
			<span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${done ? "bg-[var(--status-success)] text-background" : "border border-border bg-muted"}`}>{done ? "✓" : ""}</span>
			<span className="text-sm">
				{emoji} {label}
			</span>
			<Badge tone={done ? "success" : "warning"} className="ml-auto">
				{done ? "Done" : "Pending"}
			</Badge>
		</div>
	);
}

function CapBadge({ label, available }: { label: string; available: boolean }) {
	return (
		<span
			className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 ${available ? "border-[var(--status-success-border)] bg-[color:color-mix(in_oklab,var(--status-success-bg),white_12%)] text-[var(--status-success)]" : "border-border bg-card text-muted-foreground"}`}>
			<span className="text-[10px]">{available ? "●" : "○"}</span>
			{label}
		</span>
	);
}
