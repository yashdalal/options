import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const outDir = process.argv[2];

if (!outDir) {
  console.error("Usage: node scripts/capture-board-meeting-evidence.mjs <outDir>");
  process.exit(1);
}

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
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
await page.getByPlaceholder(/Search and add/).waitFor({ timeout: 60_000 });

for (const symbol of ["ASHOKLEY", "SBIN"]) {
  const chip = page.getByRole("button", { name: new RegExp(`Remove ${symbol}`, "i") });
  if (await chip.count()) {
    await chip.click();
  }
}

await addCompany("ASHOKLEY");
await addCompany("SBIN");
await page.getByLabel(/Min spread/).fill("1");
await page.getByLabel(/Min return/).fill("1");
await page.getByRole("button", { name: "Run screener" }).click();
await page.getByRole("button", { name: "Details" }).first().waitFor({ timeout: 120_000 });

// Open Details on the first ASHOKLEY row (no upcoming meeting in demo).
const ashokDetails = page
  .locator("tr")
  .filter({ hasText: "ASHOKLEY" })
  .getByRole("button", { name: "Details" })
  .first();
await ashokDetails.click();
await page.getByText("Board meeting").first().waitFor();

const detailsRow = page.locator("tr").filter({ hasText: "Board meeting" }).first();
await detailsRow.screenshot({ path: path.join(outDir, "ashokley-details.png") });
await page.screenshot({ path: path.join(outDir, "viewport.png") });

for (const name of ["ashokley-details", "viewport"]) {
  const png = path.join(outDir, `${name}.png`);
  const jpg = path.join(outDir, `${name}.jpg`);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "55", png, "--out", jpg]);
  console.log(jpg);
}

await browser.close();
