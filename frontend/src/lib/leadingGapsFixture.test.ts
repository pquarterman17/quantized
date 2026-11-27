// An X column that STARTS with missing cells (blank CSV cells, NaN), screen ==
// export, pinned as a SHARED wire fixture (`tests/fixtures/wire/leading_gaps.json`).
//
// THE RULE: a row with no x draws no point and ranges neither axis, and every
// row keeps its SOURCE index (the payload is never re-indexed: the brush,
// Select rows, the lasso mask, Pick and Go to Source all count source rows).
//   * the x axis is the finite x values' full scan, padded 2% (`padXDomain`);
//   * the y axis is the y values of drawn rows only, padded 10% and soft at
//     zero (`fullYExtents`): the huge y beside a blank x here never stretches it;
//   * the line and the markers hold exactly the rows with an x and a y.
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
    override moveTo(x: number, y: number) { this.vertices.push([x, y]); super.moveTo(x, y); }
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
  want: { x: Lim; y: Lim; rows: number[] };
}

const N = NaN;
const CASES: Case[] = [
  {
    // The y at the three blank-x rows (900) is not drawn, so it never ranges y.
    name: "numeric x, three leading blanks",
    time: [N, N, N, 10, 11, 12, 13],
    y: [900, 900, 900, 1, 2, 3, 4],
    want: { x: [9.94, 13.06], y: [0.7, 4.3], rows: [3, 4, 5, 6] },
  },
  {
    name: "numeric x, descending, three leading blanks",
    time: [N, N, N, 13, 12, 11, 10],
    y: [900, 900, 900, 1, 2, 3, 4],
    want: { x: [9.94, 13.06], y: [0.7, 4.3], rows: [3, 4, 5, 6] },
  },
  {
    // A null x reads as 0 to uPlot: a sweep through zero is where that bites.
    name: "numeric x across zero, two leading blanks",
    time: [N, N, -2, -1, 0, 1, 2],
    y: [-700, -700, 1, 2, 3, 4, 5],
    want: { x: [-2.08, 2.08], y: [0.6, 5.4], rows: [2, 3, 4, 5, 6] },
  },
  {
    // A blank in the middle stays a gap, in the same rows' indices.
    name: "numeric x, a leading and a middle blank",
    time: [N, 10, 11, N, 13, 14],
    y: [900, 1, 2, 800, 4, 5],
    want: { x: [9.92, 14.08], y: [0.6, 5.4], rows: [1, 2, 4, 5] },
  },
  {
    name: "date x, two leading blanks",
    time: [N, N, T0, T0 + DAY, T0 + 2 * DAY, T0 + 3 * DAY],
    y: [900, 900, 1, 2, 3, 4],
    date: true,
    want: { x: [T0 - 5184, T0 + 3 * DAY + 5184], y: [0.7, 4.3], rows: [2, 3, 4, 5] },
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

describe("a leading blank x draws no point and ranges nothing, screen == export", () => {
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
