// A row-windowed OVERLAY (a fit or a baseline), screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/row_range_overlay.json`, ROW_RANGE_CONTRACT 3.3 / R2; the sibling of
// `row_range_figure.json`, which pins the data series).
//
// THE RULE: an analysis overlay is drawn only over the plot's row window, and from the SAME rows the data is.
//   * on screen the overlay is a column of the payload, so the window hides its rows outside the window exactly as
//     it hides the data's (`lib/plotRowWindow.ts`): the canvas strokes the overlay at the window's rows only;
//   * in the export the figure HOLDS the window's rows and the overlay is cut to them
//     (`lib/figureRowRange.windowOverlayInputs`), so the matplotlib overlay line has the window's rows;
//   * overlays never drive the Y autoscale, so both land on the data's own view.
// Each overlay is 9001 / 9002 outside the window (the data is 9000), so a row that leaked into the overlay or the
// axes would be plain to see against the hand-stated `want`: the x and y view, the SOURCE rows the overlay draws
// and their values.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_RANGE_OVERLAY_FIXTURE_WRITE=1 npx vitest run src/lib/rowRangeOverlayFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D. The Path2D keeps the vertices it was given, so the test
// reads what was drawn.
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as { Path2D: new () => { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void } };
  const Base = g.Path2D;
  g.Path2D = class extends Base {
    vertices: [number, number][] = [];
    override moveTo(x: number, y: number) { this.vertices.push([x, y]); super.moveTo(x, y); }
    override lineTo(x: number, y: number) { this.vertices.push([x, y]); super.lineTo(x, y); }
  };
});

import uPlot from "uplot";

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, composeDisplayPayload, dropTrailingEmptyRows, effectiveChannels } from "./plotdata";
import { windowRows } from "./plotRowWindow";
import { defaultPlotView, type PlotView } from "./plotview";
import type { RowRange } from "./rowRange";
import type { BaselineOverlay, Dataset, FitOverlay } from "./types";
import { buildOpts } from "./uplotOpts";
import { LINEAR_PATHS } from "./uplotPaths";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "row_range_overlay.json",
);

type Lim = [number, number];
const N = 200;
const ON_0 = { yKey: 0, xKey: null };
const xOf = (r: number) => r * 0.5;

interface Case {
  name: string;
  range: RowRange;
  kind: "fit" | "baseline";
  /** The overlay's value at row `r` INSIDE the window (outside it the overlay is 9001 / 9002). */
  inside: (r: number) => number;
  want: { x: Lim; y: Lim; rows: number[]; overlay_y: number[] };
}

const inWindow = (r: number, c: Pick<Case, "range">) => r >= c.range.from && r <= c.range.to;
const dataY = (r: number, c: Case) => (inWindow(r, c) ? 50 + (r % 7) * 3 : 9000);
const overlayY = (r: number, c: Case) => (inWindow(r, c) ? c.inside(r) : c.kind === "fit" ? 9001 : 9002);
const rowsOf = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_v, i) => from + i);

const CASES: Case[] = [
  {
    // The contract's own example window: a fit over rows 21-44 of 200 draws 24 points.
    name: "a fit over rows 21-44 of 200",
    range: { from: 20, to: 43 }, kind: "fit", inside: (r) => 51 + (r % 7) * 3,
    want: { x: [10, 21.5], y: [48, 70], rows: rowsOf(20, 43), overlay_y: rowsOf(20, 43).map((r) => 51 + (r % 7) * 3) },
  },
  {
    name: "a baseline over rows 1-10 of 200",
    range: { from: 0, to: 9 }, kind: "baseline", inside: (r) => 40 + (r % 5),
    want: { x: [0, 4.5], y: [48, 70], rows: rowsOf(0, 9), overlay_y: rowsOf(0, 9).map((r) => 40 + (r % 5)) },
  },
];

function dataset(c: Case): Dataset {
  return {
    id: "d1", name: "window",
    data: {
      time: Array.from({ length: N }, (_v, r) => xOf(r)),
      values: Array.from({ length: N }, (_v, r) => [dataY(r, c)]),
      labels: ["M"], units: ["emu"], metadata: {},
    },
  };
}

