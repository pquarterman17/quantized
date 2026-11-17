// UX9-D "One waterfall": three Raman spectra, one Plot-menu command, a stacked
// graph appears (legend reversed to match the stack) -- and the exported
// figure carries the SAME offsets the canvas drew.

import fs from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { installCanvasRecorder } from "../utils/canvasRecorder";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { axesOf, readScreen, scaleOf, type Screen } from "../utils/matrixScreen";
import { runPaletteCommand } from "../utils/palette";

const SCALES = [1, 1.1, 0.9];
const NAMES = ["Raman_A", "Raman_B", "Raman_C"];

/** Three copies of the Raman fixture, intensity scaled per file. */
function writeSpectra(dir: string): { name: string; text: string }[] {
  fs.mkdirSync(dir, { recursive: true });
  const [head, ...rows] = fs.readFileSync(fixturePath("Raman_Si_graphite.txt"), "utf8").trim().split("\n");
  return NAMES.map((n, k) => ({
    name: `${n}.txt`,
    text: [head, ...rows.map((r) => {
      const [x, y] = r.split("\t");
      return `${x}\t${(Number(y) * SCALES[k]).toFixed(3)}`;
    })].join("\n") + "\n",
  }));
}

async function dropAll(page: Page, files: { name: string; text: string }[]): Promise<void> {
  const dt = await page.evaluateHandle((items) => {
    const d = new DataTransfer();
    for (const it of items) d.items.add(new File([it.text], it.name, { type: "text/plain" }));
    return d;
  }, files);
  const target = page.locator(".qzk-library");
  await target.dispatchEvent("dragenter", { dataTransfer: dt });
  await target.dispatchEvent("dragover", { dataTransfer: dt });
  await target.dispatchEvent("drop", { dataTransfer: dt });
}

test("3 Raman spectra -> Waterfall… -> stacked graph, export matches the screen", async ({ page }, info) => {
  test.setTimeout(120_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropAll(page, writeSpectra(info.outputPath("raman")));
  await waitForDatasetCount(page, 3);

  const rows = page.locator("[data-ds-id]");
  await rows.first().click();
  await rows.last().click({ modifiers: ["Shift"] });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { selectedIds: string[] } } } }).__qz.useApp.getState().selectedIds.length)).toBe(3);

  await runPaletteCommand(page, "Waterfall…");
  await expect.poll(() => page.evaluate(() => (window as unknown as { __qz: { useApp: { getState: () => { waterfall: number } } } }).__qz.useApp.getState().waterfall)).toBeGreaterThan(0);

  // The Channels card opened on the slider, which names its unit.
  await expect(page.getByRole("slider", { name: "Waterfall" })).toBeVisible();
  await expect(page.getByText(/% of range/)).toBeVisible();

  // Dense spectra draw each curve as one long polyline that starts with a
  // moveTo, so pick the series by vertex count rather than matrixScreen's
  // "no moveTo" heuristic.
  const longLines = (s: Screen) => s.panels[0].ops.filter((o) => o.op === "stroke" && o.pts.length > 100);
  let screen!: Screen;
  await expect.poll(async () => {
    screen = await readScreen(page);
    return screen.panels.length === 1 && longLines(screen).length === 3 && (screen.legend?.rows.length ?? 0) === 3;
  }, { timeout: 15_000, intervals: [250] }).toBe(true);
  // Legend lists the TOP trace first (the stacking order).
  expect(screen.legend!.rows[0].label).toContain("Raman_C");
  expect(screen.legend!.rows[2].label).toContain("Raman_A");

  // Export: the figure request carries per-curve offsets ...
  await runPaletteCommand(page, "Export figure (quick dialog)…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { waterfall_offsets?: number[] };
  const offsets = body.waterfall_offsets!;
  expect(offsets).toHaveLength(3);
  expect(offsets[0]).toBe(0);
  expect(offsets[1]).toBeGreaterThan(0);
  expect(offsets[2]).toBeCloseTo(2 * offsets[1], 6);

  // ... and the canvas drew each curve at its raw value + that same offset.
  const p = screen.panels[0];
  const toValue = scaleOf(axesOf(p).y);
  const tol = 2 * Math.abs(toValue(10) - toValue(9)) * p.dpr;
  const first = 177.844; // first Raman intensity in the fixture
  longLines(screen).forEach((line, i) => {
    expect(Math.abs(toValue(line.pts[0][1]) - (first * SCALES[i] + offsets[i]))).toBeLessThan(tol + 1e-6);
  });
});
