import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

async function main() {
  const baseUrl = process.env.SCREENSHOT_BASE_URL ?? "http://localhost:3000";
  const outputDir = join(process.cwd(), "docs", "screenshots");

  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  console.log(`Navigating to ${baseUrl}`);
  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000); // Let async UI settle before capturing.
    await page.screenshot({ path: join(outputDir, "home.png"), fullPage: true });

    await page.goto(`${baseUrl}/models`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(outputDir, "models.png"), fullPage: true });

    const buttons = await page.$$eval("button", (elements) =>
      elements.map((element) => ({ text: element.innerText, class: element.className }))
    );
    console.log(JSON.stringify({ buttons }, null, 2));
  } catch (error) {
    console.error("Screenshot capture failed:", error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
