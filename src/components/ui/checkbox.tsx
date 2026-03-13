import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    data-slot="checkbox"
    className={cn(
      "peer size-5 shrink-0 rounded-[0.45rem] border border-input bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card),white_20%),var(--card))] shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_40%),0_1px_0_color-mix(in_oklab,var(--foreground),transparent_96%)] ring-offset-background transition-[border-color,background-color,box-shadow,transform] duration-200",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklab,var(--ring),transparent_58%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "data-[state=checked]:border-primary data-[state=checked]:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--primary),white_8%),color-mix(in_oklab,var(--primary),black_3%))] data-[state=checked]:text-primary-foreground",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
      <Check className="size-3.5" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));

Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
