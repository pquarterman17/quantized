// Helpers for `regression-matrix-screen.spec.ts` (PRIMARY_SOFTWARE_AUDIT_PLAN
// P4.2, screen-canvas half): open a P4.2 matrix fixture the way a user reopens
// a saved figure, then read back what the REAL uPlot canvas drew — per plot
// panel, from `canvasRecorder.ts`'s draw-call log — plus the DOM legend.
//
// The expectations are the committed structural goldens
// (`src/lib/__fixtures__/regressionMatrix/<name>.json`, the vitest matrix's
// SCREEN projection of the uPlot OPTIONS object). This file closes the gap
// between that options object and the pixels: a stroke colour, dash, width,
// tick label or vertex is only reported here if the canvas actually drew it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, type Page } from "@playwright/test";

import { TEST_SERIES_PALETTE } from "../../src/lib/regressionMatrix.testkit";
import type { CanonicalFigure } from "../../src/lib/regressionMatrix.testkit";
import { matrixData, matrixDataset, type MatrixFixtureName } from "../../src/lib/regressionMatrixFixtures.testkit";
import type { FigureDocument } from "../../src/lib/figureDocument";
import type { DrawOp } from "./canvasRecorder";

const here = path.dirname(fileURLToPath(import.meta.url));

export function golden(name: MatrixFixtureName): CanonicalFigure {
  const file = path.resolve(here, "../../src/lib/__fixtures__/regressionMatrix", `${name}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as CanonicalFigure;
}

/** Row values of the fixture dataset: `rows[r][ch]`, x = r (no x binding). */
export const ROWS = matrixData().values as number[][];

/** One uPlot panel as drawn: its plotting rect in CANVAS pixels and its log. */
export interface Panel {
  title: string | null;
  rect: { left: number; top: number; width: number; height: number };
  dpr: number;
  ops: DrawOp[];
}

export interface LegendRow {
  label: string;
  swatch: string | null;
  dash: string | null;
  marker: string | null;
  struck: boolean;
}

export interface Screen {
  panels: Panel[];
  legend: { className: string; title: string | null; rows: LegendRow[] } | null;
  /** Aria-hidden seam glyphs between x-break panels. */
  seams: number;
}

/** Install the vitest matrix's literal palette on `--series-N` (so palette
 *  colours are the goldens' own literals), pin the dark theme the goldens
 *  were frozen under, and open `doc` as the ONLY, maximized plot window —
 *  through the real store actions a Library "open editable figure" uses. */
export async function openFixture(page: Page, doc: FigureDocument): Promise<void> {
  await page.evaluate(({ doc, ds, palette }) => {
    interface Win { id: string; winState: string }
    interface S {
      plotWindows: Win[];
      editableFigures: unknown[];
      setTheme: (t: string) => void;
      addDataset: (d: unknown) => void;
      openEditableFigure: (id: string) => string | null;
      closeWindow: (id: string) => void;
      toggleMaximizeWindow: (id: string) => void;
    }
    const app = (window as unknown as { __qz: { useApp: { getState: () => S; setState: (p: unknown) => void } } }).__qz.useApp;
    app.getState().setTheme("dark");
    palette.forEach((c, i) => document.documentElement.style.setProperty(`--series-${i + 1}`, c));
    app.getState().addDataset(ds);
    const before = app.getState().plotWindows.map((w) => w.id);
    app.setState({ editableFigures: [...app.getState().editableFigures, doc] });
    const id = app.getState().openEditableFigure(doc.id);
    if (!id) throw new Error("openEditableFigure returned null");
    for (const w of before) app.getState().closeWindow(w);
    if (app.getState().plotWindows.find((w) => w.id === id)?.winState !== "maximized") app.getState().toggleMaximizeWindow(id);
  }, { doc, ds: matrixDataset(), palette: [...TEST_SERIES_PALETTE] });
}

function readScreen(page: Page): Promise<Screen> {
  return page.evaluate(() => {
    const rec = (window as unknown as { __qzDraw: { log: (c: HTMLCanvasElement) => DrawOp[] } }).__qzDraw;
    const scratch = document.createElement("canvas").getContext("2d")!;
    const norm = (c: string): string => { scratch.fillStyle = "#000"; scratch.fillStyle = c; return String(scratch.fillStyle); };
    const panels = [...document.querySelectorAll<HTMLElement>(".qzk-stage .uplot")].map((u) => {
      const canvas = u.querySelector("canvas")!;
      const over = u.querySelector<HTMLElement>(".u-over")!;
      const dpr = canvas.width / parseFloat(canvas.style.width || u.querySelector<HTMLElement>(".u-wrap")!.style.width);
      const px = (v: string) => parseFloat(v) * dpr;
      return {
        title: u.querySelector(".u-title")?.textContent ?? null,
        rect: { left: px(over.style.left), top: px(over.style.top), width: px(over.style.width), height: px(over.style.height) },
        dpr,
        ops: rec.log(canvas),
      };
    });
    const box = document.querySelector<HTMLElement>(".qzk-stage .qzk-legend");
    const legend = box && {
      className: box.className,
      title: box.querySelector(".qzk-legend-title")?.textContent ?? null,
      rows: [...box.querySelectorAll<HTMLElement>(".qzk-legend-content > .it:not(.qzk-legend-title)")].map((row) => {
        const clone = row.cloneNode(true) as HTMLElement;
        clone.querySelectorAll("button").forEach((b) => b.remove());
        const line = row.querySelector("svg line");
        return {
          label: (clone.textContent ?? "").trim(),
          swatch: line ? norm(getComputedStyle(line).stroke) : null,
          dash: line?.getAttribute("stroke-dasharray") ?? null,
          marker: row.querySelector("svg")?.getAttribute("data-marker") ?? null,
          struck: getComputedStyle(row).textDecorationLine.includes("line-through"),
        };
      }),
    };
    const seams = [...document.querySelectorAll<HTMLElement>(".qzk-stage [aria-hidden='true']")]
      .filter((el) => el.style.backgroundImage.includes("repeating-linear-gradient")).length;
    return { panels, legend, seams };
  });
}

/** uPlot draws each series line as ONE continuous polyline: a Path2D with no
 *  moveTo (grid/tick strokes carry one moveTo per segment, error whiskers
 *  one each, marker glyphs one per point). */
export const seriesLines = (p: Panel): DrawOp[] => p.ops.filter((o) => o.op === "stroke" && o.moves === 0 && o.pts.length >= 2);

/** Wait until `panels` uPlot panels have each drawn `linesPerPanel` series
 *  lines AND two reads 250 ms apart agree — the async `/api/plot/series`
 *  fetch can land a frame after the offline fallback's. */
export async function settledScreen(page: Page, panels: number, linesPerPanel: number[]): Promise<Screen> {
  let last = "";
  let screen: Screen | null = null;
  await expect.poll(async () => {
    screen = await readScreen(page);
    const shapeOk = screen.panels.length === panels && screen.panels.every((p, i) => seriesLines(p).length === linesPerPanel[i]);
    const json = JSON.stringify(screen);
    const stable = shapeOk && json === last;
    last = json;
    return stable;
  }, { timeout: 15_000, intervals: [250] }).toBe(true);
  return screen!;
}

export interface Tick { value: number; at: number }
export interface Axes { x: Tick[]; y: Tick[]; y2: Tick[]; xTitle: string[]; yTitle: string[]; y2Title: string[]; inside: DrawOp[] }

/** Classify every fillText by where it sits relative to the plotting rect:
 *  below = x ticks/title, left = y ticks/title, right = y2 ticks/title,
 *  inside = annotations. Rotated text is an axis title. */
export function axesOf(p: Panel): Axes {
  const { left, top, width, height } = p.rect;
  const out: Axes = { x: [], y: [], y2: [], xTitle: [], yTitle: [], y2Title: [], inside: [] };
  for (const t of p.ops.filter((o) => o.op === "text")) {
    const x = t.x!;
    const y = t.y!;
    const n = Number(t.text);
    const numeric = t.text!.trim() !== "" && Number.isFinite(n);
    if (t.rotated) (x < left ? out.yTitle : out.y2Title).push(t.text!);
    else if (y > top + height + 1) numeric ? out.x.push({ value: n, at: x }) : out.xTitle.push(t.text!);
    else if (x < left - 1) out.y.push({ value: n, at: y });
    else if (x > left + width + 1) out.y2.push({ value: n, at: y });
    else out.inside.push(t);
  }
  return out;
}

/** The linear pixel→value map an axis' OWN drawn tick labels define (first and
 *  last tick), so vertex checks read the rendered axis, not an assumed one. */
export function scaleOf(ticks: Tick[]): (px: number) => number {
  const a = ticks[0];
  const b = ticks[ticks.length - 1];
  return (px) => a.value + ((px - a.at) * (b.value - a.value)) / (b.at - a.at);
}

/** Sample the canvas pixel nearest (x, y) in canvas px: the closest colour in
 *  a 5x5 neighbourhood to `want` (a #rrggbb), returned as its RGB distance. */
export function pixelDistance(page: Page, panel: number, x: number, y: number, want: string): Promise<number> {
  return page.evaluate(({ panel, x, y, want }) => {
    const canvas = document.querySelectorAll<HTMLElement>(".qzk-stage .uplot")[panel].querySelector("canvas")!;
    const data = canvas.getContext("2d")!.getImageData(Math.round(x) - 2, Math.round(y) - 2, 5, 5).data;
    const w = [1, 3, 5].map((i) => parseInt(want.slice(i, i + 2), 16));
    let best = Infinity;
    for (let i = 0; i < data.length; i += 4) {
      best = Math.min(best, Math.hypot(data[i] - w[0], data[i + 1] - w[1], data[i + 2] - w[2]));
    }
    return best;
  }, { panel, x, y, want });
}
