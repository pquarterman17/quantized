// Line polish (plan item 17: gap to symbol, line in front of / behind the
// symbols, double line), screen == export, pinned as a SHARED wire fixture
// (`tests/fixtures/wire/line_style.json`):
//
//   kernel  the pure stroke geometry (`lineStyleGeometry`) on fixed display
//           coordinates, number for number; the Python twin
//           (`calc/figure_line_style`) must produce the same strokes;
//   cases   per style: the exact request the app sends, and what the canvas
//           draws for it (the rows that carry a symbol, how many strokes and
//           vertices, the order against the symbols, and the measured gap and
//           stroke separation), read from the REAL series builder and path
//           geometry over a stand-in uPlot.
//
// The backend half (`tests/test_export_line_style.py`) posts each request and
// asserts matplotlib draws the same: the same marker rows, the same strokes,
// the same order, the same gap and separation in points.
//
// Regenerate only after a DELIBERATE rule change:
//   LINE_STYLE_FIXTURE_WRITE=1 npx vitest run src/lib/lineStyleFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type uPlot from "uplot";
import { beforeAll, describe, expect, it } from "vitest";

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { lineStrokes } from "./lineStyleGeometry";
import { loadMarks } from "./marksLoader";
import { buildColumns, composeDisplayPayload, effectiveChannels, type PlotPayload } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset, SeriesStyle } from "./types";
import { strokesOf } from "./uplotLineStyle";
import { buildSeriesDefs } from "./uplotSeries";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "line_style.json",
);
const COLORS = { accentColor: "#00f", inkColor: "#eef0f6", inkDimColor: "#888", isDarkBg: true };
const X = [0, 1, 2, 3, 4, 5];
const Y = [1, 2, 1.5, 3, 2.5, 4];
const SX = 80; // px per x unit: every segment is far longer than any trim below
const SY = 40;
const H = 6 * SY;

// -- kernel cases: display coordinates, one length unit ----------------------

interface Kernel {
  name: string;
  xs: number[];
  ys: (number | null)[]; // null = a missing value (NaN in the kernel)
  marked: number[] | null; // rows with a symbol; null = every row
  radius: number;
  gap: number;
  sep: number;
}
const KERNELS: Kernel[] = [
  { name: "no gap, no double: the whole run is one line", xs: [0, 10, 20, 30], ys: [0, 5, 0, 5], marked: null, radius: 3, gap: 0, sep: 0 },
  { name: "a gap on every symbol: one piece per segment", xs: [0, 20, 40, 60], ys: [0, 0, 0, 0], marked: null, radius: 3, gap: 2, sep: 0 },
  { name: "symbols on rows 0 and 2 only: the line runs on through the bare points", xs: [0, 20, 40, 60], ys: [0, 10, 0, 10], marked: [0, 2], radius: 3, gap: 2, sep: 0 },
  { name: "a segment too short to keep any line is not drawn", xs: [0, 8, 40], ys: [0, 0, 0], marked: null, radius: 3, gap: 2, sep: 0 },
  { name: "a missing value breaks the line; a repeated point is skipped", xs: [0, 20, 40, 40, 60, 80], ys: [0, 0, null, 0, 0, 0], marked: [0, 1, 4, 5], radius: 2, gap: 1, sep: 0 },
  { name: "double line round a corner is mitred", xs: [0, 30, 30], ys: [0, 0, 30], marked: [], radius: 0, gap: 0, sep: 4 },
  { name: "double line with a gap: both strokes are trimmed alike", xs: [0, 40, 80], ys: [0, 0, 20], marked: [0, 2], radius: 3, gap: 2, sep: 3 },
  { name: "a hairpin turn has no mitre and keeps its offset", xs: [0, 30, 0], ys: [0, 0, 0], marked: [], radius: 0, gap: 0, sep: 4 },
  { name: "a very sharp turn is limited to the mitre limit", xs: [0, 30, 0], ys: [0, 0, 2], marked: [], radius: 0, gap: 0, sep: 4 },
];

function kernelStrokes(k: Kernel): number[][][] {
  const set = k.marked ? new Set(k.marked) : null;
  const ys = k.ys.map((v) => (v == null ? NaN : v));
  return lineStrokes(k.xs, ys, (i) => (set ? set.has(i) : true), k.radius, k.gap, k.sep).map((p) => p.map(([x, y]) => [x, y]));
}

// -- case styles --------------------------------------------------------------

interface Case {
  name: string;
  style: SeriesStyle;
}
const CASES: Case[] = [
  { name: "gap to symbol", style: { marker: true, markerSize: 8, symbolGap: 4, color: "#3366cc" } },
  { name: "line in front of the symbols", style: { marker: true, markerSize: 6, lineFront: true, color: "#cc3311" } },
  { name: "double line", style: { doubleLine: 4, color: "#228833" } },
  { name: "all three with a symbol on every 2nd point", style: { marker: true, markerSize: 6, markerEvery: 2, symbolGap: 3, doubleLine: 3, lineFront: true, color: "#aa3377" } },
  { name: "a step line takes none of it", style: { marker: true, markerSize: 6, step: "post", symbolGap: 5, doubleLine: 2, lineFront: true, color: "#ee7733" } },
  { name: "an unstyled line is as before", style: { marker: true, markerSize: 6, color: "#009988" } },
];

