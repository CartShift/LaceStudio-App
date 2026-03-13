import { expect, test, type Page } from "@playwright/test";

async function gotoRoute(page: Page, route: string) {
	await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

test("model wizard page loads", async ({ page }) => {
	await gotoRoute(page, "/models/new");
	await expect(page.getByRole("heading", { name: "Model Setup" })).toBeVisible();
});

test("model wizard requires a name before submitting", async ({ page }) => {
	await gotoRoute(page, "/models/new");

	const createBtn = page.getByRole("button", { name: "Start Setup" });
	await createBtn.click();

	// Error element should appear
	await expect(page.locator("#wizard-model-name-error")).toBeVisible();
});

test("model wizard name field accepts input", async ({ page }) => {
	await gotoRoute(page, "/models/new");

	const nameInput = page.getByLabel("Model Name");
	await nameInput.fill("Test Model Alpha");
	await expect(nameInput).toHaveValue("Test Model Alpha");
});

test("model list page loads and shows models header", async ({ page }) => {
	await gotoRoute(page, "/models");
	await expect(page.getByRole("heading", { name: /Models/i })).toBeVisible();
});
