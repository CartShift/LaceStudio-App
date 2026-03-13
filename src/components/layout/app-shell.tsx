"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Bot, ChevronDown, Circle, LayoutDashboard, Menu, Megaphone, Monitor, Send, Settings2, Shield, Users, Wallet, X, type LucideIcon } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { navSectionsForRole } from "@/components/layout/nav-config";
import { RoleSwitcher } from "@/components/layout/role-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { MeshRibbon } from "@/components/brand/mesh-ribbon";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { AppRole } from "@/lib/auth";

type AppShellProps = {
	role: AppRole;
	showRoleSwitcher?: boolean;
	children: React.ReactNode;
};

type SidebarContentProps = {
	role: AppRole;
	showRoleSwitcher: boolean;
	pathname: string;
	sections: ReturnType<typeof navSectionsForRole>;
	collapsedSections: Record<string, boolean>;
	setCollapsedSections: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
	headerAction: React.ReactNode;
	onNavigate?: () => void;
};

const NAV_ITEM_ICONS: Record<string, LucideIcon> = {
	"/dashboard": LayoutDashboard,
	"/models": Bot,
	"/campaigns": Megaphone,
	"/publish": Send,
	"/analytics": BarChart3,
	"/client/dashboard": Monitor,
	"/clients": Users,
	"/revenue": Wallet,
	"/settings": Settings2,
	"/audit": Shield
};

function SidebarContent({ role, showRoleSwitcher, pathname, sections, collapsedSections, setCollapsedSections, headerAction, onNavigate }: SidebarContentProps) {
	return (
		<>
			<div aria-hidden className="pointer-events-none absolute inset-x-0 -top-20 h-40 bg-[radial-gradient(circle_at_20%_0%,color-mix(in_oklab,var(--primary),transparent_92%),transparent_70%)]" />
			<div
				aria-hidden
				className="pointer-events-none absolute inset-y-6 -right-8 w-24 rounded-full bg-[radial-gradient(circle,color-mix(in_oklab,var(--accent),transparent_72%)_0%,transparent_72%)] opacity-80 blur-2xl"
			/>
			<div className="relative mb-3 flex items-start justify-between gap-3">
				<div className="space-y-2">
					<div className="space-y-0.5">
						<p className="font-display text-lg font-bold tracking-tight">LaceStudio</p>
						<p className="text-[11px] text-muted-foreground">Fashion campaign studio</p>
					</div>
					{showRoleSwitcher ? <RoleSwitcher role={role} /> : null}
				</div>
				{headerAction}
			</div>

			<div className="relative min-h-0 flex-1 overflow-hidden">
				<nav className="h-full overflow-y-auto overscroll-contain pr-0.5" aria-label="Primary navigation">
					<div className="space-y-2">
						{sections.map(section => {
							const hasActiveItem = section.items.some(item => pathname === item.href || pathname.startsWith(`${item.href}/`));
							const isCollapsed = hasActiveItem ? false : (collapsedSections[section.key] ?? true);

							return (
								<section key={section.key} className="space-y-1">
									<button
										type="button"
										aria-expanded={!isCollapsed}
										aria-controls={`nav-section-${section.key}`}
										className="flex w-full items-center justify-between rounded-lg border border-transparent px-2.5 py-1.5 text-left transition duration-200 hover:border-[color:color-mix(in_oklab,var(--foreground),transparent_92%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_90%)]"
										onClick={() =>
											setCollapsedSections(current => ({
												...current,
												[section.key]: !(current[section.key] ?? true)
											}))
										}>
										<span className="font-subheader text-[9px] text-muted-foreground/80">{section.label}</span>
										<ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform duration-200", isCollapsed ? "-rotate-90" : "rotate-0")} />
									</button>

									<div
										id={`nav-section-${section.key}`}
										className={cn("grid transition-[grid-template-rows,opacity] duration-200", isCollapsed ? "grid-rows-[0fr] opacity-75" : "grid-rows-[1fr] opacity-100")}>
										<div className="overflow-hidden">
											<div className="space-y-1 pt-0.5">
												{section.items.map(item => {
													const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
													const ItemIcon = NAV_ITEM_ICONS[item.href] ?? Circle;

													return (
														<Link
															key={item.href}
															href={item.href}
															onClick={onNavigate}
															className={cn(
																"group flex items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-[13px] font-medium transition duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
																active
																	? "border-[color:color-mix(in_oklab,var(--primary),transparent_64%)] bg-[linear-gradient(155deg,color-mix(in_oklab,var(--primary),transparent_88%),color-mix(in_oklab,var(--card),transparent_4%))] text-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,var(--card),white_28%)]"
																	: "text-muted-foreground hover:-translate-y-[1px] hover:border-[color:color-mix(in_oklab,var(--foreground),transparent_92%)] hover:bg-[color:color-mix(in_oklab,var(--accent),transparent_90%)] hover:text-foreground"
															)}>
															<ItemIcon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground/90 group-hover:text-foreground")} />
															<span className="truncate">{item.label}</span>
															{active ? <span aria-hidden className="ml-auto h-1.5 w-1.5 rounded-full bg-primary/80 shadow-[0_0_0_4px_color-mix(in_oklab,var(--primary),transparent_92%)]" /> : null}
														</Link>
													);
												})}
											</div>
										</div>
									</div>
								</section>
							);
						})}
					</div>
				</nav>
			</div>

			<div className="relative mt-2 border-t border-border/40 pt-2">
				<div className="rounded-xl border border-border/50 bg-[color:color-mix(in_oklab,var(--card),transparent_10%)] px-2 py-1.5 shadow-[var(--shadow-inner)]">
					<div className="flex items-center justify-between gap-2">
						<span className="text-[10px] text-muted-foreground/60">v0.1.0</span>
						<kbd className="rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground/60">Ctrl K</kbd>
					</div>
				</div>
			</div>
		</>
	);
}

