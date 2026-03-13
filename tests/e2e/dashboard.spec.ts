import { expect, test, type Page } from "@playwright/test";

async function gotoRoute(page: Page, route: string) {
  await page.goto(route, { waitUntil: "domcontentloaded", timeout: 60_000 });
}

test("dashboard loads", async ({ page }) => {
  await gotoRoute(page, "/dashboard");
  await expect(page.getByRole("heading", { name: /Next actions/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Shortcuts/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Pipeline/i })).toBeVisible();
});

test("campaign creation page shows quick-start setup", async ({ page }) => {
  await gotoRoute(page, "/campaigns/new");
  await expect(page.getByRole("heading", { name: /New Campaign/i })).toBeVisible();
  await expect(page.getByLabel("Campaign Name")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create & Open Workspace" })).toBeVisible();
});

test("publish page shows timezone guidance", async ({ page }) => {
  await gotoRoute(page, "/publish");
  await expect(page.getByRole("heading", { name: "Publishing" })).toBeVisible();
  await expect(page.getByText(/Timezone:/)).toBeVisible();
});

test("model wizard requires a model name before creating draft", async ({ page }) => {
  await gotoRoute(page, "/models/new");
  await expect(page.getByRole("heading", { name: "Model Setup" })).toBeVisible();

  await page.getByRole("button", { name: "Start Setup" }).click();
  await expect(page.locator("#wizard-model-name-error")).toBeVisible();
});

test("api validation errors include request id and issue details", async ({ request }) => {
  const response = await request.post("/api/models", {
    data: {},
  });

  expect(response.status()).toBe(400);
  const payload = (await response.json()) as {
    error?: {
      request_id?: string;
      details?: {
        scope?: string;
        issues?: Array<{ path: string; message: string; code: string }>;
      };
    };
  };

  expect(payload.error?.request_id).toBeTruthy();
  expect(payload.error?.details?.scope).toBe("payload");
  expect(payload.error?.details?.issues?.length).toBeGreaterThan(0);
});
