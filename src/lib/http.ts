import { NextResponse } from "next/server";
import { applyFriendlyTerms } from "@/lib/copy";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "GPU_BUDGET_EXCEEDED"
  | "INTERNAL_ERROR";

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: ApiErrorCode;
  public readonly details?: unknown;

  constructor(status: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function errorResponse(error: unknown, context?: { requestId?: string }): NextResponse {
  const includeDetails = process.env.NODE_ENV !== "production";

  if (error instanceof ApiError) {
    const normalizedMessage = applyFriendlyTerms(error.message);
    const safeMessage =
      !includeDetails && error.code === "INTERNAL_ERROR"
        ? "Something went wrong on our side. Please try again."
        : normalizedMessage;
    const exposeDetails = includeDetails || error.code === "VALIDATION_ERROR";

    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: safeMessage,
          ...(exposeDetails && error.details !== undefined ? { details: error.details } : {}),
          ...(context?.requestId ? { request_id: context.requestId } : {}),
        },
      },
      { status: error.status },
    );
  }

  console.error("[API] Unhandled error:", {
    request_id: context?.requestId,
    error,
  });
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message:
          process.env.NODE_ENV === "development" && error instanceof Error
            ? error.message
            : "Something went wrong on our side. Please try again.",
        ...(context?.requestId ? { request_id: context.requestId } : {}),
      },
    },
    { status: 500 },
  );
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}
