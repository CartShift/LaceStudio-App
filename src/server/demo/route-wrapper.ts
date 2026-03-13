/**
 * B2 improvement: Higher-order function that transparently handles demo-mode routing.
 *
 * Usage:
 * ```ts
 * export const GET = withDemoFallback(
 *   (session, input) => demoStore.listModels(),
 *   async (session, input) => prisma.aiModel.findMany(...)
 * );
 * ```
 */

import type { NextResponse } from "next/server";
import { getSessionContext, type SessionContext } from "@/lib/auth";
import { ok } from "@/lib/http";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { isDemoMode } from "@/server/demo/mode";

export type DemoHandler<TInput, TOutput> = (session: SessionContext, input: TInput) => TOutput | Promise<TOutput>;

export type RealHandler<TInput, TOutput> = (session: SessionContext, input: TInput) => Promise<TOutput>;

/**
 * Wraps a route handler with automatic demo-mode awareness.
 * Provide the demo handler (synchronous OK) and the real handler.
 * The wrapper manages session context, error handling, and response encoding.
 *
 * @param parseInput - Function to extract typed input from the Request
 * @param demoHandler - Returns data directly when isDemoMode() is true
 * @param realHandler - Async handler for live database
 * @param statusCode  - HTTP success status (default 200)
 */
export function withDemoFallback<TInput, TOutput>(
	parseInput: (request: Request) => TInput | Promise<TInput>,
	demoHandler: DemoHandler<TInput, TOutput>,
	realHandler: RealHandler<TInput, TOutput>,
	statusCode = 200
): (request: Request) => Promise<NextResponse> {
	return (request: Request) =>
		withRouteErrorHandling(request, async () => {
			const session = await getSessionContext();
			const input = await parseInput(request);

			if (isDemoMode()) {
				const result = await demoHandler(session, input);
				return ok(result, statusCode);
			}

			const result = await realHandler(session, input);
			return ok(result, statusCode);
		});
}
