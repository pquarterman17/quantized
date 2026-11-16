// UX-G1: the first-run theme follows the OS (prefers-color-scheme), an explicit
// choice is kept across a reload, and the first-launch onboarding help is
// readable (UI font, wrapped, not clipped to one line).

import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

const theme = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);

test.describe("OS light", () => {
  test.use({ colorScheme: "light" });

  test("first run opens light, and an explicit Dark pick survives a reload", async ({ page }) => {
    await gotoApp(page);
    expect(await theme(page)).toBe("light");

    await page.evaluate(() =>
      (window as unknown as { __qz: { useApp: { getState: () => { setTheme: (t: string) => void } } } }).__qz.useApp.getState().setTheme("dark"),
    );
    expect(await theme(page)).toBe("dark");
    await page.reload();
    await page.locator(".qzk-main").waitFor();
    expect(await theme(page)).toBe("dark");
  });
});

test.describe("OS dark", () => {
  test.use({ colorScheme: "dark" });

  test("first run opens dark; the onboarding help wraps in the UI font instead of truncating", async ({ page }) => {
    await gotoApp(page);
    expect(await theme(page)).toBe("dark");
    const help = page.getByText("Drop files anywhere here.");
    await expect(help).toBeVisible();
    const m = await help.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        wraps: cs.whiteSpace !== "nowrap",
        ui: !cs.fontFamily.includes("JetBrains"),
        clipped: el.scrollWidth > el.clientWidth + 1,
        px: parseFloat(cs.fontSize),
      };
    });
    expect(m).toEqual({ wraps: true, ui: true, clipped: false, px: expect.any(Number) });
    expect(m.px).toBeGreaterThanOrEqual(12);
  });
});
