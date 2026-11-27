// An X column that STARTS with missing cells (blank CSV cells, NaN), screen ==
// export, pinned as a SHARED wire fixture (`tests/fixtures/wire/leading_gaps.json`).
//
// THE RULE: a row with no x draws no point and ranges neither axis, and every
// row keeps its SOURCE index (the payload is never re-indexed: the brush,
// Select rows, the lasso mask, Pick and Go to Source all count source rows).
//   * the x axis is the finite x values' full scan, padded 2% (`padXDomain`);
//   * the y axis is the y values of drawn rows only, padded 10% and soft at
//     zero (`fullYExtents`): the huge y beside a blank x here never stretches it;
//   * the line and the markers hold exactly the rows with an x and a y, and the
//     line is BROKEN at every missing x (one segment per run of drawn rows), never
//     joined across the gap and never dropped to x = 0.
// A gap anywhere does this, leading, middle or trailing (`xSortedFast`).
// Why: uPlot reads the FIRST x for its autoscale, so a null there drew no axis
// at all, and a null x reads as 0 wherever uPlot places it. The same payloads
// had the export's matplotlib axis range them by every finite y.
//
// Each case hand-states `want`: the x and y view and the source rows drawn. The
// canvas half asserts a REAL uPlot instance (its scales and the stroke it built),
// the backend half (`tests/test_export_leading_gaps.py`) the exported figure.
//
// Regenerate only after a DELIBERATE rule change:
//   LEADING_GAPS_FIXTURE_WRITE=1 npx vitest run src/lib/leadingGapsFixture.test.ts

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
    starts: number[] = []; // the vertex index of each moveTo: where the pen lifted
    override moveTo(x: number, y: number) { this.starts.push(this.vertices.length); this.vertices.push([x, y]); super.moveTo(x, y); }
    override lineTo(x: number, y: number) { this.vertices.push([x, y]); super.lineTo(x, y); }
  };
});

import uPlot from "uplot";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, dropTrailingEmptyRows, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import { LINEAR_PATHS, POINTS_PATHS } from "./uplotPaths";
import { xSortedFast } from "./uplotXRange";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "leading_gaps.json",
);

const DAY = 86400;
const T0 = 1.7e9; // a timestamp: epoch seconds

type Lim = [number, number];
interface Case {
  name: string;
  time: number[];
  /** Channel 0 (the plotted y). */
  y: number[];
  /** `metadata.time_is_datetime`: the X is a date column. */
  date?: boolean;
  /** The view of each axis, and the SOURCE rows that draw a point. */
  want: { x: Lim; y: Lim; rows: number[]; segments: number[][] };
}

const N = NaN;
const CASES: Case[] = [
  {
    // The y at the three blank-x rows (900) is not drawn, so it never ranges y.
    name: "numeric x, three leading blanks",
    time: [N, N, N, 10, 11, 12, 13],
    y: [900, 900, 900, 1, 2, 3, 4],
    want: { x: [9.94, 13.06], y: [0.7, 4.3], rows: [3, 4, 5, 6], segments: [[3, 4, 5, 6]] },
  },
  {
    name: "numeric x, descending, three leading blanks",
    time: [N, N, N, 13, 12, 11, 10],
    y: [900, 900, 900, 1, 2, 3, 4],
    want: { x: [9.94, 13.06], y: [0.7, 4.3], rows: [3, 4, 5, 6], segments: [[3, 4, 5, 6]] },
  },
  {
    // A null x reads as 0 to uPlot: a sweep through zero is where that bites.
    name: "numeric x across zero, two leading blanks",
    time: [N, N, -2, -1, 0, 1, 2],
    y: [-700, -700, 1, 2, 3, 4, 5],
    want: { x: [-2.08, 2.08], y: [0.6, 5.4], rows: [2, 3, 4, 5, 6], segments: [[2, 3, 4, 5, 6]] },
  },
  {
    // A blank in the middle stays a gap, in the same rows' indices.
    name: "numeric x, a leading and a middle blank",
    time: [N, 10, 11, N, 13, 14],
    y: [900, 1, 2, 800, 4, 5],
    want: { x: [9.92, 14.08], y: [0.6, 5.4], rows: [1, 2, 4, 5], segments: [[1, 2], [4, 5]] },
  },
  {
    name: "date x, two leading blanks",
    time: [N, N, T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY],
    y: [900, 900, 1, 2, 3, 4],
    date: true,
    want: { x: [T0 - 5184, T0 + 3 * DAY + 5184], y: [0.7, 4.3], rows: [2, 3, 4, 5], segments: [[2, 3, 4, 5]] },
  },
  {
    // W1 (acceptance pass 5): ten rows, two blank x in the middle. The y beside the
    // blanks (10) drew a flat line and stretched the axis; now it ranges nothing.
    name: "numeric x, two middle blanks",
    time: [1, 2, 3, 4, N, N, 7, 8, 9, 10],
    y: [1, 2, 3, 4, 10, 10, 5, 5.5, 5, 4],
    want: { x: [0.82, 10.18], y: [0.55, 5.95], rows: [0, 1, 2, 3, 6, 7, 8, 9], segments: [[0, 1, 2, 3], [6, 7, 8, 9]] },
  },
  {
    name: "date x, two middle blanks",
    time: [T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY, N, N, T0 + 6 * DAY, T0 + 7 * DAY, T0 + 8 * DAY, T0 + 9 * DAY],
    y: [1, 2, 3, 4, 10, 10, 5, 5.5, 5, 4],
    date: true,
    want: { x: [T0 - 15552, T0 + 9 * DAY + 15552], y: [0.55, 5.95], rows: [0, 1, 2, 3, 6, 7, 8, 9], segments: [[0, 1, 2, 3], [6, 7, 8, 9]] },
  },
  {
    // A single blank between two runs of drawn rows.
    name: "numeric x, a single middle blank",
    time: [1, 2, N, 4, 5],
    y: [1, 2, 9, 4, 5],
    want: { x: [0.92, 5.08], y: [0.6, 5.4], rows: [0, 1, 3, 4], segments: [[0, 1], [3, 4]] },
  },
];

