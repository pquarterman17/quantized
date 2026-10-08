// A FLAT (zero-span) channel's autoscale, screen == export, pinned as a SHARED
// wire fixture (`tests/fixtures/wire/flat_autoscale.json`).
//
// THE RULE — uPlot's own, on every axis (x, y, y2), linear and log:
//   linear: `rangeNum(v, v, 0.1, true)` — the span grows by |v| on each side,
//           snapped out to a tenth of v's decade, never across zero: a flat
//           1000 Oe field reads 0..2000, a flat 1234 0..2500, a flat -5
//           -10..0. A flat 0 has no magnitude to grow by: 0..100.
//   log:    `rangeLog(v, v, 10, false)` — one decade each side, snapped out as
//           any log autoscale (1000 reads 100..10000, 3 reads 0.3..100).
// Why this one: it is what the canvas already does on every default path
// (uPlot's y/y2 snap, its x `autoScaleX`), and it reads honestly — the line
// sits mid-plot on an axis that runs to zero, so it looks constant.
// matplotlib's default (a ±5% nonsingular widening plus margins, 950..1050
// for the 1000 Oe field) frames a constant like a trace measured to 0.1%.
// The export follows the canvas (`calc/figure_autoscale.py`), and the canvas'
// own full-scan path for a loop (`fullYExtents`, `padXDomain`) now lands on
// the same view instead of a 10% / 2% pad.
//
// Each case hand-states the view of each flat axis; the canvas half asserts a
// REAL uPlot instance's scales, the backend half
// (`tests/test_export_flat_autoscale.py`) the exported axes' limits.
//
// Regenerate only after a DELIBERATE rule change:
//   FLAT_AUTOSCALE_FIXTURE_WRITE=1 npx vitest run src/lib/flatAutoscaleFixture.test.ts

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// uPlot reads matchMedia at import and draws through Path2D; jsdom has neither.
vi.hoisted(() => {
  const w = window as unknown as Record<string, unknown>;
  w.matchMedia ??= (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as unknown as Record<string, unknown>;
  g.Path2D ??= class { moveTo() {} lineTo() {} rect() {} arc() {} closePath() {} bezierCurveTo() {} addPath() {} };
});

import uPlot from "uplot";

import "./uplotPaths"; // provides uPlot's range helpers, as every canvas loads it

import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "flat_autoscale.json",
);

// Channels: 0 M (varies), 1 H flat 1000, 2 F flat 1234, 3 N flat -5,
// 4 Z flat 0, 5 L flat 3.
const M = [1, 4, 2, 3];
const FLAT = [1000, 1234, -5, 0, 3];
function dataset(time: number[], m = M): Dataset {
  return {
    id: "d1",
    name: "flat",
    data: {
      time,
      values: time.map((_, r) => [m[r], ...FLAT]),
      labels: ["M", "H", "F", "N", "Z", "L"],
      units: ["emu", "Oe", "a.u.", "a.u.", "a.u.", "a.u."],
      metadata: {},
    },
  };
}

const ASC = [0, 1, 2, 3];
const LOOP = [0, 3, 2, 1]; // non-monotonic: the canvas' full-scan path
const FLAT_X = [5, 5, 5, 5];

type Lim = [number, number];
interface Case {
  name: string;
  time: number[];
  view: Partial<PlotView>;
  /** M's values, when not `M` (NaN: a blank row). */
  m?: number[];
  /** The view of each flat axis (the other axes are not this rule's). */
  want: { x?: Lim; y?: Lim; y2?: Lim };
}

