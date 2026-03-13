"use client";

import { useEffect, type CSSProperties } from "react";
import { cn } from "@/lib/cn";

export function StepCelebration({ message, emoji = "🎉", show, onDone, duration = 1800 }: { message: string; emoji?: string; show: boolean; onDone?: () => void; duration?: number }) {
	const particles = Array.from({ length: 12 }).map((_, index) => {
		const left = 20 + ((index * 37) % 60);
		const top = 20 + ((index * 53) % 60);
		const hue = 30 + ((index * 29) % 60);
		const durationSeconds = 0.6 + (index % 5) * 0.15;
		const delaySeconds = (index % 4) * 0.08;
		const driftX = `${index % 2 === 0 ? "" : "-"}${20 + ((index * 11) % 40)}px`;
		return { key: index, left, top, hue, durationSeconds, delaySeconds, driftX };
	});

	useEffect(() => {
		if (!show) return undefined;
		const hideTimer = setTimeout(() => onDone?.(), duration);

		return () => {
			clearTimeout(hideTimer);
		};
	}, [show, duration, onDone]);

	if (!show) return null;

	return (
		<div className={cn("pointer-events-none fixed inset-0 z-[60] flex items-center justify-center animate-in fade-in-0 duration-300")}>
			{/* Sparkle particles */}
			<div className="absolute inset-0 overflow-hidden">
				{particles.map(particle => (
					<div
						key={particle.key}
						className="absolute h-1.5 w-1.5 rounded-full"
						style={
							{
								left: `${particle.left}%`,
								top: `${particle.top}%`,
								background: `hsl(${particle.hue}, 90%, 65%)`,
								animation: `celebration-particle ${particle.durationSeconds}s ease-out forwards`,
								animationDelay: `${particle.delaySeconds}s`,
								"--celebration-drift-x": particle.driftX
							} as CSSProperties
						}
					/>
				))}
			</div>

			{/* Message card */}
			<div
				className={cn(
					"flex flex-col items-center gap-2 rounded-2xl border border-[var(--status-success-border)] bg-[color:color-mix(in_oklab,var(--status-success-bg),black_40%)] px-8 py-5 shadow-[0_0_40px_rgba(34,197,94,0.2)] backdrop-blur-md",
					"animate-in zoom-in-90 duration-300"
				)}>
				<span className="text-4xl">{emoji}</span>
				<p className="text-sm font-semibold text-[var(--status-success)]">{message}</p>
			</div>

			{/* CSS animation keyframe injected inline */}
			<style>{`
        @keyframes celebration-particle {
          0% { transform: scale(0) translateY(0); opacity: 1; }
          50% { opacity: 1; }
          100% { transform: scale(1.5) translateY(-60px) translateX(var(--celebration-drift-x, 24px)); opacity: 0; }
        }
      `}</style>
		</div>
	);
}
