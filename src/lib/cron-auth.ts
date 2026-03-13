import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";

function secureEquals(left: string, right: string): boolean {
	const leftBytes = Buffer.from(left);
	const rightBytes = Buffer.from(right);

	if (leftBytes.byteLength !== rightBytes.byteLength) {
		return false;
	}

	return timingSafeEqual(leftBytes, rightBytes);
}

function readBearerToken(headerValue: string | null): string | null {
	if (!headerValue) return null;
	const match = headerValue.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

export async function assertCronAuthorized(request: Request): Promise<void> {
	const env = getEnv();
	const cronSecret = env.CRON_SECRET;

	const bearerToken = readBearerToken(request.headers.get("authorization"));
	const headerToken = request.headers.get("x-cron-secret")?.trim() || null;
	const candidate = bearerToken ?? headerToken;

	// 1. Try Cron Secret First (if configured)
	if (cronSecret && candidate && secureEquals(candidate, cronSecret)) {
		return;
	}

	// 2. Fall back to User Session for manual UI triggers
	try {
		const { getOptionalSessionContext, assertRole } = await import("@/lib/auth");
		const session = await getOptionalSessionContext();
		if (session) {
			assertRole(session.role, ["admin"]);
			return;
		}
	} catch {
		// Session check failed, fall through to default error
	}

	if (!cronSecret) {
		throw new ApiError(401, "UNAUTHENTICATED", "Scheduled task access requires a cron secret or an admin session.");
	}

	throw new ApiError(401, "UNAUTHENTICATED", "This request is not authorized for scheduled tasks. Use a valid cron secret or an admin session.");
}