export function AppShell({ role, showRoleSwitcher = false, children }: AppShellProps) {
	const pathname = usePathname();
	const sections = navSectionsForRole(role);
	const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
	const [mobileNavOpen, setMobileNavOpen] = useState(false);

	useEffect(() => {
		if (!mobileNavOpen) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";

		return () => {
			document.body.style.overflow = previousOverflow;
		};
	}, [mobileNavOpen]);

	useEffect(() => {
		if (!mobileNavOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setMobileNavOpen(false);
			}
		};

		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [mobileNavOpen]);

	return (
		<div className="relative min-h-screen bg-background text-foreground">
			<MeshRibbon />
			<div className="mx-auto w-full max-w-[1680px] p-4 md:p-6">
				<div className="sticky top-4 z-40 mb-4 md:hidden">
					<div className="ds-panel flex items-center justify-between gap-3 rounded-2xl p-3">
						<div className="min-w-0">
							<p className="font-display text-base font-bold tracking-tight">LaceStudio</p>
							<p className="text-[11px] text-muted-foreground">Fashion campaign studio</p>
						</div>
						<div className="flex items-center gap-2">
							<ThemeToggle />
							<Button
								variant="outline"
								size="icon-sm"
								type="button"
								aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
								aria-controls="mobile-navigation"
								aria-expanded={mobileNavOpen}
								onClick={() => setMobileNavOpen(current => !current)}>
								{mobileNavOpen ? <X className="h-3.5 w-3.5" /> : <Menu className="h-3.5 w-3.5" />}
							</Button>
						</div>
					</div>
				</div>

				<div className={cn("fixed inset-0 z-50 md:hidden", mobileNavOpen ? "pointer-events-auto" : "pointer-events-none")} aria-hidden={!mobileNavOpen}>
					<button
						type="button"
						aria-label="Dismiss navigation"
						className={cn(
							"absolute inset-0 bg-[color:color-mix(in_oklab,var(--foreground),transparent_72%)] backdrop-blur-sm transition-opacity duration-200",
							mobileNavOpen ? "opacity-100" : "opacity-0"
						)}
						onClick={() => setMobileNavOpen(false)}
					/>
					<aside
						id="mobile-navigation"
						className={cn(
							"absolute inset-y-0 left-0 w-[min(88vw,320px)] p-3 transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
							mobileNavOpen ? "translate-x-0" : "-translate-x-full"
						)}>
						<div className="ds-panel relative flex h-full flex-col overflow-hidden rounded-2xl p-3.5">
							<SidebarContent
								role={role}
								showRoleSwitcher={showRoleSwitcher}
								pathname={pathname}
								sections={sections}
								collapsedSections={collapsedSections}
								setCollapsedSections={setCollapsedSections}
								onNavigate={() => setMobileNavOpen(false)}
								headerAction={
									<Button variant="outline" size="icon-sm" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}>
										<X className="h-3.5 w-3.5" />
									</Button>
								}
							/>
						</div>
					</aside>
				</div>

				<div className="grid min-w-0 items-start gap-6 md:grid-cols-[264px_minmax(0,1fr)] xl:gap-7">
					<aside className="ds-panel relative max-md:hidden flex flex-col overflow-hidden rounded-2xl p-3.5 md:sticky md:top-6 md:h-[calc(100dvh-3rem)] md:max-h-[calc(100dvh-3rem)] md:self-start">
						<SidebarContent
							role={role}
							showRoleSwitcher={showRoleSwitcher}
							pathname={pathname}
							sections={sections}
							collapsedSections={collapsedSections}
							setCollapsedSections={setCollapsedSections}
							headerAction={<ThemeToggle />}
						/>
					</aside>

					<div className="min-w-0 space-y-4 md:space-y-5">
						<Suspense fallback={null}>
							<main className="min-h-[70vh] min-w-0">{children}</main>
						</Suspense>
					</div>
				</div>
			</div>
		</div>
	);
}
