"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { BreadcrumbProvider } from "@/components/providers/breadcrumb-provider";
import type { AppRole } from "@/lib/auth";

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30_000,
				gcTime: 5 * 60_000,
				refetchOnWindowFocus: false
			}
		}
	});
}

type Props = {
	role: AppRole;
	showRoleSwitcher: boolean;
	children: React.ReactNode;
};

export function PlatformLayoutClient({ role, showRoleSwitcher, children }: Props) {
	const [queryClient] = useState(makeQueryClient);
	return (
		<QueryClientProvider client={queryClient}>
			<BreadcrumbProvider>
				<AppShell role={role} showRoleSwitcher={showRoleSwitcher}>
					{children}
				</AppShell>
			</BreadcrumbProvider>
		</QueryClientProvider>
	);
}
