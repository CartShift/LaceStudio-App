import type { NextRequest, NextResponse } from "next/server";
import { ApiError, errorResponse } from "@/lib/http";
import { log } from "@/lib/logger";

export async function withRouteErrorHandling<T extends NextResponse>(request: NextRequest | Request, handler: (request: NextRequest | Request) => Promise<T>): Promise<T> {
	const startMs = performance.now();
	const requestId = request.headers.get("x-request-id") ?? undefined;

	try {
		const response = await handler(request);
		const duration_ms = Math.round(performance.now() - startMs);

		// Attach request ID as a response header so clients can reference it
		if (requestId) {
			response.headers.set("x-request-id", requestId);
		}

		log({
			level: "info",
			service: "api",
			action: "route_ok",
			metadata: {
				method: request.method,
				path: (() => {
					try {
						return new URL(request.url).pathname;
					} catch {
						return "unknown";
					}
				})(),
				request_id: requestId,
				duration_ms,
				status: response.status
			}
		});

		return response;
	} catch (error) {
		const duration_ms = Math.round(performance.now() - startMs);
		const path = (() => {
			try {
				return new URL(request.url).pathname;
			} catch {
				return "unknown";
			}
		})();

		log({
			level: error instanceof ApiError && error.status < 500 ? "warn" : "error",
			service: "api",
			action: "route_error",
			error: error instanceof Error ? error.message : String(error),
			metadata: {
				method: request.method,
				path,
				request_id: requestId,
				duration_ms,
				...(error instanceof ApiError ? { status: error.status, code: error.code } : { status: 500 })
			}
		});

		const errResponse = errorResponse(error, { requestId }) as T;
		if (requestId) {
			errResponse.headers.set("x-request-id", requestId);
		}
		return errResponse;
	}
}
