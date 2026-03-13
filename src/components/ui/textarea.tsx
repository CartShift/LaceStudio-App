import * as React from "react";
import { cn } from "@/lib/cn";
import { controlBaseClass } from "@/components/ui/control-styles";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        controlBaseClass,
        "min-h-[132px] resize-y py-3",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
