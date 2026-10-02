// Local API token + Content-Security-Policy, in a real browser against the
// real server (docs/api_auth.md). The token is traded for an HttpOnly cookie
// by the launch URL; the CSP must let the app load, plot, and typeset an
// equation with NO `securitypolicyviolation` event.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, launchPath, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

/** Record every CSP violation from the first byte of every document. */
async function recordViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      w.__csp.push(`${e.effectiveDirective} blocked ${e.blockedURI || "inline"} (${e.sourceFile}:${e.lineNumber})`);
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test.describe("API token + CSP", () => {
  test("the index without the launch token is a locked page", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBe(401);
    await expect(page.getByText("needs its launch link")).toBeVisible();
    expect(await page.context().cookies()).toEqual([]);
  });

  test("the launch URL sets an HttpOnly Strict cookie and leaves the address bar", async ({ page }) => {
    const res = await page.goto(launchPath());
    expect(res?.headers()["content-security-policy"]).toContain("script-src 'self'");
    await page.waitForURL((u) => u.search === "?harness");
    await expect(page.locator(".qzk-library")).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
    expect(cookies[0].name).toMatch(/^qz_token_\d+$/);
    // the page's own API calls carry it; a script cannot read it
    expect(await page.evaluate(() => document.cookie)).toBe("");
    const status = await page.evaluate(async () => (await fetch("/api/fitting/models")).status);
    expect(status).toBe(200);
  });

  test("a launch URL opened from another site still lands on the app", async ({ page, baseURL }) => {
    // The Tauri splash (tauri.localhost) navigates to the launch URL: a
    // cross-site start, whose redirect chain would get no Strict cookie.
    const own = new URL(launchPath(), baseURL);
    await page.goto(new URL("/loading.html", own.origin.replace("127.0.0.1", "localhost")).href);
    await page.evaluate((u) => {
      window.location.href = u;
    }, own.href);
    await page.waitForURL((u) => u.hostname === "127.0.0.1" && u.search === "?harness");
    await expect(page.locator(".qzk-library")).toBeVisible();
  });

  test("load, import, plot and typeset with no CSP violation", async ({ page }) => {
    const violations = await recordViolations(page);
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);
    await expect(page.locator(".u-over").first()).toBeVisible();

    await runPaletteCommand(page, "Curve fit…");
    const panel = page.locator(".qzk-win").filter({ has: page.getByText("Curve Fit", { exact: true }) });
    await panel.locator("select").first().selectOption({ label: "Custom equation…" });
    await panel.getByRole("textbox", { name: "Equation" }).fill("m*x + b");
    await expect(panel.locator(".katex").first()).toBeVisible({ timeout: 10_000 });

    expect(await violations()).toEqual([]);
  });
});
