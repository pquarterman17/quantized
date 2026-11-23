// UX pass 2, B1: collapsing the Library (Ctrl+B or the title-bar toggle) must give
// its width to the stage and leave the right column alone. The bug was grid
// auto-placement (the hidden Library and the rail both want cell 1/1), which jsdom
// cannot see: the stage / desk was squeezed into a 28 px or 296 px column.
//   - classic layout: the Library takes 0 px and the stage starts at 0;
//   - window layout (preview): the Library leaves a 28 px rail and the desk starts at 28,
//     both reach the right edge of the window.

import { expect, type Page, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

type Qz = { __qz: { useApp: { getState: () => { setPref: (k: string, v: string) => void } } } };

const left = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().left));
const right = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().right));
const width = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => Math.round(e.getBoundingClientRect().width));

async function start(page: Page, windows: boolean): Promise<void> {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("three-channel.csv"));
  await waitForDatasetCount(page, 1);
  await page.locator("[data-ds-id]").first().click();
  if (windows) {
    await page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().setPref("layoutMode", "windows"));
    await expect(page.locator(".qzk-wl-desk")).toBeVisible();
  } else {
    await expect(page.locator(".qzk-stage .u-over")).toBeVisible();
  }
}

for (const windows of [false, true]) {
  for (const size of [
    { width: 1360, height: 900 },
    { width: 1024, height: 768 },
  ]) {
    test(`collapsing the Library gives its width to the ${windows ? "window desk" : "stage"} at ${size.width}px`, async ({ page }) => {
      test.setTimeout(60_000);
      await page.setViewportSize(size);
      await start(page, windows);
      const surface = windows ? ".qzk-wl-desk" : ".qzk-stage";
      const open = await left(page, surface);
      const rightEdge = await right(page, surface);
      expect(open, "Library open").toBeGreaterThan(100);

      for (const how of ["Ctrl+B", "toggle"] as const) {
        if (how === "Ctrl+B") await page.keyboard.press("Control+b");
        else await page.getByRole("button", { name: "Library", exact: true }).first().click();
        // Wait on state: the Library's own width settles at 0 (classic) or the 28 px rail (windows).
        await expect.poll(() => width(page, ".qzk-library"), { message: `Library never collapsed (${how})` }).toBeLessThanOrEqual(28);
        expect(await left(page, surface), `${surface} left edge after ${how}`).toBe(windows ? 28 : 0);
        expect(await right(page, surface), `${surface} right edge after ${how}`).toBe(rightEdge);
        if (!windows) expect(await left(page, ".qzk-inspector"), "inspector moved").toBe(rightEdge);
        else expect(await width(page, ".qzk-wl-toolbar"), "toolbar squeezed").toBe(size.width - 28);

        if (how === "Ctrl+B") await page.keyboard.press("Control+b");
        else await page.getByRole("button", { name: "Library", exact: true }).first().click();
        await expect.poll(() => left(page, surface), { message: `Library never re-opened (${how})` }).toBe(open);
        expect(await right(page, surface)).toBe(rightEdge);
      }
    });
  }
}
