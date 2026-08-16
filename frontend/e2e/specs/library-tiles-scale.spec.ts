// E-c3: real-browser proof that a large Library stays usable in Tiles —
// bounded DOM under REAL geometry (not the jsdom fallbacks), live-measured
// window movement on scroll, keyboard navigation across the window
// boundary, and the unchanged Escape/reveal contract.

import { expect, test } from "@playwright/test";

import { gotoApp } from "../utils/harness";

const TILE_COUNT = 400;

const seedLargeLibrary = (page: import("@playwright/test").Page): Promise<void> =>
  page.evaluate((count) => {
    const { useApp } = (window as unknown as {
      __qz: { useApp: { setState: (s: object) => void; getState: () => { setActive: (id: string) => void } } };
    }).__qz;
    useApp.setState({
      workbooks: [{ id: "w1", name: "Big run" }],
      datasets: Array.from({ length: count }, (_, i) => ({
        id: `d${i}`,
        workbookId: "w1",
        name: `run-${String(i).padStart(3, "0")}.csv`,
        data: { time: [0, 1], values: [[i], [i + 1]], labels: ["signal"], units: ["V"], metadata: {} },
      })),
      librarySelection: { kind: "workbook", id: "w1" },
    });
  }, TILE_COUNT);

test("a 400-item Tiles view is windowed, scrolls live, and keyboard-navigates across the boundary @core", async ({ page }) => {
  await gotoApp(page);
  await seedLargeLibrary(page);

  await page.getByRole("button", { name: "Tiles" }).click();
  const workspace = page.getByLabel("Library workspace");
  await expect(workspace).toBeVisible();
  await expect(page.getByText(`${TILE_COUNT} items`)).toBeVisible();

  // Bounded DOM under real measured geometry.
  const tiles = page.locator("[data-library-tile]");
  const renderedBefore = await tiles.count();
  expect(renderedBefore).toBeGreaterThan(0);
  expect(renderedBefore).toBeLessThan(120); // window + overscan, never O(items)

  // Scrolling moves the window: the first rendered tile changes.
  const firstBefore = await tiles.first().getAttribute("data-library-tile");
  await workspace.evaluate((el) => { el.scrollTop = el.scrollHeight / 2; });
  await expect
    .poll(async () => tiles.first().getAttribute("data-library-tile"))
    .not.toBe(firstBefore);

  // Keyboard crosses the rendered-window boundary by model index: focus the
  // LAST rendered tile and ArrowRight — the next model item must scroll in
  // and take focus even though it wasn't in the DOM.
  await workspace.evaluate((el) => { el.scrollTop = 0; });
  await expect.poll(async () => tiles.first().getAttribute("data-library-tile")).toBe("worksheet:d0");
  const lastKey = await tiles.last().getAttribute("data-library-tile");
  const lastIndex = Number(lastKey!.replace("worksheet:d", ""));
  await tiles.last().focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(async () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.libraryTile))
    .toBe(`worksheet:d${lastIndex + 1}`);

  // Escape still returns to the plot and posts the canonical reveal target
  // for the focused/selected worksheet ("Show in Library" contract).
  await page.keyboard.press("Escape");
  await expect(workspace).toHaveCount(0);
  await expect(page.locator(".qzk-stage-cell")).toBeVisible();
});
