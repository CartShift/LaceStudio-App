"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { NoticeProvider } from "@/components/providers/notice-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

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

export function AppProviders({ children }: { children: React.ReactNode }) {
	const [queryClient] = useState(makeQueryClient);

	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<QueryClientProvider client={queryClient}>
				<TooltipProvider>
					<NoticeProvider>{children}</NoticeProvider>
					<Toaster position="bottom-right" />
				</TooltipProvider>
			</QueryClientProvider>
		</ThemeProvider>
	);
}
