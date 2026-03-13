import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/cn";

export function FormShell({
	title,
	description,
	children,
	footer,
	className,
}: {
	title: string;
	description?: string;
	children: React.ReactNode;
	footer?: React.ReactNode;
	className?: string;
}) {
	return (
		<Card variant="elevated" className={cn("overflow-hidden", className)}>
			<CardHeader className="gap-2 border-b border-[color:var(--border-strong)] bg-[linear-gradient(160deg,color-mix(in_oklab,var(--accent),transparent_94%),transparent_54%)] px-5 py-5 md:px-6">
				<CardTitle className="text-[clamp(1.4rem,3vw,1.95rem)] leading-[1.02] tracking-[-0.04em]">{title}</CardTitle>
				{description ? <CardDescription className="max-w-2xl">{description}</CardDescription> : null}
			</CardHeader>
			<CardContent className="px-5 py-4 md:px-6 md:py-5">{children}</CardContent>
			{footer ? (
				<CardFooter className="justify-end border-t border-[color:var(--border-strong)] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent),transparent_90%),color-mix(in_oklab,var(--accent),transparent_82%))] px-5 py-4 md:px-6">
					{footer}
				</CardFooter>
			) : null}
		</Card>
	);
}
