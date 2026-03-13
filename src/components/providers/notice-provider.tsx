"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type NoticeTone = "success" | "warning" | "error" | "neutral" | "info";

type NoticeInput = {
	title: string;
	description?: string;
	tone?: NoticeTone;
	durationMs?: number;
};

type NoticeRecord = NoticeInput & {
	id: string;
};

type NoticeContextValue = {
	notify: (notice: NoticeInput) => void;
	dismiss: (id: string) => void;
};

const NoticeContext = createContext<NoticeContextValue | null>(null);

function toneClasses(tone: NoticeTone) {
	if (tone === "success") {
		return "border-[var(--status-success-border)] bg-[var(--status-success-bg)] text-[var(--status-success)]";
	}
	if (tone === "warning") {
		return "border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]";
	}
	if (tone === "error") {
		return "border-[color:color-mix(in_oklab,var(--destructive),transparent_70%)] bg-[color:color-mix(in_oklab,var(--destructive),transparent_88%)] text-destructive";
	}
	if (tone === "info") {
		return "border-[color:color-mix(in_oklab,var(--primary),transparent_72%)] bg-[color:color-mix(in_oklab,var(--primary),white_88%)] text-[color:color-mix(in_oklab,var(--primary),black_12%)]";
	}
	return "border-border bg-card text-foreground";
}

export function NoticeProvider({ children }: { children: React.ReactNode }) {
	const [notices, setNotices] = useState<NoticeRecord[]>([]);

	const dismiss = useCallback((id: string) => {
		setNotices(current => current.filter(notice => notice.id !== id));
	}, []);

	const notify = useCallback(
		(notice: NoticeInput) => {
			const id = crypto.randomUUID();
			const next: NoticeRecord = { id, ...notice, tone: notice.tone ?? "neutral" };
			setNotices(current => [next, ...current].slice(0, 4));
			const duration = notice.durationMs ?? 3800;
			setTimeout(() => {
				dismiss(id);
			}, duration);
		},
		[dismiss]
	);

	const value = useMemo(
		() => ({
			notify,
			dismiss
		}),
		[dismiss, notify]
	);

	return (
		<NoticeContext.Provider value={value}>
			{children}
			<div className="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(420px,calc(100%-2rem))] flex-col gap-2">
				{notices.map(notice => (
					<div
						key={notice.id}
						className={cn(
							"pointer-events-auto animate-[notice-enter_0.3s_cubic-bezier(0.22,1,0.36,1)_both] rounded-xl border px-3.5 py-3 shadow-[var(--shadow-lift)]",
							toneClasses(notice.tone ?? "neutral")
						)}>
						<div className="flex items-start justify-between gap-2">
							<div>
								<p className="text-sm font-semibold leading-tight">{notice.title}</p>
								{notice.description ? <p className="mt-1 text-xs leading-relaxed opacity-90">{notice.description}</p> : null}
							</div>
							<button type="button" className="shrink-0 text-xs opacity-60 transition-opacity hover:opacity-100" onClick={() => dismiss(notice.id)} aria-label="Close message">
								✕
							</button>
						</div>
					</div>
				))}
			</div>
		</NoticeContext.Provider>
	);
}

export function useNotice() {
	const context = useContext(NoticeContext);
	if (!context) {
		throw new Error("useNotice must be used within NoticeProvider");
	}

	return context;
}
