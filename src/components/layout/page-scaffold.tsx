import { cn } from "@/lib/cn";

export function PageScaffold({ children, className }: { children: React.ReactNode; className?: string }) {
	return (
		<section className="relative min-w-0 animate-[page-enter_0.4s_cubic-bezier(0.22,1,0.36,1)_both] before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--foreground),transparent_88%),transparent)] before:content-['']">
			<div
				aria-hidden
				className="pointer-events-none absolute inset-x-0 top-6 -z-10 h-28 bg-[radial-gradient(circle_at_15%_0%,color-mix(in_oklab,var(--primary),transparent_92%),transparent_68%),radial-gradient(circle_at_85%_20%,color-mix(in_oklab,var(--accent),transparent_84%),transparent_62%)]"
			/>
			<div className={cn("relative min-w-0 space-y-5 pt-1 md:space-y-6", className)}>{children}</div>
		</section>
	);
}
