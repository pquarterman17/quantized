// Owner decision 2026-11-26: the window layout is the DEFAULT. A profile that never chose a layout gets
// it; a user who chose the classic layout keeps it across a reload; the classic layout stays reachable.

import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

type Qz = { __qz: { useApp: { getState: () => { setLayoutMode: (m: "classic" | "windows") => Promise<string> } } } };

test("a fresh profile starts in the window layout", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".qzk-wl")).toBeVisible();
  await expect(page.locator(".qzk-inspector")).toHaveCount(0);
});

test("an explicit classic choice is kept across a reload, and the window layout comes back on request", async ({ page }) => {
  // Keep this page's choice out of the server's prefs file (it would reach every other spec's profile).
  await page.route("**/api/prefs", (route) => route.abort());
  await gotoApp(page);
  await expect(page.locator(".qzk-wl")).toBeVisible();
  await page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().setLayoutMode("classic"));
  await expect(page.locator(".qzk-inspector")).toBeVisible();
  await expect(page.locator(".qzk-wl")).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".qzk-inspector")).toBeVisible();
  await expect(page.locator(".qzk-wl")).toHaveCount(0);

  await page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().setLayoutMode("windows"));
  await expect(page.locator(".qzk-wl")).toBeVisible();
  await page.reload();
  await expect(page.locator(".qzk-wl")).toBeVisible();
});
