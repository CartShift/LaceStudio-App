import { cn } from "@/lib/cn";

type StripTone = "neutral" | "success" | "warning" | "danger";

export type ContextStripItem = {
  label: string;
  value: React.ReactNode;
  description?: string;
  tone?: StripTone;
};

function dotClassForTone(tone: StripTone) {
  if (tone === "success") return "bg-[var(--status-success)]";
  if (tone === "warning") return "bg-[var(--status-warning)]";
  if (tone === "danger") return "bg-[var(--status-danger)]";
  return "bg-primary";
}

function panelClassForTone(tone: StripTone) {
	if (tone === "success") {
		return "border-[color:color-mix(in_oklab,var(--status-success),transparent_72%)] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--status-success-bg),white_18%),color-mix(in_oklab,var(--card),transparent_0%))]";
	}

	if (tone === "warning") {
		return "border-[color:color-mix(in_oklab,var(--status-warning),transparent_72%)] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--status-warning-bg),white_18%),color-mix(in_oklab,var(--card),transparent_0%))]";
	}

	if (tone === "danger") {
		return "border-[color:color-mix(in_oklab,var(--destructive),transparent_72%)] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--status-danger-bg),white_16%),color-mix(in_oklab,var(--card),transparent_0%))]";
	}

	return "border-border/70 bg-[linear-gradient(155deg,color-mix(in_oklab,var(--card),white_10%),color-mix(in_oklab,var(--card),transparent_0%))]";
}

export function ContextStrip({
  items,
  className,
}: {
  items: ContextStripItem[];
  className?: string;
}) {
  return (
    <section className={cn("grid gap-3 md:grid-cols-2 2xl:grid-cols-4", className)}>
      {items.map((item) => {
        const tone = item.tone ?? "neutral";

        return (
          <article
            key={item.label}
            className={cn(
              "ds-panel-muted ds-grid-overlay relative overflow-hidden rounded-[1.45rem] p-4 transition duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] hover:shadow-[var(--shadow-soft)]",
              panelClassForTone(tone),
            )}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="font-subheader text-[10px] text-muted-foreground">{item.label}</p>
              <span className={cn("mt-1 h-2 w-2 rounded-full shadow-[0_0_0_5px_color-mix(in_oklab,var(--foreground),transparent_96%)]", dotClassForTone(tone))} />
            </div>

            <div className="mt-3">
              <div className="font-display text-[clamp(1.35rem,3vw,1.9rem)] font-semibold leading-[0.98] tracking-[-0.05em] text-foreground">
                {item.value}
              </div>
              {item.description ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.description}</p> : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}
