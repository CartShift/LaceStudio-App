import * as React from "react";
import { FieldLabel } from "@/components/ui/field-label";
import { cn } from "@/lib/cn";

export function FormField({
  label,
  description,
  hint,
  id,
  required,
  error,
  className,
  children,
}: {
  label: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  id?: string;
  required?: boolean;
  error?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  const hintId = id ? `${id}-hint` : undefined;
  const errorId = id ? `${id}-error` : undefined;
  const descriptionId = id ? `${id}-description` : undefined;
  const hasError = Boolean(error);

  const child = id && React.isValidElement(children) ? children : null;

  const childProps =
    child && "props" in child && typeof child.props === "object"
      ? (child.props as { "aria-describedby"?: string; "aria-invalid"?: boolean })
      : null;

  const describedBy = [childProps?.["aria-describedby"], hintId, descriptionId, hasError ? errorId : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cn("space-y-2", className)}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      {child && id
        ? React.cloneElement(
            child as React.ReactElement<{
              id?: string;
              "aria-invalid"?: boolean;
              "aria-describedby"?: string;
            }>,
            {
              id,
              "aria-invalid": hasError,
              "aria-describedby": describedBy.length ? describedBy : undefined,
            },
          )
        : children}
      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {description ? (
        <p id={descriptionId} className="text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
