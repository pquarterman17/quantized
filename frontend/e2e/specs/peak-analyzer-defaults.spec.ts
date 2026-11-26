// Peak Analyzer sensible defaults (UX audit 7 #8, lane UX-I), end to end on
// the committed XRD scan (tests/fixtures/csv_xrd.csv: 6474 points, 2θ 5..90°,
// a decaying low-angle background under ~20 sharp peaks), against the REAL
// backend. Before the lane, Next → Next → Next → Fit fitted 20 peaks plus a
// linear background (62 free parameters), stopped at the 10 s time limit
// unconverged, absorbed the low-angle hump into a 14.6°-wide "peak 1", and the
// fitted background's dive through zero dragged the log-Y autoscale to 10⁻³.
// Now: ① starts from SNIP (the trace decays), ③ drops the fitted background
// over the subtracted baseline, ④ fits on entry, and the overlays no longer
// drive the Y range.

import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { classicLayout, gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

// Owner decision 2026-11-26: the window layout is now the default. This spec drives the CLASSIC layout
// (stage tabs, side-column tool windows), so it opts in explicitly and keeps its coverage.
test.beforeEach(async ({ page }) => {
  await classicLayout(page);
});

// The committed backend fixture (synthetic-free, but in the repo and small).
const XRD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../tests/fixtures/csv_xrd.csv");
const DATA_MIN = 12.5156; // the scan's lowest intensity (cps)

type DrawWindow = { __qzDraw: { log: (c: HTMLCanvasElement) => { op: string; text?: string; x: number }[] } };
type QzWindow = { __qz: { useApp: { getState: () => { yScale: string } } } };

const SUP: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

/** The Y tick values the main plot canvas drew in its latest frame: numbers
 *  left of the plot area, "10" + superscript exponent read as 10^k. */
async function yTicks(page: Page): Promise<number[]> {
  const ops = await page.evaluate(() => {
    const plot = document.querySelector<HTMLElement>(".qzk-stage .uplot")!;
    const over = plot.querySelector<HTMLElement>(".u-over")!.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return [...plot.querySelectorAll("canvas")]
      .flatMap((c) => (window as unknown as DrawWindow).__qzDraw.log(c).map((o) => ({ ...o, left: c.getBoundingClientRect().left })))
      .filter((o) => o.op === "text" && o.text && o.left + o.x / dpr < over.left)
      .map((o) => o.text!);
  });
  return ops.flatMap((t) => {
    const m = /^10([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)$/.exec(t);
    const v = m ? 10 ** Number([...m[1]].map((c) => SUP[c]).join("")) : Number(t.replace(/,/g, ""));
    return Number.isFinite(v) ? [v] : [];
  });
}

/** The main plot's latest drawn frame, serialized: changes when it redraws new content. */
const frame = (page: Page): Promise<string> =>
  page.evaluate(() =>
    JSON.stringify([...document.querySelectorAll<HTMLCanvasElement>(".qzk-stage .uplot canvas")]
      .map((c) => (window as unknown as DrawWindow).__qzDraw.log(c))),
  );

test("defaults Next ×3 converge on an XRD scan, with the Y range on the data", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), XRD);
  await waitForDatasetCount(page, 1);

  await runPaletteCommand(page, "Peak analyzer");
  const panel = page.locator(".qzk-win").filter({ has: page.getByText("Peak analyzer", { exact: true }) });
  await expect(panel).toBeVisible();
  const next = panel.getByRole("button", { name: "Next →" });

  // ① the decaying trace starts from SNIP
  await expect(panel.getByRole("combobox", { name: "Peak baseline method" })).toHaveValue("snip");
  await next.click();
  // ② peaks are found on entry
  await expect(panel.getByRole("checkbox", { name: /include peak/ }).first()).toBeVisible({ timeout: 15_000 });
  await next.click();
  // ③ no fitted background over the subtracted baseline
  await expect(panel.getByRole("combobox", { name: "background" })).toHaveValue("none");
  await next.click();
  // ④ the fit runs on entry; Next waits for it
  const metrics = panel.getByLabel("fit metrics");
  await expect(metrics).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByText(/^converged ·/)).toBeVisible();
  await expect(panel.getByText(/did not converge/)).toHaveCount(0);

  // Peak 1 is no longer the low-angle background hump: that was 14.6° wide at
  // 5.7°, the linear background's slope traded against it. Measured now:
  // ~4.7° at ~8.5°, the broad feature SNIP's 2° window leaves in the trace.
  const rows = panel.locator("table").filter({ has: page.getByRole("columnheader", { name: "area" }) }).locator("tbody tr");
  const cell = async (c: number) => Number((await rows.nth(0).locator("td").nth(c).textContent())?.split(" ")[0]);
  expect(await cell(2)).toBeGreaterThan(7);
  const fwhm = await cell(3);
  expect(fwhm).toBeGreaterThan(0);
  expect(fwhm).toBeLessThan(5);

  // The Y range stays within one decade of the data minimum.
  expect(await page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().yScale)).toBe("log");
  await expect.poll(async () => (await yTicks(page)).length).toBeGreaterThan(1);
  expect(Math.min(...(await yTicks(page)))).toBeGreaterThanOrEqual(DATA_MIN / 10);

  // ...even under a background overlay that dives through zero, as the
  // unconverged linear background of the audit did (`42_peak_fit_done`: the
  // log autoscale followed it to 10⁻³). Whether a fit diverges like that is
  // machine-dependent, so the dive is placed on the fitted background
  // directly: the overlays never drive the autoscale.
  const before = await frame(page);
  await page.evaluate(() => {
    type Ov = { y: (number | null)[] } & Record<string, unknown>;
    type App = { getState: () => { baselineOverlay: Ov | null }; setState: (p: object) => void };
    const app = (window as unknown as { __qz: { useApp: App } }).__qz.useApp;
    const bg = app.getState().baselineOverlay!;
    const n = bg.y.length;
    app.setState({ baselineOverlay: { ...bg, y: bg.y.map((_, i) => 40 * (1 - (i / n) * 1.05)) } }); // 40 -> ~0 -> -2
  });
  await expect.poll(() => frame(page)).not.toBe(before); // the dive is drawn
  const ticks = await yTicks(page);
  expect(ticks.length).toBeGreaterThan(1);
  expect(Math.min(...ticks)).toBeGreaterThanOrEqual(DATA_MIN / 10);
});