const DS: Dataset = {
  id: "d1",
  name: "line style",
  data: { time: X, values: X.map((_, r) => [Y[r]]), labels: ["S"], units: ["au"], metadata: {} },
};
const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), yKeys: [0], seriesStyles: { 0: c.style } });

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "A", datasetId: "d1", view: viewOf(c) });
  return buildFigureSpecFromDocument(doc, DS, "line-style", { fmt: "svg" });
}

/** A stand-in uPlot: x runs SX px per unit, y SY px per unit upward in a box of height H. */
function standIn(series: uPlot.Series[], data: PlotPayload["data"]): uPlot {
  const u = {
    data,
    series,
    bbox: { left: 0, top: 0, width: 5 * SX, height: H },
    valToPos: (v: number, key: string) => (key === "x" ? v * SX : H - v * SY),
  };
  return u as unknown as uPlot;
}

function canvas(c: Case) {
  const view = viewOf(c);
  const channels = effectiveChannels(DS.data, view.yKeys, view.xKey, DS.channelRoles, view.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(DS.data, null, view.xKey, channels), {
    id: DS.id, waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const { series } = buildSeriesDefs(payload, { seriesStyles: [c.style] }, ["S"], true, COLORS);
  const def = series[1] as uPlot.Series & { qzLine?: { gap: number; sep: number; front: boolean } };
  const u = standIn(series, payload.data);
  const filter = def.points?.filter;
  const rows = typeof filter === "function" ? filter(u, 1, true, null) : null;
  const spec = def.qzLine ?? null;
  const strokes = spec ? strokesOf(u, 1, 0, X.length - 1, spec) : [];
  const first = [0, H - Y[0] * SY] as const;
  const start = strokes[0]?.[0];
  return {
    drawn: spec != null,
    marker_rows: rows,
    gap: spec?.gap ?? 0,
    sep: spec?.sep ?? 0,
    front: spec?.front ?? false,
    shape: strokes.map((p) => p.length),
    // The measured gap (a gap-only line: how far the first stroke starts from its symbol centre)
    // and separation (a double-only line: how far apart its two strokes start), in points.
    trim_pt: spec && spec.gap > 0 && spec.sep === 0 && start ? Math.hypot(start[0] - first[0], start[1] - first[1]) : null,
    sep_pt: spec && spec.sep > 0 && spec.gap === 0 && strokes.length >= 2
      ? Math.hypot(strokes[0][0][0] - strokes[1][0][0], strokes[0][0][1] - strokes[1][0][1]) : null,
  };
}

const fresh = () => ({
  rule:
    "Gap to symbol, a line in front of its symbols and a double line are optional per-series styles "
    + "(symbol_gap / line_front / double_line, points). They apply to a plain line only. The canvas and the "
    + "export draw the same strokes: kernel cases pin the geometry number for number; each case pins the "
    + "marker rows, the stroke and vertex counts, the order and the measured gap / separation.",
  kernel: KERNELS.map((k) => ({
    name: k.name, xs: k.xs, ys: k.ys, marked: k.marked, radius: k.radius, gap: k.gap, sep: k.sep, strokes: kernelStrokes(k),
  })),
  cases: CASES.map((c) => ({ name: c.name, request: request(c), canvas: canvas(c) })),
});

beforeAll(async () => {
  await loadMarks();
});

describe("line polish, screen == export (shared wire fixture)", () => {
  it("kernel: a gap trims radius + gap from each symbol end (hand-checked)", () => {
    const [a] = kernelStrokes(KERNELS[1]);
    expect(a).toEqual([[5, 0], [15, 0]]); // 20 long, 5 off each end
    expect(kernelStrokes(KERNELS[1])).toHaveLength(3);
    expect(kernelStrokes(KERNELS[3])).toHaveLength(1); // the 8-long segment is dropped
    const [l, r] = kernelStrokes(KERNELS[5]);
    expect(l[0]).toEqual([0, 2]); // left of +x is +y
    expect(r[0]).toEqual([0, -2]);
    expect(l[1][0]).toBeCloseTo(28, 12); // mitre: the inner corner of a left turn
    expect(l[1][1]).toBeCloseTo(2, 12);
  });

  it("the canvas draws a gap exactly radius + gap from the symbol and a double line sep apart", () => {
    const [gap, , dbl] = CASES.map(canvas);
    expect(gap.trim_pt).toBeCloseTo(4 + 4, 9);
    expect(dbl.sep_pt).toBeCloseTo(4, 9);
  });

  it("only the options that are set reach the request, and a step line takes none", () => {
    const s = (i: number) => request(CASES[i]).series_styles?.[0];
    expect(s(0)).toMatchObject({ symbol_gap: 4 });
    expect(s(1)).toMatchObject({ line_front: true });
    expect(s(2)).toMatchObject({ double_line: 4 });
    expect(s(3)).toMatchObject({ symbol_gap: 3, double_line: 3, line_front: true, marker_every: 2 });
    expect(s(4)).not.toHaveProperty("symbol_gap");
    expect(s(4)).not.toHaveProperty("line_front");
    expect(s(4)).not.toHaveProperty("double_line");
    expect(canvas(CASES[4]).drawn).toBe(false);
    expect(canvas(CASES[5]).drawn).toBe(false);
  });

  it("matches the committed wire fixture", () => {
    const want = fresh();
    if (process.env.LINE_STYLE_FIXTURE_WRITE) writeFileSync(FIXTURE, `${JSON.stringify(want, null, 2)}\n`);
    expect(JSON.parse(readFileSync(FIXTURE, "utf-8"))).toEqual(JSON.parse(JSON.stringify(want)));
  });
});
