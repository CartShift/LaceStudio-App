import type { FieldErrorMap } from "@/types/ui";

type ErrorDetailsShape = {
  fieldErrors?: Record<string, string[] | undefined>;
  field_errors?: Record<string, string[] | undefined>;
};

export function parseFieldErrors(error: unknown): FieldErrorMap {
  if (
    !error ||
    typeof error !== "object" ||
    !("details" in error) ||
    !error.details ||
    typeof error.details !== "object"
  ) {
    return {};
  }

  const details = error.details as ErrorDetailsShape;
  const fieldErrors = details.fieldErrors ?? details.field_errors;
  if (!fieldErrors || typeof fieldErrors !== "object") {
    return {};
  }

  const parsed: FieldErrorMap = {};
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!Array.isArray(messages)) continue;
    const normalized = messages
      .map((message) => String(message).trim())
      .filter((message) => message.length > 0);
    if (normalized.length > 0) {
      parsed[field] = normalized;
    }
  }

  return parsed;
}

export function firstFieldError(fieldErrors: FieldErrorMap, field: string): string | undefined {
  return fieldErrors[field]?.[0];
}
