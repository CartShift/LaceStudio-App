import { cn } from "@/lib/cn";

export function FieldError({
  message,
  id,
  className,
}: {
  message?: string;
  id?: string;
  className?: string;
}) {
  if (!message) return null;

  return (
    <p id={id} className={cn("text-xs font-medium leading-relaxed text-destructive", className)}>
      {message}
    </p>
  );
}
