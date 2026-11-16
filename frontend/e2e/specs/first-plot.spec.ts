// UX audit 8, lane UX8-A, end to end: a VSM M(H) export (Field / Moment /
// Temperature, with a `#` preamble) opens as the plot a scientist would make
// by hand. Moment has the Y axis to itself, its range is the loop's (about
// ±1.3e-3 emu, not 0..300 because of Temperature), and the import toast says
// Temperature was left off with a one-click way to plot it.

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder, type DrawOp } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";

type View = { yKeys: number[] | null; y2Keys: number[] | null; yScale: string };
const view = (page: Page) =>
  page.evaluate(() => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => View } } }).__qz.useApp.getState();
    return { yKeys: s.yKeys, y2Keys: s.y2Keys, yScale: s.yScale };
  });

/** Every text the plot canvas drew: tick labels and axis titles. */
const texts = (page: Page) =>
  page.evaluate(() => {
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const log = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => DrawOp[] } }).__qzDraw.log(canvas);
    return log.filter((op) => op.op === "text").map((op) => ({ text: op.text ?? "", x: op.x ?? 0, rotated: !!op.rotated }));
  });

/** A tick label as a number ("−1.0e-3", "0.0010", "1.0×10⁻³"), else NaN. */
function tickValue(t: string): number {
  const sup: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  const s = t.replace(/−/g, "-").replace(/[⁻⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => sup[c]).replace(/\s/g, "");
  const m = /^(-?[\d.]+)[×x]10(-?\d+)$/.exec(s);
  return m ? Number(m[1]) * 10 ** Number(m[2]) : Number(s);
}

test("an M(H) file opens with Moment alone on Y, on the loop's range @core", async ({ page }) => {
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("mh-vsm-300K.txt"));
  await waitForDatasetCount(page, 1);
  await expect(page.locator(".qzk-stage .u-over")).toBeVisible();

  await expect.poll(() => view(page)).toEqual({ yKeys: [0], y2Keys: null, yScale: "linear" });
  const toast = page.locator(".qzk-toast", { hasText: "Temperature not plotted" });
  await expect(toast).toBeVisible();

  // The Y title is Moment's alone, and no Temperature axis is drawn.
  await expect.poll(async () => (await texts(page)).some((t) => t.rotated && t.text === "Moment (emu)")).toBe(true);
  const drawn = await texts(page);
  expect(drawn.some((t) => t.text.includes("Temperature"))).toBe(false);

  // Y ticks (left of the frame, unrotated, numeric) span the loop: about
  // ±1.3e-3, never Temperature's 300.
  const over = await page.locator(".qzk-stage .u-over").boundingBox();
  const canvas = await page.locator(".qzk-stage canvas").first().boundingBox();
  const scale = await page.evaluate(() => window.devicePixelRatio);
  const leftEdge = (over!.x - canvas!.x) * scale;
  // An auto axis on a tiny range draws mantissas plus a "×10ⁿ" factor at
  // the axis end (UX8-G), so scale the labels by it before comparing.
  const sup: Record<string, string> = { "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" };
  const factorText = drawn.find((t) => !t.rotated && t.x <= leftEdge + 4 * scale && /×10[⁻⁰-⁹]+/.test(t.text))?.text;
  const exp = factorText ? Number([...factorText.replace(/.*×10/, "")].map((c) => sup[c] ?? "").join("")) : 0;
  const yTicks = drawn
    .filter((t) => !t.rotated && t.x < leftEdge && !/×10/.test(t.text))
    .map((t) => tickValue(t.text) * 10 ** exp)
    .filter(Number.isFinite);
  expect(yTicks.length).toBeGreaterThanOrEqual(3);
  expect(Math.max(...yTicks.map(Math.abs))).toBeLessThan(3e-3);
  expect(Math.max(...yTicks)).toBeGreaterThan(5e-4);
  expect(Math.min(...yTicks)).toBeLessThan(-5e-4);
  await page.screenshot({ path: test.info().outputPath("first-plot-mh.png") });

  // One click away: Plot all puts Temperature on its own right Y axis.
  await toast.getByRole("button", { name: "Plot all" }).click();
  await expect.poll(() => view(page)).toEqual({ yKeys: null, y2Keys: [1], yScale: "linear" });
});