const view: PlotView = { ...defaultPlotView(), yKeys: [0] };

function dataset(c: Case): Dataset {
  return {
    id: "d1",
    name: "gaps",
    data: {
      time: c.time,
      values: c.y.map((v) => [v]),
      labels: ["M"],
      units: ["emu"],
      metadata: c.date ? { time_is_datetime: true } : {},
    },
  };
}

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** The drawn payload, as the Stage builds it (a fetch's trailing trim included). */
function payloadOf(c: Case) {
  const ds = dataset(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  return dropTrailingEmptyRows(buildColumns(ds.data, view.y2Keys, view.xKey, channels));
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
  const doc = createFigureDocument({ id: "w1", name: "Gaps", datasetId: "d1", view });
  return buildFigureSpecFromDocument(doc, dataset(c), "gaps", { fmt: "svg" });
}

const fresh = () => ({ cases: CASES.map((c) => ({ name: c.name, request: request(c), want: c.want })) });

describe("a missing x draws no point and ranges nothing, screen == export", () => {
  it.each(CASES)("canvas axes: $name", async (c) => {
    const { u } = await canvas(c);
    expect(u.scales.x.min).toBeCloseTo(c.want.x[0], 6);
    expect(u.scales.x.max).toBeCloseTo(c.want.x[1], 6);
    expect(u.scales.y.min).toBeCloseTo(c.want.y[0], 6);
    expect(u.scales.y.max).toBeCloseTo(c.want.y[1], 6);
  });

  it.each(CASES)("every row keeps its source index: $name", async (c) => {
    const { payload } = await canvas(c);
    // Never re-indexed: the payload is the dataset's rows one to one (no `rowIds` map needed).
    expect(payload.data[0]).toHaveLength(c.time.length);
    expect(payload.rowIds).toBeUndefined();
    expect(sourceRowsDrawn(payload.data)).toEqual(c.want.rows);
  });

  it.each(CASES)("the line holds exactly the rows with an x: $name", async (c) => {
    const { u } = await canvas(c);
    const v = vertices(u, false);
    expect(v).toHaveLength(c.want.rows.length);
    expect(v.every(([px, py]) => Number.isFinite(px) && Number.isFinite(py))).toBe(true);
  });

  it.each(CASES)("the line is broken at every missing x, never joined across: $name", async (c) => {
    const { u } = await canvas(c);
    const path = (u.series[1] as unknown as { _paths?: { stroke?: { starts: number[] } } })._paths?.stroke;
    const v = vertices(u, false);
    const starts = path?.starts ?? [];
    const sizes = starts.map((s, i) => (starts[i + 1] ?? v.length) - s);
    expect(sizes).toEqual(c.want.segments.map((g) => g.length));
  });

  it.each(CASES)("the markers hold exactly the rows with an x: $name", async (c) => {
    const { u } = await canvas(c, "Scatter");
    expect(vertices(u, true)).toHaveLength(c.want.rows.length);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.LEADING_GAPS_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});

describe("xSortedFast: the ordered fast path is for a column with no gap", () => {
  it("keeps an ascending column with no missing x (the common case) on the fast path", () => {
    expect(xSortedFast([])).toBe(true);
    expect(xSortedFast([1, 2, 2, 5])).toBe(true);
  });
  it("sends a gap anywhere, or any decrease, to the full scan", () => {
    expect(xSortedFast([null, 1, 2])).toBe(false);
    expect(xSortedFast([1, null, 2])).toBe(false);
    expect(xSortedFast([1, 2, null])).toBe(false);
    expect(xSortedFast([1, Number.NaN, 2])).toBe(false);
    expect(xSortedFast([1, 3, 2])).toBe(false);
  });
});
