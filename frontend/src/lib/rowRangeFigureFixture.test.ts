// A plot's row window, screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/row_range_figure.json`, ROW_RANGE_CONTRACT 3.3 / R2).
//
// THE RULE: rows outside `PlotView.rowRange` are not drawn and range neither axis.
//   * on screen the payload keeps its length (overlays, error bars and a
//     waterfall stay aligned) and every row its SOURCE index; a hidden row has no
//     x and no values (`lib/plotRowWindow.ts`), so the canvas draws and ranges
//     only the window's rows, exactly as it does a row with no x (#1125);
//   * in the export the figure HOLDS only the window's rows
//     (`lib/figureRowRange.ts`), after the exclusion prune of the sheet's rows;
//   * both land on the same x and y view and the same drawn rows.
// A window row the sheet excludes is drawn nowhere in either.
//
// Each case hand-states `want`: the x and y view and the SOURCE rows drawn. The
// canvas half asserts a REAL uPlot instance (its scales and the stroke it built),
// the backend half (`tests/test_export_row_range.py`) the exported figure.
//
// Regenerate only after a DELIBERATE rule change:
//   ROW_RANGE_FIXTURE_WRITE=1 npx vitest run src/lib/rowRangeFigureFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D. The Path2D keeps
// the vertices it was given, so the test reads what was drawn.
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

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, dropTrailingEmptyRows, effectiveChannels } from "./plotdata";
import { windowRows } from "./plotRowWindow";
import { defaultPlotView, type PlotView } from "./plotview";
import type { RowRange } from "./rowRange";
import { droppedRows } from "./rowstate";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS } from "./uplotPaths";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "row_range_figure.json",
);

type Lim = [number, number];
interface Case {
  name: string;
  range: RowRange;
  excluded?: number[];
  /** The view of each axis, and the SOURCE rows that draw a point. */
  want: { x: Lim; y: Lim; rows: number[] };
}

const N = 200;
const inWindow = (r: number, a: number, b: number) => r >= a && r <= b;
/** x runs 0, 0.5, 1 ... and y is small inside every case's window and huge (9000) outside it, so a row that
 *  leaked into either axis stretches it far past the hand-stated view. */
const xOf = (r: number) => r * 0.5;
const yOf = (r: number, a: number, b: number) => (inWindow(r, a, b) ? 50 + (r % 7) * 3 : 9000);

const CASES: Case[] = [
  {
    // The contract's own example: rows 21-44 of 200 draw 24 points.
    name: "rows 21-44 of 200",
    range: { from: 20, to: 43 },
    want: { x: [10, 21.5], y: [48, 70], rows: Array.from({ length: 24 }, (_v, i) => 20 + i) },
  },
  {
    // An excluded row inside the window is drawn nowhere (the exclusion prune, inside the window).
    name: "rows 21-44 of 200, row 26 excluded",
    range: { from: 20, to: 43 },
    excluded: [25, 100],
    want: { x: [10, 21.5], y: [48, 70], rows: [20, 21, 22, 23, 24, ...Array.from({ length: 18 }, (_v, i) => 26 + i)] },
  },
  {
    // A window at the top of the sheet: the rows AFTER it are the hidden ones.
    name: "rows 1-10 of 200",
    range: { from: 0, to: 9 },
    want: { x: [0, 4.5], y: [48, 70], rows: Array.from({ length: 10 }, (_v, i) => i) },
  },
];

const winY = (c: Case) => (r: number) => yOf(r, c.range.from, c.range.to);

function dataset(c: Case): Dataset {
  return {
    id: "d1",
    name: "window",
    data: {
      time: Array.from({ length: N }, (_v, r) => xOf(r)),
      values: Array.from({ length: N }, (_v, r) => [winY(c)(r)]),
      labels: ["M"],
      units: ["emu"],
      metadata: {},
    },
    ...(c.excluded ? { excludedRows: c.excluded } : {}),
  };
}

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), yKeys: [0], rowRange: c.range });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** The drawn payload, as the Stage builds it: the fetch, the exclusion mask, then the row window. */
function payloadOf(c: Case) {
  const ds = dataset(c);
  const view = viewOf(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const base = dropTrailingEmptyRows(buildColumns(ds.data, view.y2Keys, view.xKey, channels));
  const composed = composeDisplayPayload(base, {
    id: ds.id, waterfall: 0, dropped: droppedRows(ds), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  return windowRows(composed, c.range);
}

async function canvas(c: Case, trace?: "Scatter") {
  const payload = payloadOf(c);
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(),
    xScale: "linear", yScale: "linear", hidden: payload.series.map(() => false),
    linearPaths: LINEAR_PATHS, pointsPaths: POINTS_PATHS, ...(trace ? { defaultTrace: trace } : {}),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return { u, payload };
}

const finite = (v: number | null | undefined) => v != null && Number.isFinite(v);
function sourceRowsDrawn(data: unknown): number[] {
  const cols = data as ArrayLike<number | null | undefined>[];
  return Array.from(cols[0], (_, r) => r).filter((r) => finite(cols[0][r]) && finite(cols[1][r]));
}
type Verts = [number, number][];
function vertices(u: uPlot, points: boolean): Verts {
  const s = u.series[1] as unknown as { _paths?: { stroke?: { vertices: Verts } }; points: { _paths?: { fill?: { vertices: Verts } } } };
  return (points ? s.points._paths?.fill?.vertices : s._paths?.stroke?.vertices) ?? [];
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "Window", datasetId: "d1", view: viewOf(c) });
  return buildFigureSpecFromDocument(doc, dataset(c), "window", { fmt: "svg" });
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, request: request(c), want: c.want })) });

describe("a plot's row window draws and ranges only its rows, screen == export", () => {
  it.each(CASES)("canvas axes: $name", async (c) => {
    const { u } = await canvas(c);
    expect(u.scales.x.min).toBeCloseTo(c.want.x[0], 6);
    expect(u.scales.x.max).toBeCloseTo(c.want.x[1], 6);
    expect(u.scales.y.min).toBeCloseTo(c.want.y[0], 6);
    expect(u.scales.y.max).toBeCloseTo(c.want.y[1], 6);
  });

  it.each(CASES)("every row keeps its source index, and only the window's rows draw: $name", async (c) => {
    const { payload } = await canvas(c);
    expect(payload.data[0]).toHaveLength(N); // never trimmed: overlays and error bars stay aligned
    expect(sourceRowsDrawn(payload.data)).toEqual(c.want.rows);
  });

  it.each(CASES)("the line holds exactly the window's rows: $name", async (c) => {
    const { u } = await canvas(c);
    const v = vertices(u, false);
    expect(v).toHaveLength(c.want.rows.length);
    expect(v.every(([px, py]) => Number.isFinite(px) && Number.isFinite(py))).toBe(true);
  });

  it.each(CASES)("the markers hold exactly the window's rows: $name", async (c) => {
    const { u } = await canvas(c, "Scatter");
    expect(vertices(u, true)).toHaveLength(c.want.rows.length);
  });

  it.each(CASES)("the export holds exactly the drawn rows: $name", (c) => {
    const spec = request(c);
    expect(spec.dataset.time).toEqual(c.want.rows.map(xOf));
    expect(spec.dataset.values.map((row) => row[0])).toEqual(c.want.rows.map(winY(c)));
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.ROW_RANGE_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
