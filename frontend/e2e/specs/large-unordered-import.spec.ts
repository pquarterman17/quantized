// A large file whose x column is in no order (x,y,z rows written in any
// sequence) plots as a full-acquisition-order line. Each row was a vertex of
// one 1.5-px stroke, and canvas raster time grows with the stroked area: a
// 100k-row import took about 3 minutes from drop to first paint (measured
// 2026-11-16, headless Chromium). lib/uplotLoopLine.ts now draws a line that
// buries its whole plot one device pixel wide (Skia's hairline path).
//
// The assertion is that load-invariant property, read off the real canvas: the
// series strokes on the plot are one device pixel wide. The timeout is only a
// loose backstop (the import paints in seconds now).

import fs from "node:fs";

import { expect, test } from "@playwright/test";

import { dropFileOnto } from "../utils/dnd";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

const ROWS = 100_000;

/** x,y,z rows of a fixed pseudo-random sequence: x in no order. */
function unorderedCsv(): string {
  let seed = 12345;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const lines = ["x,y,z"];
  for (let i = 0; i < ROWS; i++) lines.push(`${rnd().toFixed(6)},${rnd().toFixed(6)},${rnd().toFixed(6)}`);
  return lines.join("\n") + "\n";
}

type StrokeLog = { __qzStrokes?: { width: number; onStage: boolean }[] };

test("a 100k-row file with x in no order paints with one-pixel series strokes", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Record every Path2D stroke (uPlot strokes its series with one; axes and
  // grid use the current path) and whether it was on the stage's plot canvas.
  await page.addInitScript(() => {
    const log: { width: number; onStage: boolean }[] = [];
    (window as unknown as StrokeLog).__qzStrokes = log;
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    CanvasRenderingContext2D.prototype.stroke = function (this: CanvasRenderingContext2D, ...args: [Path2D?]) {
      if (args[0]) log.push({ width: this.lineWidth, onStage: !!this.canvas.closest?.(".qzk-stage") });
      return stroke.apply(this, args as [Path2D]);
    } as typeof stroke;
  });
  const file = testInfo.outputPath("unordered-100k.csv");
  fs.writeFileSync(file, unorderedCsv());

  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), file);
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible({ timeout: 90_000 });

  // y and z are both drawn, each at one device pixel (the stroke was 1.5 px).
  await expect
    .poll(async () => {
      const log = await page.evaluate(() => (window as unknown as StrokeLog).__qzStrokes ?? []);
      return log.filter((s) => s.onStage).length;
    }, { timeout: 90_000 })
    .toBeGreaterThanOrEqual(2);
  const widths = await page.evaluate(() =>
    ((window as unknown as StrokeLog).__qzStrokes ?? []).filter((s) => s.onStage).map((s) => s.width),
  );
  expect(Math.max(...widths)).toBeLessThanOrEqual(1);
});
