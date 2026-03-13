import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
	return (
		<div className="relative mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
			{/* Decorative glow */}
			<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--primary),transparent_60%),transparent_70%)] blur-3xl" />
			</div>

			<div className="relative space-y-2">
				<p className="font-subheader text-[11px] tracking-widest text-muted-foreground">Page Not Found</p>
				<h1 className="font-display text-[clamp(3rem,8vw,5rem)] font-bold leading-none tracking-tight text-balance">404</h1>
				<p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">
					We can&apos;t find that page. It may have moved, or the link may be incorrect.
				</p>
			</div>

			<div className="relative flex gap-3">
				<Button asChild>
					<Link href="/dashboard">Go to Dashboard</Link>
				</Button>
				<Button asChild variant="outline">
					<Link href="/models">View Models</Link>
				</Button>
			</div>
		</div>
	);
}
