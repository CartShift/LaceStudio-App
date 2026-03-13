import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";

export function FilterShell({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<Card variant="glass" className="overflow-hidden border-border/70 shadow-[var(--shadow-soft)]">
			<CardContent className={cn("px-5 py-4 md:px-6", className)}>{children}</CardContent>
		</Card>
	);
}
