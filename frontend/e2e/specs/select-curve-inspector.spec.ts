// UX-A: the selection-driven Inspector, in a real browser. With the Pointer
// tool, a click ON the curve (the real canvas hit target, at every DPI scale
// of the @core matrix) selects it: the Inspector names it and offers Edit…
// (item 50), which opens the curve's popup where one swatch recolours it. A
// legend row click selects that curve WITHOUT hiding it (visibility is the
// swatch toggle), and Esc clears. `linear-ramp.csv` is a monotonic diagonal.

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { applyPopup } from "../utils/objectPopup";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

type Qz = {
  __qz: { useApp: { getState: () => { seriesStyles: Record<number, { color?: string }>; hiddenChannels: number[] } } };
};

test.describe("Click a curve, edit it through Edit… @core", () => {
  test("canvas click selects the curve, Edit… opens its popup, a swatch recolours it; a legend row selects without hiding", async ({ page }) => {
    await gotoApp(page);
    await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("linear-ramp.csv"));
    await waitForDatasetCount(page, 1);

    const over = page.locator(".qzk-stage .u-over");
    await expect(over).toBeVisible();
    const selection = page.getByRole("region", { name: "Selection" });
    await expect(selection.getByRole("status")).toHaveText("Nothing");

    // Click 1: ON the curve. The plot area's centre need not be on it (the
    // autoscale pads Y), so hover there and click the curve point the cursor
    // marks at that X.
    await over.hover();
    const pt = await page.locator(".qzk-stage .u-cursor-pt").first().boundingBox();
    if (!pt) throw new Error("cursor point geometry unavailable");
    await page.mouse.click(pt.x + pt.width / 2, pt.y + pt.height / 2);
    await expect(page.locator(".qzk-selection-halo")).toHaveAttribute("data-selection", /^series:/);
    await expect(selection.getByRole("status")).toContainText("Curve:");
    // Item 50: the panel names the curve and offers Edit…; the Series style
    // card is not hoisted and no curve field is in the panel.
    await expect(page.locator(".qzk-inspector details[data-card-id='Series style']")).toHaveCount(0);
    await expect(selection.getByRole("button", { name: "Edit…" })).toBeVisible();

    // Click 2: Edit… opens the curve's popup; a colour, then Apply.
    await selection.getByRole("button", { name: "Edit…" }).click();
    const dialog = page.getByRole("dialog", { name: "Plot details" });
    await expect(dialog).toBeVisible();
    await dialog.getByTitle("Series 4").click();
    await applyPopup(dialog);
    const channel = Number(await selection.getByLabel("Select plot object").inputValue().then((v) => v.replace("series:", "")));
    await expect
      .poll(() => page.evaluate((ch) => (window as unknown as Qz).__qz.useApp.getState().seriesStyles[ch]?.color, channel))
      .toBe("--series-4");

    // Esc clears the selection and its halo.
    await page.locator(".qzk-stage").hover();
    await page.keyboard.press("Escape");
    await expect(page.locator(".qzk-selection-halo")).toHaveCount(0);
    await expect(selection.getByRole("status")).toHaveText("Nothing");

    // A legend row selects its curve and leaves it visible.
    const legendRow = page.locator(".qzk-stage .qzk-legend .it[data-channel]").first();
    await legendRow.locator(".qzk-legend-label").click();
    await expect(page.locator(".qzk-selection-halo")).toHaveAttribute("data-selection", /^series:/);
    expect(await page.evaluate(() => (window as unknown as Qz).__qz.useApp.getState().hiddenChannels)).toEqual([]);
  });
});
