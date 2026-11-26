// An undocked (floating) Data window in the window layout resizes from every edge and
// corner, never past the viewport, with no dead zone after hitting the cap, and keeps its
// size across a reload. The bug: one 14 px bottom-right grip, and a drag past the CSS cap
// stored a size larger than the screen, so the next drags (up or in) did nothing.

import { expect, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, restoreLastSession, waitForDatasetCount } from "../utils/harness";

type Qz = { __qz: { useApp: { getState: () => { setPref: (k: string, v: string) => void } } } };
type Rect = { x: number; y: number; w: number; h: number };

async function floatData(page: Page) {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.locator("[data-ds-id]").first().click();
  await page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().setPref("layoutMode", "windows"));
  await expect(page.locator(".qzk-wl-desk")).toBeVisible();
  await page.locator('[data-wl-toggle="data"]').click();
  const docked = page.locator('[data-wl-window="data"]');
  // Wide screens open it docked (undock with the pressed dock button); narrow ones float it already.
  if (await docked.count()) await docked.locator('button[aria-pressed="true"]').click();
  const win = page.locator('[data-tool-window="data"]');
  await expect(win).toBeVisible();
  return win;
}

const rect = (win: ReturnType<Page["locator"]>): Promise<Rect> =>
  win.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });

async function drag(page: Page, win: ReturnType<Page["locator"]>, edge: string, dx: number, dy: number) {
  const b = (await win.locator(`[data-resize-edge="${edge}"]`).boundingBox())!;
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

for (const size of [
  { width: 1440, height: 900 },
  { width: 1024, height: 700 },
]) {
  test.describe(`undocked Data window resize at ${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test("resizes from every edge and corner, clamped to the viewport", async ({ page }) => {
      const win = await floatData(page);
      // Start from a known mid-screen box so every handle has room both ways.
      await page.evaluate(() =>
        (window as unknown as { __qz: { useApp: { getState: () => { setToolWindowLayout: (id: string, l: object) => void } } } }).__qz.useApp
          .getState()
          .setToolWindowLayout("data", { x: 300, y: 150, width: 400, height: 350, collapsed: false }),
      );
      await expect.poll(() => rect(win)).toMatchObject({ x: 300, y: 150, w: 400, h: 350 });

      await drag(page, win, "e", 40, 0);
      expect(await rect(win)).toMatchObject({ x: 300, w: 440, h: 350 });
      await drag(page, win, "s", 0, 30);
      expect(await rect(win)).toMatchObject({ y: 150, w: 440, h: 380 });
      await drag(page, win, "w", -30, 0);
      expect(await rect(win)).toMatchObject({ x: 270, w: 470 });
      await drag(page, win, "n", 0, -20);
      expect(await rect(win)).toMatchObject({ y: 130, h: 400 });
      const before = await rect(win);
      await drag(page, win, "nw", -20, -10);
      expect(await rect(win)).toMatchObject({ x: before.x - 20, y: before.y - 10, w: before.w + 20, h: before.h + 10 });
      await drag(page, win, "ne", 20, 10);
      await drag(page, win, "sw", -10, 10);
      await drag(page, win, "se", -10, -10);

      // Past the viewport: clamped, never off-screen or larger than it.
      await drag(page, win, "se", 3000, 3000);
      let r = await rect(win);
      expect(r.x + r.w).toBeLessThanOrEqual(size.width);
      expect(r.y + r.h).toBeLessThanOrEqual(size.height - 24);
      // No dead zone: pulling back immediately shrinks it.
      await drag(page, win, "se", -80, -80);
      const shrunk = await rect(win);
      expect(shrunk.w).toBeLessThan(r.w);
      expect(shrunk.h).toBeLessThan(r.h);
      // Below the minimum: stops at it, grip still on screen.
      await drag(page, win, "se", -3000, -3000);
      r = await rect(win);
      expect(r.w).toBeGreaterThanOrEqual(200);
      expect(r.h).toBeGreaterThanOrEqual(120);
      // At the floor the title bar is whole (Close and the collapse chevron inside the frame) and the body scrolls.
      for (const name of ["Close Data", "Collapse"]) {
        const btn = win.getByRole("button", { name, exact: true });
        if (await btn.count()) expect((await btn.boundingBox())!.x + (await btn.boundingBox())!.width, name).toBeLessThanOrEqual(r.x + r.w);
      }
      expect(await win.locator(".qzk-win-body").evaluate((e) => getComputedStyle(e).overflowY)).toBe("auto");
      // Outwards past the top-left: stops at the left edge and the desk top, the window stays on screen.
      await drag(page, win, "nw", -3000, -3000);
      r = await rect(win);
      expect(r.x).toBe(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeLessThan(150);
    });

    test("keeps its size across a reload and a close and reopen", async ({ page }) => {
      const win = await floatData(page);
      await drag(page, win, "se", 80, 40);
      await drag(page, win, "w", -40, 0);
      const set = await rect(win);
      await page.locator('[data-wl-toggle="data"]').click();
      await expect(win).toHaveCount(0);
      await page.locator('[data-wl-toggle="data"]').click();
      await expect(win).toBeVisible();
      expect(await rect(win)).toEqual(set);
      await page.reload();
      // Floating-window geometry is project state: it is saved in the .dwk
      // (toolWindowLayout, via workspaceSerialize) and comes back only through
      // session hydration. The launch shows the welcome screen, so Restore it.
      // At 1024x700 the default-placed floating Data window sits over the
      // card's button, so the shared helper's pointer click is intercepted:
      // activate it from the keyboard instead.
      const restore = page.getByRole("button", { name: /Restore last session/ });
      await restore.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".qzk-library")).toBeVisible();
      // Owner decision 2026-11-26 (#1033): startup shows the welcome screen; restore the session first.
      await restoreLastSession(page);
      await expect(win).toBeVisible();
      expect(await rect(win)).toEqual(set);
    });
  });
}
