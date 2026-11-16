// UX-D journey: a file dropped ANYWHERE in the window is imported, the browser
// never navigates, and a "Drop to import" overlay shows while a file is dragged
// over. jsdom cannot show the overlay or a real navigation, so this runs in
// Chromium: the empty stage first (centred card), then a drop straight onto the
// plot canvas with data loaded.

import { expect, test, type Page } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

/** dragenter + dragover only (no drop): leaves the overlay up. */
async function hoverFile(page: Page, selector: string): Promise<void> {
  await page.evaluate((sel) => {
    const dt = new DataTransfer();
    dt.items.add(new File(["a,b\n1,2\n"], "hover.csv", { type: "text/csv" }));
    const el = document.querySelector(sel)!;
    for (const type of ["dragenter", "dragover"]) el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, selector);
}

test("the empty-project card is vertically centred in the stage", async ({ page }) => {
  await gotoApp(page);
  const card = page.locator(".qzk-empty-project > div");
  await expect(card).toBeVisible();
  const gaps = await page.evaluate(() => {
    const c = document.querySelector(".qzk-empty-project > div")!.getBoundingClientRect();
    const s = document.querySelector(".qzk-empty-project")!.getBoundingClientRect();
    return { top: c.top - s.top, bottom: s.bottom - c.bottom };
  });
  expect(Math.abs(gaps.top - gaps.bottom)).toBeLessThan(2);
  expect(gaps.top).toBeGreaterThan(40);
});

test("a file dropped on the empty stage and then on the plot is imported with no navigation @core", async ({ page }) => {
  await gotoApp(page);
  await expect(page.locator(".qzk-empty-project")).toBeVisible(); // lazy chunk
  const url = page.url();

  // overlay while hovering, anywhere in the window
  await hoverFile(page, ".qzk-empty-project");
  await expect(page.getByTestId("file-drop-overlay")).toBeVisible();
  await expect(page.getByTestId("file-drop-overlay")).toContainText("Drop to import");

  await dropFileOnto(page, page.locator(".qzk-empty-project"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.getByTestId("file-drop-overlay")).toHaveCount(0);
  expect(page.url()).toBe(url);

  // now straight onto the plot (not the narrow Library column)
  const plot = page.locator(".qzk-stage .u-over").first();
  await expect(plot).toBeVisible();
  await dropFileOnto(page, plot, fixturePath("dataset-a.csv"));
  await waitForDatasetCount(page, 2);
  expect(page.url()).toBe(url);
});

test("a drop on the Library column is imported once, not twice", async ({ page }) => {
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);
  await page.waitForTimeout(500);
  await waitForDatasetCount(page, 1);
});
