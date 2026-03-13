"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
	Activity,
	AlertTriangle,
	ArrowRight,
	BarChart3,
	Bot,
	CheckCircle2,
	Clock3,
	Megaphone,
	Rocket,
	Send,
	Sparkles,
	type LucideIcon
} from "lucide-react";
import { PageScaffold } from "@/components/layout/page-scaffold";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";
import { Button } from "@/components/ui/button";
import { EditorialCard } from "@/components/ui/editorial-card";
import { StateBlock } from "@/components/ui/state-block";
import { cn } from "@/lib/cn";
import { apiRequest } from "@/lib/client-api";
import type { DashboardSummaryResponse } from "@/types/ui";

const DASHBOARD_SUMMARY_QUERY_KEY = ["dashboard-summary"] as const;

const EMPTY_SUMMARY: DashboardSummaryResponse = {
	active_jobs: 0,
	stale_jobs: 0,
	campaigns_in_review: 0,
	publishing_pending_approval: 0,
	failed_publishing: 0,
	models_total: 0,
	campaigns_total: 0
};

type DashboardTone = "neutral" | "success" | "warning" | "danger";

type HeroHealth = {
	eyebrow: string;
	title: string;
	description: string;
	tone: DashboardTone;
};

type SignalCardModel = {
	label: string;
	value: string;
	description: string;
	tone: DashboardTone;
	icon: LucideIcon;
};

type PriorityAction = {
	eyebrow: string;
	title: string;
	description: string;
	href: string;
	cta: string;
	metric: string;
	tone: DashboardTone;
	icon: LucideIcon;
};

type PipelineLane = {
	label: string;
	value: string;
	description: string;
	href: string;
	tone: DashboardTone;
	icon: LucideIcon;
};

type CommandDeckItem = {
	label: string;
	description: string;
	href: string;
	icon: LucideIcon;
};

