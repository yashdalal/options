import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2];

if (!outDir) {
  console.error("Usage: node scripts/capture-basket-evidence.mjs <outDir>");
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
  if (!payload.authenticated) {
    const login = await page.request.post(`${baseURL}/api/auth/login`, { data: {} });
    if (!login.ok()) {
      throw new Error(`Demo login failed: ${login.status()}`);
    }
  }
  await page.goto(`${baseURL}/`);
  await page.getByRole("tab", { name: "Options Screener" }).waitFor({ timeout: 20_000 });
}

async function addCompany(symbol) {
  const input = page.getByPlaceholder(/Search and add/);
  await input.click();
  await input.fill(symbol);
  await page.getByRole("option", { name: new RegExp(`^${symbol}`, "i") }).first().click();
}

await ensureAuth();
await page.getByRole("tab", { name: "Options Screener" }).click();
await page.getByRole("heading", { name: "Options Screener" }).waitFor();
await page.getByPlaceholder(/Search and add/).waitFor({ timeout: 60_000 });

for (const symbol of ["BOSCHLTD", "ASHOKLEY"]) {
  const chip = page.getByRole("button", { name: new RegExp(`Remove ${symbol}`, "i") });
  if (await chip.count()) {
    await chip.click();
  }
}

await addCompany("BOSCHLTD");
await addCompany("ASHOKLEY");

await page.getByLabel(/Min spread/).fill("1");
await page.getByLabel(/Min return/).fill("1");
await page.getByLabel(/^Lots$/).fill("1");

await page.getByRole("button", { name: "Run screener" }).click();
await page
  .getByRole("button", { name: "Add" })
  .or(page.getByText(/No options meet/))
  .first()
  .waitFor({ timeout: 120_000 });
if ((await page.getByRole("button", { name: "Add" }).count()) === 0) {
  await page.screenshot({ path: path.join(outDir, "debug-no-rows.png"), fullPage: true });
  throw new Error("Screener produced no Add buttons");
}

const addButtons = page.getByRole("button", { name: "Add" });
const count = await addButtons.count();
for (let i = 0; i < Math.min(count, 4); i += 1) {
  await addButtons.nth(i).click();
}

await page.getByRole("heading", { name: "Basket" }).waitFor({ timeout: 15_000 });
const tray = page.locator("aside").filter({ hasText: "Basket" });
await tray.screenshot({ path: path.join(outDir, "basket-tray.png") });
await page.screenshot({ path: path.join(outDir, "screener-with-basket.png") });
console.log(path.join(outDir, "basket-tray.png"));
console.log(path.join(outDir, "screener-with-basket.png"));

await browser.close();
