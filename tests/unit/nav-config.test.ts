import { describe, expect, it } from "vitest";
import { navSectionsForRole } from "@/components/layout/nav-config";

describe("nav grouping", () => {
  it("returns grouped sections with role-allowed items for admin", () => {
    const sections = navSectionsForRole("admin");
    expect(sections.length).toBeGreaterThan(0);
    expect(sections.some((section) => section.label === "Settings")).toBe(true);
    expect(sections.flatMap((section) => section.items).some((item) => item.href === "/settings")).toBe(true);
  });

  it("hides admin-only items for client role", () => {
    const sections = navSectionsForRole("client");
    const hrefs = sections.flatMap((section) => section.items).map((item) => item.href);
    expect(hrefs.includes("/settings")).toBe(false);
    expect(hrefs.includes("/audit")).toBe(false);
    expect(hrefs.includes("/analytics")).toBe(true);
  });
});
