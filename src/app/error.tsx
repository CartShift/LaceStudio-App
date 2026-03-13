"use client";

import { Button } from "@/components/ui/button";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<div className="relative mx-auto flex min-h-[60vh] max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
			{/* Decorative glow */}
			<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
				<div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--destructive),transparent_70%),transparent_70%)] blur-3xl" />
			</div>

			<div className="relative space-y-2">
				<p className="font-subheader text-[11px] tracking-widest text-muted-foreground">Page Error</p>
				<h1 className="font-display text-2xl font-bold tracking-tight text-balance sm:text-3xl">This page hit a snag</h1>
				<p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">{error.message || "Something unexpected happened. Your work is still safe, so try again or reload."}</p>
				{error.digest ? <p className="font-mono text-[10px] text-muted-foreground/60">digest: {error.digest}</p> : null}
			</div>

			<div className="relative">
				<Button onClick={reset}>Try Again</Button>
			</div>
		</div>
	);
}
