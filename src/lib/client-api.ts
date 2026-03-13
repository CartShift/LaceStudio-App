import { getAccessToken } from "@/lib/supabase-browser";

type ApiRequestInit = RequestInit & {
	timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 60_000;

type ErrorPayload = {
	error?: {
		code?: string;
		message?: string;
		details?: unknown;
	};
	message?: string;
};

export class ApiClientError extends Error {
	public readonly status: number;
	public readonly code?: string;
	public readonly details?: unknown;

	constructor(status: number, message: string, code?: string, details?: unknown) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export async function apiRequest<T>(path: string, init?: ApiRequestInit): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

	try {
		const token = await getAccessToken();
		const response = await fetch(path, {
			...init,
			signal: controller.signal,
			headers: {
				"Content-Type": "application/json",
				...(token ? { Authorization: `Bearer ${token}` } : {}),
				...(init?.headers ?? {})
			},
			credentials: "include",
			cache: init?.cache ?? "no-store"
		});

		const contentType = response.headers.get("content-type") ?? "";
		const isJson = contentType.includes("application/json");

		const payload = isJson ? ((await response.json().catch(() => null)) as ErrorPayload | null) : null;

		if (!response.ok) {
			throw new ApiClientError(
				response.status,
				payload?.error?.message ?? payload?.message ?? `We couldn't finish this request (${response.status}). Please try again.`,
				payload?.error?.code,
				payload?.error?.details
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		if (isJson) {
			return payload as T;
		}

		return (await response.text()) as unknown as T;
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new Error("This request took too long. Please try again.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}

export async function apiFormRequest<T>(path: string, formData: FormData, init?: Omit<ApiRequestInit, "body" | "headers">): Promise<T> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);

	try {
		const token = await getAccessToken();
		const response = await fetch(path, {
			method: "POST",
			...init,
			signal: controller.signal,
			body: formData,
			headers: token ? { Authorization: `Bearer ${token}` } : undefined,
			credentials: "include",
			cache: init?.cache ?? "no-store"
		});

		const contentType = response.headers.get("content-type") ?? "";
		const isJson = contentType.includes("application/json");
		const payload = isJson ? ((await response.json().catch(() => null)) as ErrorPayload | null) : null;

		if (!response.ok) {
			throw new ApiClientError(
				response.status,
				payload?.error?.message ?? payload?.message ?? `We couldn't finish this request (${response.status}). Please try again.`,
				payload?.error?.code,
				payload?.error?.details
			);
		}

		if (response.status === 204) {
			return undefined as T;
		}

		if (isJson) {
			return payload as T;
		}

		return (await response.text()) as unknown as T;
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new Error("This request took too long. Please try again.");
		}
		throw error;
	} finally {
		clearTimeout(timeout);
	}
}
