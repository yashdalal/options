import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2];
const scene = process.argv[3] ?? "all";

if (!outDir) {
  console.error("Usage: node scripts/capture-pr-evidence.mjs <outDir> [scene]");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

async function ensureAuth() {
  await page.goto(`${baseURL}/`);
  const status = await page.request.get(`${baseURL}/api/auth/status`);
  const payload = await status.json();
  if (payload.authenticated) {
    await page.goto(`${baseURL}/`);
    return;
  }
  const login = await page.request.post(`${baseURL}/api/auth/login`, {
    data: {},
  });
  if (!login.ok()) {
    throw new Error(`Demo login failed: ${login.status()} ${await login.text()}`);
  }
  await page.goto(`${baseURL}/`);
  await page.getByRole("tab", { name: "Near Expiry" }).waitFor({ timeout: 20_000 });
}

async function shot(name, locator) {
  const file = path.join(outDir, `${name}.png`);
  if (locator) {
    await locator.screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: false });
  }
  console.log(file);
}

await ensureAuth();

if (scene === "all" || scene === "monitor") {
  await page.getByRole("tab", { name: "Near Expiry" }).click();
  await page.getByRole("heading", { name: "Near Expiry Monitor" }).waitFor();
  await page.getByText(/Positions:/).waitFor({ timeout: 30_000 });
  await shot("monitor-header", page.locator("header").first());
  await shot(
    "monitor-status",
    page.locator("div").filter({ hasText: /Positions:/ }).filter({ hasText: /Prakash|Gopa|HUF/ }).first(),
  );
  await shot("monitor-viewport");
}

if (scene === "all" || scene === "screener") {
  await page.getByRole("tab", { name: "Options Screener" }).click();
  await page.getByRole("heading", { name: "Options Screener" }).waitFor();
  await shot(
    "screener-header",
    page.locator("header").filter({ hasText: "How it works" }).first(),
  );
  await shot("screener-nav", page.locator("header").filter({ hasText: "Logout" }).first());
  await shot("screener-viewport");
}

if (scene === "basket") {
  await page.getByRole("tab", { name: "Options Screener" }).click();
  await page.getByRole("heading", { name: "Options Screener" }).waitFor();
  // Caller should leave basket open; capture tray if present.
  const tray = page.getByRole("complementary").or(page.locator("aside")).first();
  if (await tray.count()) {
    await shot("basket-tray", tray);
  }
  await shot("screener-with-basket");
}

if (scene === "screener-results") {
  await page.getByRole("tab", { name: "Options Screener" }).click();
  await page.getByRole("heading", { name: "Options Screener" }).waitFor();
  await shot("screener-results");
}

if (scene === "details") {
  await page.getByRole("tab", { name: "Options Screener" }).click();
  await page.getByText("Board meeting").first().waitFor({ timeout: 60_000 });
  await shot("details-board-meeting", page.locator("tr").filter({ hasText: "Board meeting" }).first());
  await shot("details-viewport");
}

await browser.close();
