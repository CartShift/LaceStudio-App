import type { ReactNode } from "react";
import { CircleAlert, CircleCheckBig, Info, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/cn";

type StateBlockProps = {
	title: string;
	description?: ReactNode;
	tone?: "neutral" | "danger" | "success" | "warning";
	className?: string;
	action?: ReactNode;
};

export function StateBlock({ title, description, tone = "neutral", className, action }: StateBlockProps) {
	const Icon = tone === "danger" ? CircleAlert : tone === "warning" ? TriangleAlert : tone === "success" ? CircleCheckBig : Info;

	return (
		<Alert
			data-slot="state-block"
			role={tone === "danger" ? "alert" : "status"}
			variant={tone === "danger" ? "destructive" : "default"}
			className={cn(
				"relative overflow-hidden rounded-3xl border px-4 py-4 shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_30%),var(--shadow-soft)]",
				tone === "neutral" && "border-border bg-[color:color-mix(in_oklab,var(--accent),transparent_84%)] text-foreground",
				tone === "danger" &&
					"border-[var(--status-danger-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-danger-bg),white_16%),var(--status-danger-bg))] text-[var(--status-danger)]",
				tone === "warning" &&
					"border-[var(--status-warning-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-warning-bg),white_20%),var(--status-warning-bg))] text-[var(--status-warning)]",
				tone === "success" &&
					"border-[var(--status-success-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-success-bg),white_22%),var(--status-success-bg))] text-[var(--status-success)]",
				className
			)}>
			<div
				aria-hidden
				className={cn(
					"pointer-events-none absolute inset-y-0 left-0 w-24 bg-[radial-gradient(circle_at_0%_50%,color-mix(in_oklab,var(--foreground),transparent_92%),transparent_72%)]",
					tone === "danger" && "bg-[radial-gradient(circle_at_0%_50%,color-mix(in_oklab,var(--status-danger),transparent_84%),transparent_70%)]",
					tone === "warning" && "bg-[radial-gradient(circle_at_0%_50%,color-mix(in_oklab,var(--status-warning),transparent_84%),transparent_70%)]",
					tone === "success" && "bg-[radial-gradient(circle_at_0%_50%,color-mix(in_oklab,var(--status-success),transparent_84%),transparent_70%)]"
				)}
			/>
			<Icon
				className={cn(
					"relative mt-0.5",
					tone === "neutral" && "text-primary/80",
					tone === "danger" && "text-[var(--status-danger)]",
					tone === "warning" && "text-[var(--status-warning)]",
					tone === "success" && "text-[var(--status-success)]"
				)}
			/>
			<div className="relative min-w-0">
				<div className="flex items-start justify-between gap-3">
					<AlertTitle className="min-w-0 text-sm font-semibold leading-tight text-current">{title}</AlertTitle>
					{action ? <div className="shrink-0">{action}</div> : null}
				</div>
				{description ? <AlertDescription className="mt-1 text-xs leading-relaxed opacity-90">{typeof description === "string" ? <p>{description}</p> : description}</AlertDescription> : null}
			</div>
		</Alert>
	);
}
