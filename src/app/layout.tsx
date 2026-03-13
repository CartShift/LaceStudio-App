import type { Metadata } from "next";
import { Onest, Fraunces } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/app-providers";

const onest = Onest({
	subsets: ["latin"],
	variable: "--font-body",
	display: "swap"
});

const fraunces = Fraunces({
	subsets: ["latin"],
	variable: "--font-display",
	display: "swap",
	axes: ["SOFT", "WONK"]
});

export const metadata: Metadata = {
	title: "LaceStudio",
	description: "Internal operating system for identity-safe synthetic talent production, campaign orchestration, publishing, and analytics.",
	other: {
		"color-scheme": "dark light"
	}
};

export default function RootLayout({
	children
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning className={`${onest.variable} ${fraunces.variable}`}>
			<body className={`${onest.className} antialiased`}>
				<AppProviders>{children}</AppProviders>
			</body>
		</html>
	);
}
