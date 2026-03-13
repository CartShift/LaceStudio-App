import { createClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { UserRole } from "@prisma/client";
import { getEnv } from "@/lib/env";
import { ApiError } from "@/lib/http";
import { shouldEnableLocalhostAdminBypass } from "@/lib/localhost-auth";
import { prisma } from "@/lib/prisma";
import { isDemoMode } from "@/server/demo/mode";

export type AppRole = "admin" | "operator" | "client";

export type SessionContext = {
	userId: string;
	role: AppRole;
};

const DEMO_ROLE_USER_IDS: Record<AppRole, string> = {
	admin: "00000000-0000-0000-0000-000000000001",
	operator: "00000000-0000-0000-0000-000000000002",
	client: "00000000-0000-0000-0000-000000000003"
};

const DEMO_SEED_USERS: Record<string, { email: string; display_name: string; role: UserRole }> = {
	[DEMO_ROLE_USER_IDS.admin]: { email: "admin@lacestudio.internal", display_name: "LaceStudio Admin", role: UserRole.ADMIN },
	[DEMO_ROLE_USER_IDS.operator]: { email: "operator@lacestudio.internal", display_name: "LaceStudio Operator", role: UserRole.OPERATOR },
	[DEMO_ROLE_USER_IDS.client]: { email: "client@lacestudio.internal", display_name: "LaceStudio Client", role: UserRole.CLIENT }
};

async function ensureSeedUserExists(userId: string): Promise<void> {
	const seed = DEMO_SEED_USERS[userId];
	if (!seed) return;
	const existing = await prisma.user.findUnique({ where: { id: userId } });
	if (existing) return;
	const byEmail = await prisma.user.findUnique({ where: { email: seed.email } });
	if (byEmail) {
		await prisma.$executeRawUnsafe(`UPDATE users SET id = $1::uuid WHERE email = $2`, userId, seed.email);
		return;
	}
	await prisma.user.create({ data: { id: userId, ...seed } });
}

function parseRole(value: string | null | undefined): AppRole | null {
	if (value === "admin" || value === "operator" || value === "client") {
		return value;
	}

	return null;
}

function toAppRole(role: UserRole): AppRole {
	if (role === "ADMIN") return "admin";
	if (role === "CLIENT") return "client";
	return "operator";
}

function parseBearerToken(value: string | null): string | null {
	if (!value) return null;
	const match = value.match(/^Bearer\s+(.+)$/i);
	return match?.[1]?.trim() || null;
}

function parseAccessTokenFromCookieValue(value: string): string | null {
	let trimmed = value.trim();
	if (!trimmed) return null;

	if (trimmed.startsWith("base64-")) {
		try {
			trimmed = Buffer.from(trimmed.substring(7), "base64").toString("utf8");
		} catch {
			// Ignore base64 decode errors and attempt parsing anyway.
		}
	}

	try {
		const parsed = JSON.parse(trimmed) as unknown;

		if (Array.isArray(parsed) && typeof parsed[0] === "string") {
			return parsed[0];
		}

		if (parsed && typeof parsed === "object") {
			const object = parsed as Record<string, unknown>;
			if (typeof object.access_token === "string") {
				return object.access_token;
			}

			const currentSession = object.currentSession && typeof object.currentSession === "object" ? (object.currentSession as Record<string, unknown>) : null;
			if (typeof currentSession?.access_token === "string") {
				return currentSession.access_token;
			}
		}
	} catch {
		// Ignore JSON parse failures and fall back to raw token value.
	}

	return trimmed;
}

function readAccessTokenFromCookies(cookieStore: Awaited<ReturnType<typeof cookies>>): string | null {
	const directToken = cookieStore.get("sb-access-token")?.value?.trim();
	if (directToken) return directToken;

	const authCookies = cookieStore
		.getAll()
		.filter(cookie => cookie.name.startsWith("sb-") && /auth-token(\.\d+)?$/.test(cookie.name))
		.sort((a, b) => {
			const numA = parseInt(a.name.match(/\.(\d+)$/)?.[1] ?? "0", 10);
			const numB = parseInt(b.name.match(/\.(\d+)$/)?.[1] ?? "0", 10);
			return numA - numB;
		});

	if (authCookies.length === 0) return null;

	let decoded = authCookies.map(c => c.value).join("");

	try {
		decoded = decodeURIComponent(decoded);
	} catch {
		// Keep raw value.
	}

	return parseAccessTokenFromCookieValue(decoded);
}

async function getDemoSessionContext(): Promise<SessionContext> {
	const cookieStore = await cookies();
	const role = parseRole(cookieStore.get("lacestudio-role")?.value) ?? "operator";
	const userId = cookieStore.get("lacestudio-user-id")?.value?.trim() || DEMO_ROLE_USER_IDS[role];
	return { role, userId };
}

async function safeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	try {
		return await fetch(input, init);
	} catch {
		return new Response(JSON.stringify({ error: "Authentication service is unavailable." }), {
			status: 503,
			headers: { "Content-Type": "application/json" }
		});
	}
}

