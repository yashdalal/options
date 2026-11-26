import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const [outFile, ...symbols] = process.argv.slice(2);
const side = process.env.SCREENER_SIDE ?? "BOTH";
const spreadMin = process.env.SCREENER_SPREAD ?? "2";
const returnMin = process.env.SCREENER_RETURN ?? "1";

if (!outFile || symbols.length === 0) {
  console.error(
    "Usage: BASE_URL=... node scripts/capture-screener-run.mjs <out.jpg> <SYMBOL> [SYMBOL...]",
  );
  process.exit(1);
}

await mkdir(path.dirname(outFile), { recursive: true });

const videoDir = process.env.CAPTURE_VIDEO_DIR;
const viewport = { width: 1440, height: 900 };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport,
  ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
});
const page = await context.newPage();

const login = await page.request.post(`${baseURL}/api/auth/login`, { data: {} });
if (!login.ok()) {
  throw new Error(`Demo login failed: ${login.status()} ${await login.text()}`);
}

await page.goto(`${baseURL}/`);
await page.getByRole("tab", { name: "Options Screener" }).click();
const search = page.getByPlaceholder("Search and add…");
await search.waitFor({ state: "visible", timeout: 30_000 });
for (const symbol of symbols) {
  await search.fill(symbol);
  await page.getByRole("option", { name: new RegExp(`^${symbol}`) }).first().click();
}
await page.locator("label", { hasText: "Side" }).locator("select").selectOption(side);
await page.locator("label", { hasText: "Min spread %" }).locator("input").fill(spreadMin);
await page.locator("label", { hasText: "Min return % p.a." }).locator("input").fill(returnMin);
await page.getByRole("button", { name: "Run screener" }).click();
await page.getByText("Completed", { exact: true }).waitFor({ timeout: 60_000 });

const statusLine = await page
  .getByText(/Screener took/)
  .first()
  .innerText()
  .catch(() => "(no status line)");
console.log(statusLine);

await page.screenshot({ path: outFile, type: "jpeg", quality: 80 });
console.log(outFile);
await context.close();
if (videoDir) {
  console.log(await page.video()?.path());
}
await browser.close();
