import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

declare global {
  var __laceStudioRateLimitMap: Map<string, RateLimitEntry> | undefined;
}

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/"];
const DEFAULT_MAX_REQUEST_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_PHOTO_IMPORT_MAX_REQUEST_BODY_BYTES = 180 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = 120;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS_PER_USER = 120;
const RATE_LIMIT_STATE = globalThis.__laceStudioRateLimitMap ?? new Map<string, RateLimitEntry>();
globalThis.__laceStudioRateLimitMap = RATE_LIMIT_STATE;

function readRateLimitWindowMs(): number {
  const value = Number.parseInt(process.env.API_RATE_LIMIT_WINDOW_MS ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RATE_LIMIT_WINDOW_MS;
  return value;
}

function readRateLimitMaxRequests(): number {
  const value = Number.parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RATE_LIMIT_MAX_REQUESTS;
  return value;
}

function readRateLimitMaxRequestsPerUser(): number {
  const value = Number.parseInt(process.env.API_RATE_LIMIT_MAX_REQUESTS_PER_USER ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_RATE_LIMIT_MAX_REQUESTS_PER_USER;
  return value;
}

function readPhotoImportMaxRequestBodyBytes(): number {
  const value = Number.parseInt(process.env.PHOTO_IMPORT_MAX_REQUEST_BODY_BYTES ?? "", 10);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_PHOTO_IMPORT_MAX_REQUEST_BODY_BYTES;
  return value;
}

function getRequestId(request: NextRequest): string {
  return request.headers.get("x-request-id")?.trim() || crypto.randomUUID();
}

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
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
    const decoded = decodeBase64Url(trimmed.substring(7));
    if (decoded) {
      trimmed = decoded;
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

      const currentSession =
        object.currentSession && typeof object.currentSession === "object"
          ? (object.currentSession as Record<string, unknown>)
          : null;
      if (typeof currentSession?.access_token === "string") {
        return currentSession.access_token;
      }
    }
  } catch {
    // Ignore JSON parse failure and use the raw string value.
  }

  return trimmed;
}

function readAccessTokenFromCookies(request: NextRequest): string | null {
  const direct = request.cookies.get("sb-access-token")?.value?.trim();
  if (direct) return direct;

  const authCookies = request.cookies
    .getAll()
    .filter((cookie) => cookie.name.startsWith("sb-") && /auth-token(\.\d+)?$/.test(cookie.name))
    .sort((a, b) => {
      const numA = Number.parseInt(a.name.match(/\.(\d+)$/)?.[1] ?? "0", 10);
      const numB = Number.parseInt(b.name.match(/\.(\d+)$/)?.[1] ?? "0", 10);
      return numA - numB;
    });

  if (authCookies.length === 0) return null;

  let decoded = authCookies.map((cookie) => cookie.value).join("");

  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the undecoded string when the cookie payload is malformed.
  }

  return parseAccessTokenFromCookieValue(decoded);
}

function decodeBase64Url(value: string): string | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  try {
    return atob(normalized + padding);
  } catch {
    return null;
  }
}

function readJwtSubject(token: string): string | null {
  const [, payload] = token.split(".");
  if (!payload) return null;

  const decoded = decodeBase64Url(payload);
  if (!decoded) return null;

  try {
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const subject = (parsed as Record<string, unknown>).sub;
    return typeof subject === "string" && subject.trim().length > 0 ? subject : null;
  } catch {
    return null;
  }
}

function getRateLimitIdentity(request: NextRequest): string | null {
  const demoUserId = request.cookies.get("lacestudio-user-id")?.value?.trim();
  if (demoUserId) {
    return `user:${demoUserId}`;
  }

  const token = parseBearerToken(request.headers.get("authorization")) ?? readAccessTokenFromCookies(request);
  if (!token) return null;

  const jwtSubject = readJwtSubject(token);
  if (jwtSubject) {
    return `user:${jwtSubject}`;
  }

  return null;
}

function trustedOrigins(request: NextRequest): Set<string> {
  const trusted = new Set<string>([request.nextUrl.origin]);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    try {
      trusted.add(new URL(appUrl).origin);
    } catch {
      // Ignore malformed app URL.
    }
  }

  const extra = process.env.CSRF_TRUSTED_ORIGINS?.trim();
  if (extra) {
    for (const item of extra.split(",")) {
      const origin = item.trim();
      if (!origin) continue;
      try {
        trusted.add(new URL(origin).origin);
      } catch {
        // Ignore malformed origin entries.
      }
    }
  }

  return trusted;
}

