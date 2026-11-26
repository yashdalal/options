import { test, expect } from "@playwright/test";

const demoMode = ["1", "true", "yes"].includes(
  (process.env.DEMO_MODE ?? "").trim().toLowerCase(),
);

test("login screen renders without crashing", async ({ page }) => {
  test.skip(demoMode, "Demo mode auto-connects and skips the login screen");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Near Expiry Monitor" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByLabel("Prakash")).toBeVisible();
  await expect(page.getByLabel("Gopa")).toBeVisible();
  await expect(page.getByLabel("HUF")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Prakash" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Gopa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect HUF" })).toBeVisible();
});