const CASES: Case[] = [
  { name: "flat y2, linear (the 1000 Oe field)", time: ASC, view: { yKeys: [0, 1], y2Keys: [1] }, want: { y2: [0, 2000] } },
  { name: "flat y, linear", time: ASC, view: { yKeys: [1] }, want: { y: [0, 2000] } },
  { name: "flat y, linear, snapped to a tenth of its decade", time: ASC, view: { yKeys: [2] }, want: { y: [0, 2500] } },
  { name: "flat negative y", time: ASC, view: { yKeys: [3] }, want: { y: [-10, 0] } },
  { name: "flat zero y", time: ASC, view: { yKeys: [4] }, want: { y: [0, 100] } },
  { name: "flat y, log", time: ASC, view: { yKeys: [1], yScale: "log" }, want: { y: [100, 10000] } },
  { name: "flat y, log, off a decade", time: ASC, view: { yKeys: [5], yScale: "log" }, want: { y: [0.3, 100] } },
  {
    name: "flat y2, log",
    time: ASC,
    view: { yKeys: [0, 5], y2Keys: [5], y2Scale: "log" },
    want: { y2: [0.3, 100] },
  },
  { name: "loop: flat y2, linear", time: LOOP, view: { yKeys: [0, 1], y2Keys: [1] }, want: { y2: [0, 2000] } },
  { name: "loop: flat y, linear", time: LOOP, view: { yKeys: [2] }, want: { y: [0, 2500] } },
  { name: "loop: flat y, log", time: LOOP, view: { yKeys: [5], yScale: "log" }, want: { y: [0.3, 100] } },
  { name: "flat x, linear", time: FLAT_X, view: { yKeys: [0] }, want: { x: [0, 10] } },
  {
    // A blank end row: the canvas scans x (`fullXExtents`), not uPlot's own.
    name: "flat x, linear, blank end row",
    time: FLAT_X,
    m: [NaN, 4, 2, 3],
    view: { yKeys: [0] },
    want: { x: [0, 10] },
  },
  { name: "flat x, log", time: FLAT_X, view: { yKeys: [0], xScale: "log" }, want: { x: [0.5, 100] } },
];

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), ...c.view });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** A real uPlot instance drawing `c` the way the Stage does. */
async function canvas(c: Case): Promise<uPlot> {
  const ds = dataset(c.time, c.m);
  const view = viewOf(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(ds.data, view.y2Keys, view.xKey, channels), {
    id: ds.id, waterfall: view.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(),
    xScale: view.xScale, yScale: view.yScale, ...(view.y2Scale ? { y2Scale: view.y2Scale } : {}),
    hidden: payload.series.map(() => false),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "Flat", datasetId: "d1", view: viewOf(c) });
  return buildFigureSpecFromDocument(doc, dataset(c.time, c.m), "flat", { fmt: "svg" });
}

// The rule's own numbers, for the backend's port (`flat_auto_range`) to match
// bit for bit: flat spans across magnitudes and signs, and near-flat ones
// (uPlot calls a span 11+ decades below the values flat).
const SPANS: [number, number][] = [
  ...[1, 1.234, 2.5, 3, 4.56789, 9.99].flatMap((m) =>
    [-24, -9, -7, -6, -3, 0, 2, 3, 8, 21].flatMap((e): [number, number][] => [[m * 10 ** e, m * 10 ** e], [-m * 10 ** e, -m * 10 ** e]]),
  ),
  [0, 0], [299.99, 299.99], [1e8, 1e8 + 1e-3], [1000, 1000.00000001], [-2.5, -2.5 + 1e-12], [0, 5e-25], [-5e-25, 0],
];

function fresh() {
  return {
    cases: CASES.map((c) => ({ name: c.name, request: request(c), want: c.want })),
    range_num: SPANS.map(([lo, hi]) => [lo, hi, uPlot.rangeNum(lo, hi, 0.1, true)]),
  };
}

describe("a flat channel autoscales by uPlot's rule, screen == export", () => {
  it.each(CASES)("canvas: $name", async (c) => {
    const u = await canvas(c);
    for (const [key, lim] of Object.entries(c.want)) {
      expect([u.scales[key].min, u.scales[key].max].map((v) => (v as number) + 0), key).toEqual(lim); // + 0: -0 -> 0
    }
  });

  it("the rule is uPlot's own helpers", () => {
    expect(uPlot.rangeNum(1000, 1000, 0.1, true)).toEqual([0, 2000]);
    expect(uPlot.rangeNum(1234, 1234, 0.1, true)).toEqual([0, 2500]);
    expect(uPlot.rangeNum(-5, -5, 0.1, true)).toEqual([-10, 0]);
    expect(uPlot.rangeNum(0, 0, 0.1, true).map((v) => (v as number) + 0)).toEqual([0, 100]);
    expect(uPlot.rangeLog(3, 3, 10, false)).toEqual([0.3, 100]);
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.FLAT_AUTOSCALE_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
