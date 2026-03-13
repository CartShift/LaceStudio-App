import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
	"inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[calc(var(--radius)-0.2rem)] border border-transparent text-sm font-semibold transition-[transform,box-shadow,border-color,background-color,color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklab,var(--ring),transparent_58%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-55 disabled:saturate-75 aria-invalid:ring-[color:color-mix(in_oklab,var(--destructive),transparent_72%)] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"border-transparent bg-[linear-gradient(140deg,color-mix(in_oklab,var(--primary),white_9%),color-mix(in_oklab,var(--primary),black_6%))] text-primary-foreground shadow-[0_12px_28px_color-mix(in_oklab,var(--primary),transparent_62%)] hover:-translate-y-0.5 hover:shadow-[0_16px_34px_color-mix(in_oklab,var(--primary),transparent_56%)] active:translate-y-0",
				primary:
					"border-transparent bg-[linear-gradient(140deg,color-mix(in_oklab,var(--primary),white_9%),color-mix(in_oklab,var(--primary),black_6%))] text-primary-foreground shadow-[0_12px_28px_color-mix(in_oklab,var(--primary),transparent_62%)] hover:-translate-y-0.5 hover:shadow-[0_16px_34px_color-mix(in_oklab,var(--primary),transparent_56%)] active:translate-y-0",
				secondary:
					"ds-pill border-border bg-[linear-gradient(150deg,color-mix(in_oklab,var(--card),white_20%),color-mix(in_oklab,var(--card),transparent_0%))] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_36%)] hover:-translate-y-0.5 hover:border-[color:color-mix(in_oklab,var(--primary),transparent_68%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_56%)]",
				outline:
					"border-[color:color-mix(in_oklab,var(--foreground),transparent_86%)] bg-[color:color-mix(in_oklab,var(--background),transparent_22%)] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_28%)] hover:-translate-y-0.5 hover:border-[color:color-mix(in_oklab,var(--primary),transparent_58%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_74%)]",
				ghost: "border-transparent bg-transparent text-muted-foreground hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_72%)] hover:text-foreground",
				link: "h-auto rounded-none border-transparent px-0 py-0 text-primary shadow-none hover:text-[color:color-mix(in_oklab,var(--primary),black_12%)] hover:underline",
				soft: "border-[color:color-mix(in_oklab,var(--foreground),transparent_88%)] bg-[color:color-mix(in_oklab,var(--accent),transparent_84%)] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_34%)] hover:border-[color:color-mix(in_oklab,var(--primary),transparent_72%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_68%)]",
				destructive:
					"border-transparent bg-[linear-gradient(140deg,color-mix(in_oklab,var(--destructive),white_8%),color-mix(in_oklab,var(--destructive),black_7%))] text-destructive-foreground shadow-[0_12px_26px_color-mix(in_oklab,var(--destructive),transparent_56%)] hover:-translate-y-0.5 hover:shadow-[0_16px_32px_color-mix(in_oklab,var(--destructive),transparent_48%)]"
			},
			size: {
				default: "h-11 px-4 py-2 has-[>svg]:px-3.5",
				sm: "h-9 rounded-[calc(var(--radius)-0.45rem)] px-3 text-xs has-[>svg]:px-2.5",
				lg: "h-12 px-6 text-[15px] has-[>svg]:px-5",
				xl: "h-[3.25rem] px-7 text-[15px] has-[>svg]:px-6",
				icon: "h-10 w-10 p-0",
				"icon-sm": "h-8 w-8 rounded-[calc(var(--radius)-0.45rem)] p-0 [&_svg:not([class*='size-'])]:size-3.5",
				"icon-lg": "h-12 w-12 p-0 [&_svg:not([class*='size-'])]:size-4.5"
			}
		},
		compoundVariants: [
			{ variant: "link", size: "default", className: "h-auto px-0 py-0" },
			{ variant: "link", size: "sm", className: "h-auto px-0 py-0" },
			{ variant: "link", size: "lg", className: "h-auto px-0 py-0" },
			{ variant: "link", size: "xl", className: "h-auto px-0 py-0" }
		],
		defaultVariants: {
			variant: "primary",
			size: "default"
		}
	}
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
	asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, type, ...props }, ref) => {
	const Comp = asChild ? Slot : "button";

	return (
		<Comp
			ref={ref}
			data-slot="button"
			data-variant={variant ?? "primary"}
			data-size={size ?? "default"}
			className={cn(buttonVariants({ variant, size, className }))}
			{...(!asChild ? { type: type ?? "button" } : {})}
			{...props}
		/>
	);
});
Button.displayName = "Button";

export { Button, buttonVariants };
