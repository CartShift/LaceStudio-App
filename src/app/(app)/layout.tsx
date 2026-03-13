import { cookies, headers } from "next/headers";
import { PlatformLayoutClient } from "@/components/layout/platform-layout-client";
import { getOptionalSessionContext, type AppRole } from "@/lib/auth";
import { shouldEnableLocalhostAdminBypass } from "@/lib/localhost-auth";
import { isDemoMode } from "@/server/demo/mode";

function resolveDemoRole(input: string | null): AppRole {
	if (input === "admin" || input === "operator" || input === "client") {
		return input;
	}

	return "operator";
}

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
	const demoMode = isDemoMode();
	const h = await headers();
	const localhostBypassEnabled = shouldEnableLocalhostAdminBypass({
		hostHeader: h.get("host")
	});

	let role: AppRole = "client";

	if (demoMode) {
		const c = await cookies();
		role = resolveDemoRole(c.get("lacestudio-role")?.value ?? null);
	} else {
		const session = await getOptionalSessionContext();
		role = session?.role ?? "client";
	}

	const effectiveRole = localhostBypassEnabled ? "admin" : role;

	return (
		<PlatformLayoutClient role={effectiveRole} showRoleSwitcher={demoMode}>
			{children}
		</PlatformLayoutClient>
	);
}
