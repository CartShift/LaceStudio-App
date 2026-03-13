import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "font-subheader inline-flex items-center gap-1.5 rounded-full border px-2.75 py-1 text-[11px] leading-none shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_36%)] transition-[border-color,background-color,color,box-shadow] duration-200",
  {
    variants: {
      tone: {
        neutral: "border-border bg-[color:color-mix(in_oklab,var(--card),var(--accent)_12%)] text-muted-foreground",
        success:
          "border-[var(--status-success-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-success-bg),white_24%),var(--status-success-bg))] text-[var(--status-success)]",
        warning:
          "border-[var(--status-warning-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-warning-bg),white_16%),var(--status-warning-bg))] text-[var(--status-warning)]",
        danger:
          "border-[var(--status-danger-border)] bg-[linear-gradient(145deg,color-mix(in_oklab,var(--status-danger-bg),white_16%),var(--status-danger-bg))] text-[var(--status-danger)]",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, tone, ...props }: BadgeProps) {
  return <div data-slot="badge" data-tone={tone ?? "neutral"} className={cn(badgeVariants({ tone }), className)} {...props} />;
}

export { Badge, badgeVariants };