const fitOf = (c: Case): FitOverlay | null => (c.kind === "fit" ? { datasetId: "d1", binding: ON_0, y: Array.from({ length: N }, (_v, r) => overlayY(r, c)) } : null);
const baselineOf = (c: Case): BaselineOverlay | null => (c.kind === "baseline" ? { datasetId: "d1", binding: ON_0, y: Array.from({ length: N }, (_v, r) => overlayY(r, c)) } : null);
const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), yKeys: [0], rowRange: c.range });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** The drawn payload, as the Stage builds it: the fetch, the overlay column, then the row window. */
function payloadOf(c: Case) {
  const ds = dataset(c);
  const view = viewOf(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const base = dropTrailingEmptyRows(buildColumns(ds.data, view.y2Keys, view.xKey, channels));
  const composed = composeDisplayPayload(base, {
    id: ds.id, waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: fitOf(c), baselineOverlay: baselineOf(c), peakOverlay: null, derivOverlay: null, selection: null,
  });
  return windowRows(composed, c.range);
}

async function canvas(c: Case) {
  const payload = payloadOf(c);
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(),
    xScale: "linear", yScale: "linear", hidden: payload.series.map(() => false), linearPaths: LINEAR_PATHS,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return { u, payload };
}

const finite = (v: number | null | undefined) => v != null && Number.isFinite(v);
/** The SOURCE rows a payload column draws a point at (a row with no x or no value draws none). */
function drawnRows(data: unknown, col: number): number[] {
  const cols = data as ArrayLike<number | null | undefined>[];
  return Array.from(cols[0], (_, r) => r).filter((r) => finite(cols[0][r]) && finite(cols[col][r]));
}
type Verts = [number, number][];
function vertices(u: uPlot, series: number): Verts {
  const s = u.series[series] as unknown as { _paths?: { stroke?: { vertices: Verts } } };
  return s._paths?.stroke?.vertices ?? [];
}

/** The request the Stage export sends for the same view and overlay. */
function request(c: Case): FigureSpec {
  const view = viewOf(c);
  const document = createFigureDocument({ id: "w1-doc", name: "Overlay", datasetId: "d1", view });
  const get = (() => ({
    ...view, focusedWindowId: "w1", windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false, defaultTrace: "Line", defaultLineWidth: 1.5, excludedDisplay: "hide",
    fitOverlay: fitOf(c), baselineOverlay: baselineOf(c), peakOverlay: null,
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, dataset(c), "window", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, request: request(c), want: c.want })) });

describe("a row-windowed overlay draws from the window's rows, screen == export", () => {
  it.each(CASES)("canvas axes ignore every row outside the window: $name", async (c) => {
    const { u } = await canvas(c);
    expect(u.scales.x.min).toBeCloseTo(c.want.x[0], 6);
    expect(u.scales.x.max).toBeCloseTo(c.want.x[1], 6);
    expect(u.scales.y.min).toBeCloseTo(c.want.y[0], 6);
    expect(u.scales.y.max).toBeCloseTo(c.want.y[1], 6);
  });

  it.each(CASES)("the overlay column keeps its length and draws only the window's rows, at their values: $name", async (c) => {
    const { payload, u } = await canvas(c);
    expect(payload.series).toHaveLength(2); // the data and the overlay
    expect(payload.data[1]).toHaveLength(N); // never trimmed: the overlay stays row-aligned with the data
    expect(drawnRows(payload.data, 2)).toEqual(c.want.rows);
    expect(drawnRows(payload.data, 1)).toEqual(c.want.rows); // the data, the same rows
    expect(drawnRows(payload.data, 2).map((r) => (payload.data[2] as number[])[r])).toEqual(c.want.overlay_y);
    expect(vertices(u, 2)).toHaveLength(c.want.rows.length); // the stroke the canvas built
  });

  it.each(CASES)("the export holds the window's rows and the overlay cut to them: $name", (c) => {
    const spec = request(c);
    expect(spec.dataset.time).toEqual(c.want.rows.map(xOf));
    expect(spec.dataset.values.map((row) => row[0])).toEqual(c.want.rows.map((r) => dataY(r, c)));
    expect(spec.dataset.values.map((row) => row[1])).toEqual(c.want.overlay_y);
    expect(spec.y_keys).toEqual([0, 1]);
    expect(spec.analysis_overlays).toEqual([false, true]); // the second column is the overlay, left out of the autoscale
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.ROW_RANGE_OVERLAY_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
