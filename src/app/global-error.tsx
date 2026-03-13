"use client";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
	return (
		<html lang="en">
			<body className="bg-background text-foreground antialiased">
				<div className="relative mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-6 text-center">
					<div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
						<div className="absolute left-1/2 top-1/3 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(220,50,50,0.15),transparent_70%)] blur-3xl" />
					</div>

					<div className="relative space-y-2">
						<p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">App Error</p>
						<h1 className="text-3xl font-bold tracking-tight sm:text-4xl">We couldn&apos;t load the app</h1>
						<p className="mx-auto max-w-sm text-sm leading-relaxed text-muted-foreground">{error.message || "Something went wrong while loading. Reload to continue."}</p>
						{error.digest ? <p className="font-mono text-[10px] text-muted-foreground/80">digest: {error.digest}</p> : null}
					</div>

					<button
						onClick={reset}
						className="relative rounded-xl border border-border/80 bg-card px-5 py-2.5 text-sm font-semibold text-foreground shadow-md transition-all hover:bg-muted hover:border-muted-foreground/40 active:scale-[0.97]"
					>
						Reload App
					</button>
				</div>
			</body>
		</html>
	);
}
