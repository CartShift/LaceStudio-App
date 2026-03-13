import { z, type ZodType } from "zod";
import { ApiError } from "@/lib/http";

export async function parseJson<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const body = await request.json().catch(() => {
    throw new ApiError(400, "VALIDATION_ERROR", "The request body is not valid JSON. Fix the JSON and try again.");
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Some request fields are invalid. Review the highlighted fields and try again.", toValidationDetails("body", parsed.error));
  }

  return parsed.data;
}

export function parseParams<T extends z.ZodRawShape>(
  params: Record<string, string | string[] | undefined>,
  shape: T,
): z.infer<z.ZodObject<T>> {
  const objectSchema = z.object(shape);

  const normalized = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]),
  );

  const parsed = objectSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "The page link is missing required details. Refresh and try again.", toValidationDetails("params", parsed.error));
  }

  return parsed.data;
}

export function parseQuery<T extends z.ZodRawShape>(
  searchParams: URLSearchParams,
  shape: T,
): z.infer<z.ZodObject<T>> {
  const objectSchema = z.object(shape);
  const raw = Object.fromEntries(searchParams.entries());
  const parsed = objectSchema.safeParse(raw);

  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "One or more filter values are invalid. Update the filters and try again.", toValidationDetails("query", parsed.error));
  }

  return parsed.data;
}

export function validateOrThrow<T>(schema: ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Some request fields are invalid. Review the highlighted fields and try again.", toValidationDetails("payload", parsed.error));
  }

  return parsed.data;
}

function toValidationDetails(scope: "body" | "params" | "query" | "payload", error: z.ZodError): {
  scope: "body" | "params" | "query" | "payload";
  field_errors: Record<string, string[]>;
  form_errors: string[];
  issues: Array<{ path: string; code: string; message: string }>;
} {
  const flattened = error.flatten();
  return {
    scope,
    field_errors: flattened.fieldErrors,
    form_errors: flattened.formErrors,
    issues: error.issues.map((issue) => ({
      path: issue.path.length > 0 ? issue.path.join(".") : "<root>",
      code: issue.code,
      message: issue.message,
    })),
  };
}