async function validateAccessToken(accessToken: string): Promise<{ id: string }> {
	const env = getEnv();
	const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
		global: { fetch: safeFetch },
		auth: {
			persistSession: false,
			autoRefreshToken: false,
			detectSessionInUrl: false
		}
	});

	const { data, error } = await supabase.auth.getUser(accessToken);
	if (error || !data?.user?.id) {
		const status = (error as { status?: number })?.status;
		const msg = error?.message?.toLowerCase() ?? "";
		if (status === 503 || msg.includes("503") || msg.includes("unreachable")) {
			throw new ApiError(503, "INTERNAL_ERROR", "Authentication is temporarily unavailable. Please try again in a moment.");
		}
		throw new ApiError(401, "UNAUTHENTICATED", "Your sign-in token is invalid or expired. Sign in again and retry.");
	}

	return { id: data.user.id };
}

export async function getSessionContext(): Promise<SessionContext> {
	const headerStore = await headers();
	const cookieStore = await cookies();
	const localhostBypassEnabled = shouldEnableLocalhostAdminBypass({
		hostHeader: headerStore.get("host")
	});

	if (isDemoMode()) {
		const session = await getDemoSessionContext();
		await ensureSeedUserExists(session.userId);
		if (localhostBypassEnabled) {
			console.warn("[AUTH] Localhost auth bypass active – demo session elevated to admin role");
			return { ...session, role: "admin" };
		}
		return session;
	}

	const token = parseBearerToken(headerStore.get("authorization")) ?? readAccessTokenFromCookies(cookieStore);

	if (!token) {
		if (localhostBypassEnabled) {
			console.warn("[AUTH] Localhost auth bypass active – no token provided, granting admin role");
			await ensureSeedUserExists(DEMO_ROLE_USER_IDS.admin);
			return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
		}
		throw new ApiError(401, "UNAUTHENTICATED", "You are not signed in. Sign in and try again.");
	}

	let authUser: { id: string };
	try {
		authUser = await validateAccessToken(token);
	} catch (error) {
		if (localhostBypassEnabled) {
			console.warn("[AUTH] Localhost auth bypass active – token validation failed, granting admin role", error instanceof Error ? error.message : String(error));
			await ensureSeedUserExists(DEMO_ROLE_USER_IDS.admin);
			return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
		}
		throw error;
	}

	const user = await prisma.user.findUnique({
		where: { id: authUser.id },
		select: { id: true, role: true }
	});
	if (!user) {
		if (localhostBypassEnabled) {
			console.warn("[AUTH] Localhost auth bypass active – user not provisioned, granting admin role");
			await ensureSeedUserExists(DEMO_ROLE_USER_IDS.admin);
			return { userId: DEMO_ROLE_USER_IDS.admin, role: "admin" };
		}
		throw new ApiError(401, "UNAUTHENTICATED", "Your account is not set up for this workspace yet. Ask an admin to grant access.");
	}

	const session: SessionContext = { userId: user.id, role: toAppRole(user.role) };
	if (localhostBypassEnabled) {
		console.warn("[AUTH] Localhost auth bypass active – escalating authenticated user to admin role");
		return { ...session, role: "admin" };
	}
	return session;
}

export async function getOptionalSessionContext(): Promise<SessionContext | null> {
	try {
		return await getSessionContext();
	} catch (error) {
		if (error instanceof ApiError && (error.status === 401 || error.status === 503)) {
			return null;
		}
		throw error;
	}
}

export function assertRole(role: AppRole, allowed: AppRole[]): void {
	if (!allowed.includes(role)) {
		throw new ApiError(403, "FORBIDDEN", "You don't have access to this action. Contact your admin if you need it.");
	}
}
