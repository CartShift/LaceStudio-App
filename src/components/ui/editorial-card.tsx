import { cn } from "@/lib/cn";
import { Card } from "@/components/ui/card";

export function EditorialCard({
  children,
  className,
  ...props
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <Card
      variant="elevated"
      data-slot="editorial-card"
      className={cn(
        "ds-stage-panel group relative overflow-hidden border-border/70 p-4 md:p-5",
        "after:pointer-events-none after:absolute after:inset-0 after:bg-[linear-gradient(150deg,color-mix(in_oklab,var(--accent),transparent_97%),transparent_42%,color-mix(in_oklab,var(--primary),transparent_98%))] after:opacity-70 after:content-['']",
        "transition duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-[1px] hover:shadow-[var(--shadow-ambient)]",
        className,
      )}
      {...props}
    >
      {children}
    </Card>
  );
}
