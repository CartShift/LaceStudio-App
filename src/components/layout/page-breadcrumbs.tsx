"use client";

import { Fragment, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useBreadcrumb } from "@/components/providers/breadcrumb-provider";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { cn } from "@/lib/cn";

export function PageBreadcrumbs({ className }: { className?: string }) {
	const pathname = usePathname();
	const { segmentTitles } = useBreadcrumb();
	const mounted = useSyncExternalStore(
		() => () => {},
		() => true,
		() => false
	);
	const safeSegmentTitles = segmentTitles ?? {};
	const segments = pathname.split("/").filter(Boolean);
	const breadcrumbs = segments.map((token, index) => {
		const title = safeSegmentTitles[index];
		const fallbackTitle = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(token)
			? "Details"
			: token
			.split("-")
			.map(word => (word[0]?.toUpperCase() ?? "") + word.slice(1))
			.join(" ");

		return {
			title: title ?? fallbackTitle,
			href: `/${segments.slice(0, index + 1).join("/")}`
		};
	});
	const fallbackLabel = breadcrumbs.map(breadcrumb => breadcrumb.title).join(" / ") || "Dashboard";

	if (!mounted) {
		return (
			<p suppressHydrationWarning className={cn("font-subheader text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70", className)}>
				{fallbackLabel}
			</p>
		);
	}

	return (
		<Breadcrumb className={className}>
			<BreadcrumbList className="gap-1.5 font-subheader text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
				{breadcrumbs.length === 0 ? (
					<BreadcrumbItem>
						<BreadcrumbPage className="font-subheader text-[10px] uppercase tracking-[0.18em] text-foreground">Dashboard</BreadcrumbPage>
					</BreadcrumbItem>
				) : (
					breadcrumbs.map((breadcrumb, index) => {
						const isLast = index === breadcrumbs.length - 1;
						return (
							<Fragment key={breadcrumb.href}>
								<BreadcrumbItem className="max-w-[20rem] min-w-0">
									{isLast ? (
										<BreadcrumbPage className="truncate font-subheader text-[10px] uppercase tracking-[0.18em] text-foreground">
											{breadcrumb.title}
										</BreadcrumbPage>
									) : (
										<BreadcrumbLink asChild className="truncate text-muted-foreground/78 transition-colors hover:text-foreground">
											<Link href={breadcrumb.href}>{breadcrumb.title}</Link>
										</BreadcrumbLink>
									)}
								</BreadcrumbItem>
								{!isLast ? <BreadcrumbSeparator className="text-muted-foreground/45" /> : null}
							</Fragment>
						);
					})
				)}
			</BreadcrumbList>
		</Breadcrumb>
	);
}