type DashboardViewModel = {
	summary: DashboardSummaryResponse;
	health: HeroHealth;
	signals: SignalCardModel[];
	actions: PriorityAction[];
	lanes: PipelineLane[];
	commands: CommandDeckItem[];
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function buildDashboardViewModel(summary: DashboardSummaryResponse): DashboardViewModel {
	const blockers = summary.stale_jobs + summary.failed_publishing;
	const reviewLoad = summary.campaigns_in_review + summary.publishing_pending_approval;

	const health =
		summary.models_total === 0
			? {
					eyebrow: "Studio setup",
					title: "Set the first signature model",
					description:
						"No model profiles are set up yet. Start there so campaigns, approvals, and publishing all have a clear creative base.",
					tone: "warning" as const
				}
			: blockers > 0
				? {
						eyebrow: "Needs attention",
						title: `${pluralize(blockers, "studio issue")} to clear`,
						description:
							"Failed publishing or stalled renders slow the whole flow. Clear them before starting new launches.",
						tone: "danger" as const
					}
				: reviewLoad > 0
					? {
							eyebrow: "Review queue open",
							title: `${pluralize(reviewLoad, "decision")} waiting`,
							description:
								"Creative review and approvals are now setting the pace. A quick pass here will move the studio forward.",
							tone: "warning" as const
						}
					: summary.active_jobs > 0
						? {
								eyebrow: "Production running",
								title: `${pluralize(summary.active_jobs, "look")} in motion`,
								description:
									"Looks are moving cleanly and the approval queue is calm. This is a good time to line up the next campaign.",
								tone: "success" as const
							}
						: {
								eyebrow: "Calm studio",
								title: "Ready for the next launch",
								description:
									"No blockers, no review pile-up, and no live renders competing for attention.",
								tone: "neutral" as const
							};

	const signals: SignalCardModel[] = [
		{
			label: "Blockers",
			value: blockers === 0 ? "Clear" : String(blockers),
			description:
				blockers === 0 ? "No failed publishing or stalled renders." : `${pluralize(blockers, "issue")} need attention.`,
			tone: blockers === 0 ? "success" : "danger",
			icon: AlertTriangle
		},
		{
			label: "Review load",
			value: reviewLoad === 0 ? "Light" : String(reviewLoad),
			description:
				reviewLoad === 0 ? "Nothing is waiting for review." : `${pluralize(reviewLoad, "item")} waiting for review or approval.`,
			tone: reviewLoad === 0 ? "success" : "warning",
			icon: Clock3
		},
		{
			label: "Looks in motion",
			value: summary.active_jobs === 0 ? "Idle" : String(summary.active_jobs),
			description:
				summary.active_jobs === 0 ? "No looks are rendering right now." : `${pluralize(summary.active_jobs, "look")} moving through production.`,
			tone: summary.active_jobs > 0 ? "success" : "neutral",
			icon: Sparkles
		},
		{
			label: "Campaign lineup",
			value: String(summary.campaigns_total),
			description:
				summary.campaigns_total === 0 ? "No campaigns are in the lineup yet." : `${pluralize(summary.campaigns_total, "campaign")} in the studio lineup.`,
			tone: summary.campaigns_total === 0 ? "warning" : "neutral",
			icon: Megaphone
		}
	];

	const actions: PriorityAction[] = [];

	if (summary.models_total === 0) {
		actions.push({
			eyebrow: "Foundation",
			title: "Create the first signature model",
			description: "Define the look, voice, and guardrails before campaign work starts moving through review and publishing.",
			href: "/models/new",
			cta: "Open model setup",
			metric: "Required to launch",
			tone: "warning",
			icon: Bot
		});
	}

	if (summary.failed_publishing > 0) {
		actions.push({
			eyebrow: "Delivery",
			title: "Fix failed publishing",
			description: "Clear failed or rejected posts so launches stay polished and on schedule.",
			href: "/publish",
			cta: "Open publish queue",
			metric: `${summary.failed_publishing} failed`,
			tone: "danger",
			icon: Send
		});
	}

	if (summary.stale_jobs > 0) {
		actions.push({
			eyebrow: "Production",
			title: "Check stalled looks",
			description: "Stalled renders usually point to broken inputs or orphaned work. Review them before new looks stack up.",
			href: "/dashboard",
			cta: "Review stalled work",
			metric: `${summary.stale_jobs} stale`,
			tone: "danger",
			icon: Activity
		});
	}

	if (summary.campaigns_in_review > 0) {
		actions.push({
			eyebrow: "Creative review",
			title: "Review campaign selects",
			description: "Campaigns are waiting on feedback. A tight review pass keeps the studio moving.",
			href: "/campaigns",
			cta: "Open review queue",
			metric: `${summary.campaigns_in_review} in review`,
			tone: "warning",
			icon: Megaphone
		});
	}

	if (summary.publishing_pending_approval > 0) {
		actions.push({
			eyebrow: "Approvals",
			title: "Approve scheduled posts",
			description: "Posts are queued but not cleared. A quick approval pass unlocks publishing without creating extra work.",
			href: "/publish/approvals",
			cta: "Review approvals",
			metric: `${summary.publishing_pending_approval} waiting`,
			tone: "warning",
			icon: CheckCircle2
		});
	}

	actions.push({
		eyebrow: "Momentum",
		title: "Launch the next campaign",
		description: "Start the next campaign with a sharper brief and a cleaner path to review and publishing.",
		href: "/campaigns/new",
		cta: "Start campaign",
		metric: summary.campaigns_total > 0 ? `${summary.campaigns_total} in lineup` : "Fresh launch",
		tone: "success",
		icon: Rocket
	});

	const lanes: PipelineLane[] = [
		{
			label: "Model lineup",
			value: String(summary.models_total),
			description:
				summary.models_total === 0 ? "Build the first signature model before scaling production." : "Signature models ready to power campaigns.",
			href: "/models",
			tone: summary.models_total === 0 ? "warning" : "success",
			icon: Bot
		},
		{
			label: "Creative review",
			value: String(summary.campaigns_in_review),
			description:
				summary.campaigns_in_review === 0 ? "No campaign selects are waiting for review." : "Creative is waiting for feedback before release.",
			href: "/campaigns",
			tone: summary.campaigns_in_review > 0 ? "warning" : "neutral",
			icon: Megaphone
		},
		{
			label: "Publishing approvals",
			value: String(summary.publishing_pending_approval),
			description:
				summary.publishing_pending_approval === 0 ? "Publishing is clear for delivery." : "Approvals are the current hold-up.",
			href: "/publish/approvals",
			tone: summary.publishing_pending_approval > 0 ? "warning" : "neutral",
			icon: Send
		},
		{
			label: "Render watch",
			value: summary.stale_jobs > 0 ? `${summary.stale_jobs} stale` : summary.active_jobs > 0 ? `${summary.active_jobs} live` : "Idle",
			description:
				summary.stale_jobs > 0
					? "Some looks have stalled and need attention."
					: summary.active_jobs > 0
						? "Looks are moving through production cleanly."
						: "No renders are running right now.",
			href: "/dashboard",
			tone: summary.stale_jobs > 0 ? "danger" : summary.active_jobs > 0 ? "success" : "neutral",
			icon: Activity
		}
	];

	const commands: CommandDeckItem[] = [
		{
			label: "New model",
			description: "Create a signature model with a clear look and guardrails.",
			href: "/models/new",
			icon: Bot
		},
		{
			label: "New campaign",
			description: "Start a campaign brief with a cleaner creative direction.",
			href: "/campaigns/new",
			icon: Rocket
		},
		{
			label: "Review approvals",
			description: "Clear scheduled posts before the queue gets heavy.",
			href: "/publish/approvals",
			icon: CheckCircle2
		},
		{
			label: "Open analytics",
			description: "See what content is landing and what needs a sharper edit.",
			href: "/analytics",
			icon: BarChart3
		}
	];

	return {
		summary,
		health: health,
		signals,
		actions: actions.slice(0, 4),
		lanes,
		commands
	};
}

const EMPTY_VIEW_MODEL = buildDashboardViewModel(EMPTY_SUMMARY);

function toneSurfaceClass(tone: DashboardTone) {
	if (tone === "danger") {
		return "border-[color:color-mix(in_oklab,var(--destructive),transparent_72%)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--destructive),transparent_92%),color-mix(in_oklab,var(--card),transparent_2%))]";
	}

	if (tone === "warning") {
		return "border-[color:color-mix(in_oklab,var(--status-warning),transparent_72%)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-warning-bg),white_18%),color-mix(in_oklab,var(--card),transparent_2%))]";
	}

	if (tone === "success") {
		return "border-[color:color-mix(in_oklab,var(--status-success),transparent_72%)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--status-success-bg),white_18%),color-mix(in_oklab,var(--card),transparent_2%))]";
	}

	return "border-border/65 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_12%),color-mix(in_oklab,var(--card),transparent_2%))]";
}

function toneIconClass(tone: DashboardTone) {
	if (tone === "danger") {
		return "border-[color:color-mix(in_oklab,var(--destructive),transparent_74%)] bg-[color:color-mix(in_oklab,var(--destructive),transparent_88%)] text-destructive";
	}

	if (tone === "warning") {
		return "border-[color:color-mix(in_oklab,var(--status-warning),transparent_74%)] bg-[color:color-mix(in_oklab,var(--status-warning-bg),white_18%)] text-[var(--status-warning)]";
	}

	if (tone === "success") {
		return "border-[color:color-mix(in_oklab,var(--status-success),transparent_74%)] bg-[color:color-mix(in_oklab,var(--status-success-bg),white_18%)] text-[var(--status-success)]";
	}

	return "border-border/60 bg-background/50 text-primary";
}

function SignalCard({ signal }: { signal: SignalCardModel }) {
	const Icon = signal.icon;

	return (
		<div className={cn("ds-signal-card rounded-[1.35rem] p-4", toneSurfaceClass(signal.tone))}>
			<div className="relative flex items-start justify-between gap-3">
				<div>
					<p className="ds-kicker">{signal.label}</p>
					<p className="ds-stat-value mt-2 text-[1.9rem]">{signal.value}</p>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{signal.description}</p>
				</div>
				<span className={cn("rounded-full border p-2.5", toneIconClass(signal.tone))}>
					<Icon className="h-4 w-4" />
				</span>
			</div>
		</div>
	);
}

function ActionCard({ action }: { action: PriorityAction }) {
	const Icon = action.icon;

	return (
		<Link
			href={action.href}
			className={cn(
				"ds-signal-card group block rounded-[1.5rem] p-5 transition-transform duration-200 hover:-translate-y-1",
				toneSurfaceClass(action.tone)
			)}>
			<div className="relative">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="ds-kicker">{action.eyebrow}</p>
						<h3 className="mt-2 font-display text-[1.55rem] font-semibold leading-[1.02] tracking-[-0.04em] text-balance">
							{action.title}
						</h3>
					</div>
					<span className={cn("rounded-full border p-2.5", toneIconClass(action.tone))}>
						<Icon className="h-4 w-4" />
					</span>
				</div>

				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">{action.description}</p>

				<div className="mt-5 flex items-center justify-between gap-3">
					<span className="ds-pill px-3 py-1 text-xs font-semibold text-muted-foreground">{action.metric}</span>
					<span className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
						{action.cta}
						<ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
					</span>
				</div>
			</div>
		</Link>
	);
}

function PipelineCard({ lane }: { lane: PipelineLane }) {
	const Icon = lane.icon;

	return (
		<Link
			href={lane.href}
			className={cn(
				"ds-signal-card group block rounded-[1.4rem] p-4 transition-transform duration-200 hover:-translate-y-0.5",
				toneSurfaceClass(lane.tone)
			)}>
			<div className="relative">
				<div className="flex items-start justify-between gap-3">
					<div>
						<p className="ds-kicker">{lane.label}</p>
						<p className="ds-stat-value mt-2 text-[1.6rem]">{lane.value}</p>
					</div>
					<span className={cn("rounded-full border p-2.5", toneIconClass(lane.tone))}>
						<Icon className="h-4 w-4" />
					</span>
				</div>
				<p className="mt-3 text-sm leading-relaxed text-muted-foreground">{lane.description}</p>
			</div>
		</Link>
	);
}

export default function DashboardPage() {
	const { data, isLoading, error } = useQuery({
		queryKey: DASHBOARD_SUMMARY_QUERY_KEY,
		queryFn: () => apiRequest<DashboardSummaryResponse>("/api/dashboard/summary"),
		select: buildDashboardViewModel
	});

	const view = data ?? EMPTY_VIEW_MODEL;
	const primaryAction = view.actions[0] ?? {
		href: "/campaigns/new",
		cta: "Start campaign"
	};

	return (
		<PageScaffold className="space-y-6">
			{error instanceof Error ? <StateBlock tone="error" title="Dashboard metrics failed to load" description={error.message} /> : null}

			<section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_380px]">
				<EditorialCard className="rounded-[1.9rem] p-5 md:p-6">
					<div className="space-y-5">
						<div className="space-y-2">
							<PageBreadcrumbs />
							<p className="ds-kicker">{view.health.eyebrow}</p>
							<h2 className="font-display text-[clamp(2.15rem,4.8vw,3.75rem)] font-bold leading-[0.93] tracking-[-0.06em] text-balance">
								{view.health.title}
							</h2>
							<p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">{view.health.description}</p>
						</div>

						<div className="grid gap-3 sm:grid-cols-3">
							<div className="ds-signal-card rounded-[1.15rem] p-3.5">
								<p className="ds-kicker">Models</p>
								<p className="ds-stat-value mt-2 text-[1.45rem]">{isLoading ? "..." : String(view.summary.models_total)}</p>
							</div>
							<div className="ds-signal-card rounded-[1.15rem] p-3.5">
								<p className="ds-kicker">Campaigns</p>
								<p className="ds-stat-value mt-2 text-[1.45rem]">{isLoading ? "..." : String(view.summary.campaigns_total)}</p>
							</div>
							<div className="ds-signal-card rounded-[1.15rem] p-3.5">
								<p className="ds-kicker">Approvals</p>
								<p className="ds-stat-value mt-2 text-[1.45rem]">{isLoading ? "..." : String(view.summary.publishing_pending_approval)}</p>
							</div>
						</div>

						<div className="flex flex-wrap gap-3">
							<Button asChild size="lg">
								<Link href={primaryAction.href}>{primaryAction.cta}</Link>
							</Button>
							<Button asChild variant="secondary" size="lg">
								<Link href="/analytics">Open analytics</Link>
							</Button>
						</div>
					</div>
				</EditorialCard>

				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
					{view.signals.map(signal => (
						<SignalCard key={signal.label} signal={signal} />
					))}
				</div>
			</section>

			<section className="grid gap-4 2xl:grid-cols-[minmax(0,1.35fr)_360px]">
				<div className="space-y-3">
					<div className="space-y-1">
						<h2 className="font-display text-[1.95rem] font-semibold tracking-[-0.04em]">Next actions</h2>
						<p className="text-sm text-muted-foreground">{isLoading ? "Refreshing the live studio view." : "Start with the work that removes the most friction."}</p>
					</div>

					<div className="grid gap-4 md:grid-cols-2">
						{view.actions.map(action => (
							<ActionCard key={`${action.href}-${action.title}`} action={action} />
						))}
					</div>
				</div>

				<EditorialCard className="rounded-[1.7rem] p-5">
					<div>
						<h2 className="font-display text-[1.9rem] font-semibold tracking-[-0.04em]">Shortcuts</h2>
						<p className="mt-2 text-sm leading-relaxed text-muted-foreground">Common actions you may want next.</p>
					</div>

					<div className="mt-4 space-y-3">
						{view.commands.map(command => {
							const Icon = command.icon;

							return (
								<Link
									key={command.href}
									href={command.href}
									className="group flex items-center gap-3 rounded-[1.15rem] border border-border/55 bg-background/35 px-3.5 py-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-[color:color-mix(in_oklab,var(--primary),transparent_76%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_74%)]">
									<span className="rounded-full border border-border/60 bg-background/60 p-2.5 text-primary">
										<Icon className="h-4 w-4" />
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-sm font-semibold text-foreground">{command.label}</p>
										<p className="text-xs leading-relaxed text-muted-foreground">{command.description}</p>
									</div>
									<ArrowRight className="h-4 w-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-1 group-hover:text-foreground" />
								</Link>
							);
						})}
					</div>
				</EditorialCard>
			</section>

			<section className="space-y-3">
				<div className="space-y-1">
					<h2 className="font-display text-[1.95rem] font-semibold tracking-[-0.04em]">Pipeline</h2>
					<p className="max-w-xl text-sm leading-relaxed text-muted-foreground">A quick read on setup, review, approvals, and renders.</p>
				</div>

				<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
					{view.lanes.map(lane => (
						<PipelineCard key={lane.label} lane={lane} />
					))}
				</div>
			</section>
		</PageScaffold>
	);
}
