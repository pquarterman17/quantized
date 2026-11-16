// Plot > Exchange X-Y axes, end to end against the real backend: the command
// turns the live canvas on its side (X title up the left, Y title along the
// bottom) and the SVG export of the SAME view agrees on which axis title sits
// where (lib/exchangeXY.ts <-> calc/figure_orient.py). Toggling twice is the
// identity on screen, and it is one undo step.

import { expect, test, type Page } from "@playwright/test";

import { installCanvasRecorder } from "../utils/canvasRecorder";
import { dropFileOnto } from "../utils/dnd";
import { fixturePath } from "../utils/fixtures";
import { gotoApp, waitForDatasetCount } from "../utils/harness";
import { runPaletteCommand } from "../utils/palette";

type QzWindow = { __qz: { useApp: { getState: () => { exchangeXY: boolean; undo: () => void } } } };
const exchanged = (page: Page) => page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().exchangeXY);

const X_TITLE = "Time (s)";
const Y_TITLE = "B, Si (c/s)";

type Placed = { side: "left" | "bottom" | "other"; rotated: boolean } | undefined;

/** Where the plot's canvas draws each axis title, relative to the plot area:
 *  recorded fillText calls (e2e/utils/canvasRecorder.ts), since rich titles are
 *  canvas text, not DOM. */
async function screenTitles(page: Page, texts: string[]): Promise<Record<string, Placed>> {
  return page.evaluate((want) => {
    type Op = { op: string; text?: string; x?: number; y?: number; rotated?: boolean };
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const draws = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => Op[] } }).__qzDraw.log(canvas);
    const c = canvas.getBoundingClientRect();
    const over = document.querySelector(".qzk-stage .u-over")!.getBoundingClientRect();
    const k = canvas.width / c.width; // device px per CSS px
    const out: Record<string, Placed> = {};
    for (const text of want) {
      const op = draws.filter((o) => o.op === "text" && o.text === text).pop();
      if (!op) {
        out[text] = undefined;
        continue;
      }
      const x = c.left + op.x! / k;
      const y = c.top + op.y! / k;
      out[text] = { side: x <= over.left ? "left" : y >= over.bottom ? "bottom" : "other", rotated: !!op.rotated };
    }
    return out;
  }, texts);
}
/** The numeric tick labels the canvas drew left of the plot area (the vertical axis), as numbers. */
const screenVerticalTicks = (page: Page): Promise<number[]> =>
  page.evaluate(() => {
    type Op = { op: string; text?: string; x?: number };
    const canvas = document.querySelector(".qzk-stage canvas") as HTMLCanvasElement;
    const draws = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => Op[] } }).__qzDraw.log(canvas);
    const c = canvas.getBoundingClientRect();
    const over = document.querySelector(".qzk-stage .u-over")!.getBoundingClientRect();
    const k = canvas.width / c.width;
    return draws
      .filter((o) => o.op === "text" && /^-?[\d.]+$/.test(o.text ?? "") && c.left + o.x! / k <= over.left)
      .map((o) => Number(o.text));
  });

/** The numeric tick labels of the SVG's leftmost label column (the vertical axis). */
function svgVerticalTicks(svg: string): number[] {
  const re = /<text[^>]* x="([\d.]+)" y="[\d.]+" transform="rotate\(-?0[^"]*"[^>]*>(-?[\d.]+)<\/text>/g;
  const cols = new Map<number, number[]>();
  for (const m of svg.matchAll(re)) {
    const x = Math.round(Number(m[1]));
    cols.set(x, [...(cols.get(x) ?? []), Number(m[2])]);
  }
  return cols.get(Math.min(...cols.keys())) ?? [];
}

const titleSide = async (page: Page, text: string) => (await screenTitles(page, [text]))[text]?.side;

/** `{text: [rotation, x, y]}` for every <text> of an SVG. */
function svgText(svg: string): Record<string, [number, number, number]> {
  const out: Record<string, [number, number, number]> = {};
  const re = /<text[^>]* x="([\d.]+)" y="([\d.]+)" transform="rotate\((-?[\d.]+)[^"]*"[^>]*>([^<]*)<\/text>/g;
  for (const m of svg.matchAll(re)) out[m[4]] = [Number(m[3]), Number(m[1]), Number(m[2])];
  return out;
}

