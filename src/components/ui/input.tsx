import * as React from "react";
import { cn } from "@/lib/cn";
import { controlBaseClass } from "@/components/ui/control-styles";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(
        controlBaseClass,
        "[&::-webkit-search-cancel-button]:appearance-none",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = "Input";

export { Input };
