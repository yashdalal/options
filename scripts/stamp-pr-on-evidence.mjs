import { chromium } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

const prLabel = process.argv[2];
const evidenceDir = process.argv[3];

if (!prLabel || !evidenceDir) {
  console.error("Usage: node scripts/stamp-pr-on-evidence.mjs <PR #N> <evidenceDir>");
  process.exit(1);
}

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (/\.(jpg|jpeg)$/i.test(entry.name) && !entry.name.includes("-pr.")) {
      files.push(full);
    }
  }
  return files;
}

const files = await walk(evidenceDir);
const browser = await chromium.launch({ headless: true });

for (const file of files) {
  const bytes = await readFile(file);
  const b64 = bytes.toString("base64");
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html>
<html><body style="margin:0;background:#111">
  <img id="shot" src="data:image/jpeg;base64,${b64}" style="display:block;width:100%;height:auto" />
</body></html>`);
  await page.locator("#shot").waitFor({ state: "visible" });
  const box = await page.locator("#shot").boundingBox();
  if (box) {
    await page.setViewportSize({
      width: Math.max(1, Math.ceil(box.width)),
      height: Math.max(1, Math.ceil(box.height)),
    });
  }
  await page.evaluate((label) => {
    const badge = document.createElement("div");
    badge.textContent = label;
    badge.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:999999;background:#18181b;color:#fafafa;padding:6px 10px;border-radius:6px;font:600 12px/1.2 ui-sans-serif,system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.35)";
    document.body.appendChild(badge);
  }, prLabel);
  const stampedPng = file.replace(/\.(jpg|jpeg)$/i, "-pr.png");
  await page.screenshot({ path: stampedPng, fullPage: true });
  const stampedJpg = stampedPng.replace(/\.png$/i, ".jpg");
  execFileSync("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "55",
    stampedPng,
    "--out",
    stampedJpg,
  ]);
  execFileSync("rm", ["-f", stampedPng]);
  console.log(stampedJpg);
  await page.close();
}

await browser.close();
