import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";

export type TableShellColumn<T> = {
	key: string;
	header: React.ReactNode;
	className?: string;
	cell: (row: T) => React.ReactNode;
};

function titleFromHeader(header: React.ReactNode, fallback: string) {
	if (typeof header === "string" || typeof header === "number") {
		return String(header);
	}

	return fallback
		.split("_")
		.map(part => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function TableShell<T>({
	title,
	description,
	rows,
	columns,
	rowKey,
	emptyMessage = "No results.",
	actions,
	className
}: {
	title: string;
	description?: string;
	rows: T[];
	columns: TableShellColumn<T>[];
	rowKey: (row: T) => string;
	emptyMessage?: string;
	actions?: React.ReactNode;
	className?: string;
}) {
	const keyedRows = rows.map(row => ({
		id: rowKey(row),
		row
	}));

	return (
		<Card variant="elevated" className={cn("overflow-hidden", className)}>
			<CardHeader className="gap-4 border-b border-[color:var(--border-strong)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--accent),transparent_94%),transparent_54%)] px-5 py-5 md:px-6">
				<div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
					<div className="space-y-2">
						<CardTitle className="text-[clamp(1.35rem,2.8vw,1.9rem)] leading-[1.02] tracking-[-0.04em]">{title}</CardTitle>
						{description ? <CardDescription className="max-w-2xl">{description}</CardDescription> : null}
					</div>
					{actions ? <div className="flex flex-wrap items-center gap-3">{actions}</div> : null}
				</div>
			</CardHeader>
			<CardContent className="p-4 md:hidden">
				{keyedRows.length ? (
					<div className="space-y-3">
						{keyedRows.map(({ id, row }) => (
							<article
								key={id}
								className="rounded-2xl border border-border/55 bg-[linear-gradient(160deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--card),transparent_0%))] p-4 shadow-[var(--shadow-inner)]">
								<div className="space-y-3">
									{columns.map((column, index) => (
										<div key={`${id}-${column.key}`} className={cn("space-y-1.5", index > 0 && "border-t border-border/45 pt-3")}>
											<p className="font-subheader text-[10px] text-muted-foreground">{titleFromHeader(column.header, column.key)}</p>
											<div
												className={cn(
													"break-words text-sm leading-relaxed text-foreground",
													column.key === "actions" && "flex flex-wrap gap-2 [&_[data-slot='button']]:w-full [&_[data-slot='button']]:justify-center"
												)}>
												{column.cell(row)}
											</div>
										</div>
									))}
								</div>
							</article>
						))}
					</div>
				) : (
					<div className="rounded-2xl border border-dashed border-border/60 bg-background/30 px-4 py-10 text-center">
						<div className="mx-auto max-w-sm">
							<p className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">No results</p>
							<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{emptyMessage}</p>
						</div>
					</div>
				)}
			</CardContent>
			<CardContent className="hidden p-0 md:block">
				<Table>
					<TableHeader>
						<TableRow>
							{columns.map(column => (
								<TableHead key={column.key} className={column.className}>
									{column.header}
								</TableHead>
							))}
						</TableRow>
					</TableHeader>
					<TableBody>
						{keyedRows.length ? (
							keyedRows.map(({ id, row }) => (
								<TableRow key={id}>
									{columns.map(column => (
										<TableCell key={`${id}-${column.key}`} className={column.className}>
											{column.cell(row)}
										</TableCell>
									))}
								</TableRow>
							))
						) : (
							<TableRow>
								<TableCell colSpan={columns.length} className="px-6 py-12 text-center">
									<div className="mx-auto max-w-sm">
										<p className="font-display text-lg font-semibold tracking-[-0.03em] text-foreground">No results</p>
										<p className="mt-2 text-sm leading-relaxed text-muted-foreground">{emptyMessage}</p>
									</div>
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}
