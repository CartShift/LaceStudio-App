"use client";

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
	const { theme = "system" } = useTheme();

	return (
		<Sonner
			theme={theme as ToasterProps["theme"]}
			className="toaster group"
			icons={{
				success: <CircleCheckIcon className="size-4" />,
				info: <InfoIcon className="size-4" />,
				warning: <TriangleAlertIcon className="size-4" />,
				error: <OctagonXIcon className="size-4" />,
				loading: <Loader2Icon className="size-4 animate-spin" />
			}}
			style={
				{
					"--normal-bg": "var(--popover)",
					"--normal-text": "var(--popover-foreground)",
					"--normal-border": "var(--border)",
					"--border-radius": "var(--radius-card-sm)",
					"--success-bg": "var(--status-success-bg)",
					"--success-text": "var(--status-success)",
					"--success-border": "var(--status-success-border)",
					"--warning-bg": "var(--status-warning-bg)",
					"--warning-text": "var(--status-warning)",
					"--warning-border": "var(--status-warning-border)",
					"--error-bg": "var(--status-danger-bg)",
					"--error-text": "var(--status-danger)",
					"--error-border": "var(--status-danger-border)"
				} as React.CSSProperties
			}
			{...props}
		/>
	);
};

export { Toaster };
