import type { FieldErrorMap } from "@/types/ui";

export function FormErrorSummary({
  title = "Please fix the highlighted fields.",
  errors,
}: {
  title?: string;
  errors: FieldErrorMap;
}) {
  const entries = Object.entries(errors).filter(([, messages]) => messages.length > 0);
  if (entries.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-xl border border-[color:color-mix(in_oklab,var(--destructive),transparent_70%)] bg-[color:color-mix(in_oklab,var(--destructive),transparent_90%)] px-4 py-3"
    >
      <p className="text-sm font-semibold text-destructive">{title}</p>
      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-destructive/90">
        {entries.map(([field, messages]) => (
          <li key={field}>{messages[0]}</li>
        ))}
      </ul>
    </div>
  );
}
