import { test, expect } from "@playwright/test";

test("login screen renders without crashing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Near Expiry Monitor" })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByPlaceholder("123456")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
