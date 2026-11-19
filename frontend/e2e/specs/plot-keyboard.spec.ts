// The 2-D plot is keyboard-operable (usePlotKeyboard): Tab reaches it, the
// arrow keys walk a data cursor with a readout, `+` zooms and Home resets.

import { expect, test } from "@playwright/test";

import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

test("Tab to the plot, ArrowRight shows a readout, + zooms, Home resets", async ({ page }) => {
  await gotoApp(page);
  const chooser = page.waitForEvent("filechooser");
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Type a command…").fill("Import data");
  await page.keyboard.press("Enter");
  await (await chooser).setFiles(fixturePath("linear-ramp.csv"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  const host = page.getByRole("application", { name: /^Plot: .*arrow keys move the cursor/ });
  await expect(host).toHaveAttribute("tabindex", "0");
  // Tab until the plot has focus (a bounded walk through the app chrome).
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  for (let n = 0; n < 200 && !(await host.evaluate((el) => el === document.activeElement)); n++) await page.keyboard.press("Tab");
  await expect(host).toBeFocused();

  // The drawn plot (canvas pixels; the cursor marker is DOM, not canvas).
  const canvas = host.locator("canvas").first();
  const pixels = () => canvas.evaluate((c) => (c as HTMLCanvasElement).toDataURL());
  const before = await pixels();

  for (let n = 0; n < 3; n++) await page.keyboard.press("ArrowRight");
  await expect(host.locator("[data-plot-kb-live]")).toHaveText(/^x = .+, y = .+/);
  await expect(page.locator(".qzk-readout")).toContainText("x =");
  await expect(host.locator("[data-kb-cursor]")).toHaveCount(1);

  await page.keyboard.press("+");
  await expect.poll(pixels).not.toBe(before); // zoomed
  await page.keyboard.press("Home");
  await expect.poll(pixels).toBe(before); // back to the autoscaled view
  await expect(host).toBeFocused();
});
