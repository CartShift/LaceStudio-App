import { describe, expect, it } from "vitest";
import { firstFieldError, parseFieldErrors } from "@/lib/api-errors";

describe("api error parser", () => {
  it("maps zod-like field errors into a FieldErrorMap", () => {
    const parsed = parseFieldErrors({
      details: {
        fieldErrors: {
          model_id: ["Model is required"],
          batch_size: ["Batch size must be between 1 and 12"],
        },
      },
    });

    expect(parsed.model_id).toEqual(["Model is required"]);
    expect(parsed.batch_size).toEqual(["Batch size must be between 1 and 12"]);
  });

  it("maps snake_case field errors from API validation payloads", () => {
    const parsed = parseFieldErrors({
      details: {
        field_errors: {
          model_id: ["Model is required"],
          batch_size: ["Batch size must be between 1 and 12"],
        },
      },
    });

    expect(parsed.model_id).toEqual(["Model is required"]);
    expect(parsed.batch_size).toEqual(["Batch size must be between 1 and 12"]);
  });

  it("returns first error for a field", () => {
    const fieldErrors = {
      model_id: ["Model is required", "Model must be active"],
    };
    expect(firstFieldError(fieldErrors, "model_id")).toBe("Model is required");
  });
});
