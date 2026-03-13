import { expect, test, type Page } from "@playwright/test";

async function gotoRoute(page: Page, route: string) {
	await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

test("publish hub page loads", async ({ page }) => {
	await gotoRoute(page, "/publish");
	await expect(page.getByRole("heading", { name: "Publishing" })).toBeVisible();
});

test("publish hub shows timezone guidance", async ({ page }) => {
	await gotoRoute(page, "/publish");
	await expect(page.getByText(/Timezone:/)).toBeVisible();
});

test("publish hub has a schedule button or schedule form", async ({ page }) => {
	await gotoRoute(page, "/publish");
	await expect(page.getByRole("button", { name: "Schedule Post" })).toBeVisible();
});