async function exportSvg(page: Page): Promise<{ svg: string; body: { overrides?: { exchange_xy?: boolean } } }> {
  await runPaletteCommand(page, "Export figure…");
  const dialog = page.getByRole("dialog", { name: "Export figure" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Format").selectOption("svg");
  const request = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/export/figure");
  const download = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "Export", exact: true }).click();
  const body = (await request).postDataJSON() as { overrides?: { exchange_xy?: boolean } };
  const bytes = await (await import("node:fs/promises")).readFile(await (await download).path());
  return { svg: bytes.toString("utf8"), body };
}

test("Exchange X-Y axes: the screen and the exported SVG put the same title on the same side", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("sims-time-profile.csv"));
  await waitForDatasetCount(page, 1);

  // Upright first: X title along the bottom.
  await expect.poll(() => titleSide(page, X_TITLE)).toBe("bottom");

  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  // Screen: the X title is rotated up the left; the Y title runs along the bottom.
  await expect.poll(async () => (await screenTitles(page, [X_TITLE]))[X_TITLE]).toEqual({ side: "left", rotated: true });
  expect((await screenTitles(page, [Y_TITLE]))[Y_TITLE]).toEqual({ side: "bottom", rotated: false });

  // Export: the SAME view, vector.
  const { svg, body } = await exportSvg(page);
  expect(body.overrides?.exchange_xy).toBe(true);
  const text = svgText(svg);
  const x = text[X_TITLE];
  const y = text[Y_TITLE];
  expect(x, "the X title is drawn in the SVG").toBeTruthy();
  expect(y, "the Y title is drawn in the SVG").toBeTruthy();
  expect(x[0]).toBe(-90); // rotated, as on screen
  expect(Math.abs(y[0])).toBe(0);
  const ticks = Object.entries(text).filter(([k]) => k !== X_TITLE && k !== Y_TITLE);
  expect(x[1]).toBeLessThan(Math.min(...ticks.map(([, v]) => v[1]))); // left of every tick label
  expect(y[2]).toBeGreaterThan(Math.max(...ticks.map(([, v]) => v[2]))); // below every tick label

  // The data lands inside the exported axes: the vertical axis is Time over ITS range
  // (0..50), exactly the screen's, never the counts' range (0..20000).
  const screenTicks = await screenVerticalTicks(page);
  const exportTicks = svgVerticalTicks(svg);
  expect(screenTicks.length).toBeGreaterThan(2);
  expect(Math.max(...exportTicks)).toBe(Math.max(...screenTicks));
  expect(Math.max(...exportTicks)).toBeLessThanOrEqual(60);
  expect(Math.min(...exportTicks)).toBe(Math.min(...screenTicks));

  // Hit testing follows the turn: double-clicking the LEFT gutter (X now) opens the X axis dialog.
  const over = (await page.locator(".qzk-stage .u-over").first().boundingBox())!;
  await page.mouse.dblclick(over.x - 25, over.y + over.height / 2);
  const dialog = page.getByRole("dialog", { name: "Axis" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("tab", { name: "X", selected: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  // ...and right-clicking the BOTTOM gutter (Y now) offers Y axis entries, not X's.
  await page.mouse.click(over.x + over.width / 2, over.y + over.height + 25, { button: "right" });
  await expect(page.getByText(/Autoscale Y/).first()).toBeVisible();
  await expect(page.getByText(/Autoscale X/)).toHaveCount(0);
  await page.keyboard.press("Escape");

  // Toggling twice is the identity; the toggle is ONE undo step.
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(false);
  await expect.poll(() => titleSide(page, X_TITLE)).toBe("bottom");
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  await page.evaluate(() => (window as unknown as QzWindow).__qz.useApp.getState().undo());
  await expect.poll(() => exchanged(page)).toBe(false);
});

type Fmt = { breaks?: [number, number][]; top?: { kind: string; factor?: number } };
type Live = {
  exchangeXY: boolean;
  insetMode: boolean;
  yFmt: Fmt;
  xFmt: Fmt;
  history: unknown[];
  setInsetMode: (v: boolean) => void;
  setYFmt: (f: Fmt) => void;
  setXFmt: (f: Fmt) => void;
  plotWindows: { id: string; kind: string; document?: { plot: { axisBreaks: { x: [number, number][] } } } }[];
  focusedWindowId: string | null;
};
const live = (page: Page) => (fn: (s: Live) => unknown) =>
  page.evaluate((src) => {
    const s = (window as unknown as { __qz: { useApp: { getState: () => Live } } }).__qz.useApp.getState();
    return new Function("s", `return (${src})(s)`)(s);
  }, fn.toString());

test("Exchange X-Y axes refuses an inset, a Y break and a top X axis once exchanged, and keeps the exchange", async ({ page }) => {
  test.setTimeout(90_000);
  await installCanvasRecorder(page);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("sims-time-profile.csv"));
  await waitForDatasetCount(page, 1);
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  const history = (await live(page)((s) => s.history.length)) as number;

  // The magnifier inset button is disabled while exchanged, and its palette command does nothing.
  await expect(page.getByRole("button", { name: /Magnifier inset/i }).first()).toBeDisabled();
  await runPaletteCommand(page, "Magnifier inset").catch(() => undefined);
  await page.keyboard.press("Escape");
  // The setters (what the Axis dialog, the Inspector and macros call) refuse before committing.
  await live(page)((s) => { s.setInsetMode(true); s.setYFmt({ ...s.yFmt, breaks: [[2000, 8000]] }); s.setXFmt({ ...s.xFmt, top: { kind: "reciprocal", factor: 1 } }); });
  expect(await live(page)((s) => ({ ex: s.exchangeXY, inset: s.insetMode, yb: s.yFmt.breaks ?? null, top: s.xFmt.top ?? null }))).toEqual({ ex: true, inset: false, yb: null, top: null });
  expect(await live(page)((s) => s.history.length)).toBe(history); // refused: not even an undo entry
  await expect(page.getByText(/can't be set while X and Y are exchanged/).first()).toBeVisible();
  await expect.poll(async () => (await screenTitles(page, [X_TITLE]))[X_TITLE]).toEqual({ side: "left", rotated: true }); // still turned
});

test("Exchange X-Y axes is blocked by a saved x-break in the window's document, and drops when one arrives", async ({ page }) => {
  test.setTimeout(90_000);
  await gotoApp(page);
  await dropFileOnto(page, page.locator(".qzk-library"), fixturePath("sims-time-profile.csv"));
  await waitForDatasetCount(page, 1);
  const setBreak = (x: [number, number][]) =>
    page.evaluate((brk) => {
      const store = (window as unknown as { __qz: { useApp: { getState: () => Live; setState: (p: unknown) => void } } }).__qz.useApp;
      const s = store.getState();
      const wins = s.plotWindows.map((w) => (w.id === s.focusedWindowId && w.document ? { ...w, document: { ...w.document, plot: { ...w.document.plot, axisBreaks: { ...w.document.plot.axisBreaks, x: brk } } } } : w));
      store.setState({ plotWindows: wins });
      return wins.some((w) => w.id === s.focusedWindowId && w.document);
    }, x);
  const hasDocument = await setBreak([[20, 30]]);
  test.skip(!hasDocument, "the focused window has no document yet in this build");
  // Not exchanged: the command is refused (disabled) beside the saved break.
  await page.getByRole("menuitem", { name: "Plot" }).click().catch(() => undefined);
  await runPaletteCommand(page, "Exchange X–Y axes");
  expect(await exchanged(page)).toBe(false);
  // Exchanged, then the break arrives (Break at gaps / the Figure Builder): the exchange is turned off, said so.
  await setBreak([]);
  await runPaletteCommand(page, "Exchange X–Y axes");
  await expect.poll(() => exchanged(page)).toBe(true);
  await setBreak([[20, 30]]);
  await expect.poll(() => exchanged(page)).toBe(false);
  await expect(page.getByText(/Exchange X–Y axes turned off/).first()).toBeVisible();
});