function hasSessionCookie(request: NextRequest): boolean {
  const cookieHeader = request.headers.get("cookie") ?? "";
  if (!cookieHeader) return false;

  return (
    cookieHeader.includes("sb-") ||
    cookieHeader.includes("lacestudio-role=") ||
    cookieHeader.includes("lacestudio-user-id=")
  );
}

function isCsrfExemptPath(pathname: string): boolean {
  return CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAllowedOrigin(request: NextRequest, origin: string): boolean {
  return trustedOrigins(request).has(origin);
}

function shouldRejectForCsrf(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  if (isCsrfExemptPath(request.nextUrl.pathname)) return false;
  if (request.headers.get("authorization")) return false;

  const origin = request.headers.get("origin")?.trim();
  if (!origin) {
    return hasSessionCookie(request);
  }

  return !isAllowedOrigin(request, origin);
}

function shouldRejectForBodySize(request: NextRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  const contentLengthHeader = request.headers.get("content-length");
  if (!contentLengthHeader) return false;

  const contentLength = Number.parseInt(contentLengthHeader, 10);
  if (!Number.isFinite(contentLength)) return false;

  const pathname = request.nextUrl.pathname;
  const photoImportPath = /^\/api\/models\/[^/]+\/workflow\/photo-import\/?$/;
  const maxRequestBodyBytes = photoImportPath.test(pathname)
    ? readPhotoImportMaxRequestBodyBytes()
    : DEFAULT_MAX_REQUEST_BODY_BYTES;

  return contentLength > maxRequestBodyBytes;
}

function applyRateLimit(key: string, now: number, windowMs: number, maxRequests: number): { limited: boolean; retryAfterSeconds: number } {
  const current = RATE_LIMIT_STATE.get(key);
  if (!current || current.resetAt <= now) {
    RATE_LIMIT_STATE.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { limited: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
  }

  if (current.count >= maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    return { limited: true, retryAfterSeconds };
  }

  current.count += 1;
  RATE_LIMIT_STATE.set(key, current);
  return { limited: false, retryAfterSeconds: Math.ceil((current.resetAt - now) / 1000) };
}

function cleanupExpiredRateLimitEntries(now: number): void {
  if (RATE_LIMIT_STATE.size <= 20_000) return;
  for (const [entryKey, entry] of RATE_LIMIT_STATE.entries()) {
    if (entry.resetAt <= now) {
      RATE_LIMIT_STATE.delete(entryKey);
    }
  }
}

function isRateLimited(request: NextRequest): { limited: boolean; retryAfterSeconds: number } {
  const windowMs = readRateLimitWindowMs();
  const maxRequests = readRateLimitMaxRequests();
  const maxRequestsPerUser = readRateLimitMaxRequestsPerUser();
  const now = Date.now();
  const routeKey = `${request.nextUrl.pathname}:${request.method}`;
  const ipKey = `ip:${getClientIp(request)}:${routeKey}`;
  const identity = getRateLimitIdentity(request);

  const ipLimit = applyRateLimit(ipKey, now, windowMs, maxRequests);
  if (ipLimit.limited) {
    return ipLimit;
  }

  if (identity) {
    const userLimit = applyRateLimit(`${identity}:${routeKey}`, now, windowMs, maxRequestsPerUser);
    if (userLimit.limited) {
      return userLimit;
    }

    cleanupExpiredRateLimitEntries(now);
    return {
      limited: false,
      retryAfterSeconds: Math.max(ipLimit.retryAfterSeconds, userLimit.retryAfterSeconds),
    };
  }

  cleanupExpiredRateLimitEntries(now);
  return ipLimit;
}

function jsonError(status: number, code: string, message: string, requestId: string, retryAfterSeconds?: number): NextResponse {
  const response = NextResponse.json(
    {
      error: {
        code,
        message,
        request_id: requestId,
      },
    },
    { status },
  );
  response.headers.set("x-request-id", requestId);
  if (retryAfterSeconds !== undefined) {
    response.headers.set("retry-after", String(retryAfterSeconds));
  }
  return response;
}

export function proxy(request: NextRequest) {
  const requestId = getRequestId(request);
  const isHealthRoute = request.nextUrl.pathname === "/api/health";

  if (shouldRejectForBodySize(request)) {
    return jsonError(413, "VALIDATION_ERROR", "Request body is too large.", requestId);
  }

  if (shouldRejectForCsrf(request)) {
    return jsonError(403, "FORBIDDEN", "Cross-site request was blocked.", requestId);
  }

  if (!isHealthRoute) {
    const rateLimit = isRateLimited(request);
    if (rateLimit.limited) {
      return jsonError(429, "RATE_LIMITED", "Rate limit exceeded. Please retry later.", requestId, rateLimit.retryAfterSeconds);
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("x-request-id", requestId);
  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
