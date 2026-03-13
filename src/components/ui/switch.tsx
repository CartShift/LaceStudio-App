import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    data-slot="switch"
    className={cn(
      "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border border-input bg-[color:color-mix(in_oklab,var(--card),transparent_5%)]",
      "shadow-[inset_0_1px_2px_color-mix(in_oklab,var(--foreground),transparent_92%)] transition-[border-color,background-color,box-shadow] duration-200",
      "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[color:color-mix(in_oklab,var(--ring),transparent_58%)] focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      "data-[state=checked]:border-transparent data-[state=checked]:bg-[linear-gradient(145deg,color-mix(in_oklab,var(--primary),white_10%),color-mix(in_oklab,var(--primary),black_4%))]",
      "disabled:cursor-not-allowed disabled:opacity-60",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-5 w-5 rounded-full bg-[linear-gradient(145deg,color-mix(in_oklab,var(--card),white_22%),var(--card))] shadow-[0_2px_8px_color-mix(in_oklab,var(--foreground),transparent_80%)] ring-0 transition-transform duration-200",
        "data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0.5",
      )}
    />
  </SwitchPrimitive.Root>
));

Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };
