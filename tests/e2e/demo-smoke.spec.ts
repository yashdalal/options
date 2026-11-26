import { test, expect } from "@playwright/test";

const demoMode = ["1", "true", "yes"].includes(
  (process.env.DEMO_MODE ?? "").trim().toLowerCase(),
);

test.describe("demo mode app smoke", () => {
  test.skip(!demoMode, "Run with DEMO_MODE=1");

  test.beforeEach(async ({ page }) => {
    const login = await page.request.post("/api/auth/login", { data: {} });
    expect(login.ok()).toBe(true);
  });

  test("Near Expiry loads positions for all three accounts", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Near Expiry" }).click();
    await expect(page.getByRole("heading", { name: "Near Expiry Monitor" })).toBeVisible();
    await expect(page.getByText(/Positions:/)).toBeVisible({ timeout: 30_000 });
    for (const account of ["Prakash", "Gopa", "HUF"]) {
      await expect(page.getByText(account).first()).toBeVisible();
    }
  });

  test("Options Screener runs one company to completion", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Options Screener" }).click();
    const search = page.getByPlaceholder("Search and add…");
    await expect(search).toBeEnabled({ timeout: 30_000 });
    await search.fill("SBIN");
    await page.getByRole("option", { name: /SBIN/ }).first().click();
    await page.getByRole("button", { name: "Run screener" }).click();
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByText(/failed:/)).toHaveCount(0);
  });
});
