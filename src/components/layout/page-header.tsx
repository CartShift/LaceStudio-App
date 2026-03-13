import { EditorialCard } from "@/components/ui/editorial-card";
import { PageBreadcrumbs } from "@/components/layout/page-breadcrumbs";

function splitDecoratedTitle(title: string) {
	const trimmed = title.trim();
	const match = trimmed.match(/^([^\p{L}\p{N}]+)\s*(.+)$/u);

	if (!match) {
		return { marker: null, text: trimmed };
	}

	return {
		marker: match[1]?.trim() || null,
		text: match[2]?.trim() || trimmed
	};
}

export function PageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
	const { text } = splitDecoratedTitle(title);

	return (
		<EditorialCard className="mb-1 rounded-4xl p-5 md:p-6">
			<div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="min-w-0 max-w-3xl space-y-2">
					<PageBreadcrumbs />
					<h1 className="font-display text-[clamp(2rem,4.6vw,3.25rem)] font-semibold leading-[0.95] tracking-[-0.05em] text-balance">{text}</h1>
					<p className="text-sm leading-relaxed text-muted-foreground md:text-[0.95rem]">{description}</p>
				</div>
				{action ? <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end sm:pt-1 [&_[data-slot='button']]:w-full sm:[&_[data-slot='button']]:w-auto">{action}</div> : null}
			</div>
		</EditorialCard>
	);
}
