import type { AppRole } from "@/lib/auth";

export type NavItem = {
  label: string;
  href: string;
  roles: AppRole[];
};

export type NavSection = {
  key: "create" | "produce" | "publish" | "analyze" | "business" | "admin";
  label: string;
  items: NavItem[];
};

export const NAV_SECTIONS: NavSection[] = [
  {
    key: "create",
    label: "Plan",
    items: [
      { label: "Dashboard", href: "/dashboard", roles: ["admin", "operator", "client"] },
      { label: "Models", href: "/models", roles: ["admin", "operator"] },
    ],
  },
  {
    key: "produce",
    label: "Create",
    items: [
      { label: "Campaigns", href: "/campaigns", roles: ["admin", "operator"] },
    ],
  },
  {
    key: "publish",
    label: "Share",
    items: [{ label: "Publish", href: "/publish", roles: ["admin", "operator"] }],
  },
  {
    key: "analyze",
    label: "Insights",
    items: [
      { label: "Analytics", href: "/analytics", roles: ["admin", "operator", "client"] },
      { label: "Client View", href: "/client/dashboard", roles: ["client"] },
    ],
  },
  {
    key: "business",
    label: "Studio",
    items: [
      { label: "Clients", href: "/clients", roles: ["admin", "operator"] },
      { label: "Revenue", href: "/revenue", roles: ["admin", "operator"] },
    ],
  },
  {
    key: "admin",
    label: "Settings",
    items: [
      { label: "Settings", href: "/settings", roles: ["admin"] },
      { label: "Audit", href: "/audit", roles: ["admin"] },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export function navSectionsForRole(role: AppRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}
