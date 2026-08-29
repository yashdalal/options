import { test, expect } from "@playwright/test";

test("login screen renders without crashing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Near Expiry Monitor" })).toBeVisible({
    timeout: 15_000,
  });

  if (process.env.DEMO_MODE === "1") {
    await expect(page.getByText("Prakash", { exact: true })).toBeVisible();
    await expect(page.getByText("Gopa", { exact: true })).toBeVisible();
    await expect(page.getByText("HUF", { exact: true })).toBeVisible();
    await expect(page.getByText("Used margin: ₹2,86,450.75")).toBeVisible();
    await expect(page.getByText("Used margin: ₹1,94,820.50")).toBeVisible();
    await expect(page.getByText("Used margin: ₹3,51,275.25")).toBeVisible();
    return;
  }

  await expect(page.getByLabel("Prakash")).toBeVisible();
  await expect(page.getByLabel("Gopa")).toBeVisible();
  await expect(page.getByLabel("HUF")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Prakash" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Gopa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect HUF" })).toBeVisible();
});
