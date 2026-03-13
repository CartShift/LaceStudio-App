import { Badge } from "@/components/ui/badge";
import { EditorialCard } from "@/components/ui/editorial-card";
import { cn } from "@/lib/cn";

function toneTextClass(tone: "neutral" | "success" | "warning" | "danger") {
	if (tone === "success") {
		return "text-[var(--status-success)]";
	}

	if (tone === "warning") {
		return "text-[var(--status-warning)]";
	}

	if (tone === "danger") {
		return "text-[var(--status-danger)]";
	}

	return "text-muted-foreground";
}

function toneDotClass(tone: "neutral" | "success" | "warning" | "danger") {
	if (tone === "success") {
		return "bg-[var(--status-success)]";
	}

	if (tone === "warning") {
		return "bg-[var(--status-warning)]";
	}

	if (tone === "danger") {
		return "bg-[var(--status-danger)]";
	}

	return "bg-primary";
}

export function StatCard({ label, value, tone = "neutral" }: { label: string; value: string | number; tone?: "neutral" | "success" | "warning" | "danger" }) {
	return (
		<EditorialCard className="rounded-3xl p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-3">
					<Badge tone={tone}>{label}</Badge>
					<p className="font-display text-[clamp(1.75rem,3.4vw,2.45rem)] font-bold leading-[0.92] tracking-[-0.05em] tabular-nums">{value}</p>
				</div>
				<span className={cn("inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em]", toneTextClass(tone))}>
					<span className={cn("h-1.5 w-1.5 rounded-full", toneDotClass(tone))} />
					{tone === "neutral" ? "Stable" : tone}
				</span>
			</div>
		</EditorialCard>
	);
}
