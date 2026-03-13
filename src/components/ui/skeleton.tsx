import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-[1rem] border border-[color:color-mix(in_oklab,var(--foreground),transparent_93%)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--accent),transparent_82%),color-mix(in_oklab,var(--card),transparent_20%))]",
        "before:absolute before:inset-0 before:animate-[skeleton-shimmer_1.4s_ease-in-out_infinite] before:bg-[linear-gradient(110deg,transparent_18%,color-mix(in_oklab,var(--card),transparent_18%)_46%,transparent_76%)] before:content-['']",
        className,
      )}
    />
  );
}
