import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRouteErrorHandling } from "@/lib/route-handler";
import { getEnv } from "@/lib/env";

const CHECK_TIMEOUT_MS = 5_000;

async function withCheckTimeout<T>(label: string, fn: () => Promise<T>): Promise<{ status: "ok" | "error"; latency_ms?: number; error?: string }> {
	const start = performance.now();
	try {
		await Promise.race([fn(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} check timed out`)), CHECK_TIMEOUT_MS))]);
		return { status: "ok", latency_ms: Math.round(performance.now() - start) };
	} catch (error) {
		return { status: "error", error: error instanceof Error ? error.message : String(error) };
	}
}

export async function GET(request: Request) {
	return withRouteErrorHandling(request, async () => {
		const env = getEnv();

		const [database] = await Promise.all([withCheckTimeout("database", () => prisma.$queryRaw`SELECT 1`)]);

		const healthy = database.status === "ok";

		const body = {
			status: healthy ? "healthy" : "degraded",
			timestamp: new Date().toISOString(),
			checks: {
				database,
				gpu_url: env.GPU_SERVICE_URL,
				supabase_url: env.NEXT_PUBLIC_SUPABASE_URL
			}
		};

		return NextResponse.json(body, {
			status: healthy ? 200 : 503,
			headers: { "Cache-Control": "no-store" }
		});
	});
}

