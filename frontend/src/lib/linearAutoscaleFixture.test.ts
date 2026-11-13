// A linear axis with a real span autoscales the same on screen and in export
// (publication-figures audit #11), pinned as a SHARED wire fixture
// (`tests/fixtures/wire/linear_autoscale.json`).
//
// THE RULE — the canvas' own, which the export now follows
// (`calc/figure_autoscale.py`):
//   x, ascending:      exactly the data, [min, max] (uPlot's autoScaleX) —
//                      the audit's screen read 0.1..9.9 where the export
//                      padded to 0..10.4, moving every data-anchored text box.
//   y, ascending x:    `rangeNum(min, max, 0.1, true)` — 10% of the span each
//                      side, snapped out to a tenth of the span's decade,
//                      soft at zero.
//   non-ascending x:   the full-scan path (`padXDomain` / `fullYExtents`):
//                      x 2% each side, y 10% soft at zero, no snap.
// The flat (zero-span) case is `flatAutoscaleFixture.test.ts`'s.
//
// Each case hand-states the view; the canvas half asserts a REAL uPlot
// instance lands there, the backend half (`tests/test_export_linear_autoscale.py`)
// the exported axes. `range_num` pins uPlot's helper bit for bit.
//
// Regenerate only after a DELIBERATE rule change:
//   LINEAR_AUTOSCALE_FIXTURE_WRITE=1 npx vitest run src/lib/linearAutoscaleFixture.test.ts

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
  "..", "..", "..", "tests", "fixtures", "wire", "linear_autoscale.json",
);

type Lim = [number, number];
interface Case {
  name: string;
  time: number[];
  y: number[];
  want: { x: Lim; y: Lim };
}

const DECAY_X = [0.1, 2.5, 5, 7.5, 9.9];
const CASES: Case[] = [
  { name: "ascending x, positive y (soft at zero)", time: DECAY_X, y: [100, 80, 45, 20, 3], want: { x: [0.1, 9.9], y: [0, 110] } },
  { name: "y across zero", time: DECAY_X, y: [-3, 1, 4, -2, 0.5], want: { x: [0.1, 9.9], y: [-3.7, 4.7] } },
  { name: "all-negative y", time: DECAY_X, y: [-10, -20, -5, -8, -12], want: { x: [0.1, 9.9], y: [-22, -3] } },
  { name: "offset y, snapped to a tenth of the span's decade", time: [1, 2, 3], y: [1234, 1290, 1251], want: { x: [1, 3], y: [1228, 1296] } },
  { name: "loop: non-ascending x scans", time: [0, 3, 2, 1, -1], y: [1, 4, 2, 3, 0.5], want: { x: [-1.08, 3.08], y: [0.15, 4.35] } },
];

function dataset(c: Case): Dataset {
  return {
    id: "d1",
    name: "linear",
    data: { time: c.time, values: c.y.map((v) => [v]), labels: ["S"], units: ["a.u."], metadata: {} },
  };
}

const view = (): PlotView => ({ ...defaultPlotView(), yKeys: [0] });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** A real uPlot instance drawing `c` the way the Stage does. */
async function canvas(c: Case): Promise<uPlot> {
  const ds = dataset(c);
  const v = view();
  const channels = effectiveChannels(ds.data, v.yKeys, v.xKey, ds.channelRoles, v.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(ds.data, v.y2Keys, v.xKey, channels), {
    id: ds.id, waterfall: v.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(),
    xScale: v.xScale, yScale: v.yScale, hidden: payload.series.map(() => false),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "Linear", datasetId: "d1", view: view() });
  return buildFigureSpecFromDocument(doc, dataset(c), "linear", { fmt: "svg" });
}

// Real spans across magnitudes and signs, for the backend's `range_num` port.
const SPANS: [number, number][] = [
  [3, 100], [-3, 4], [-20, -5], [1234, 1296], [0.001, 0.0042], [-1e-7, 3e-7], [1e5, 3.3e6],
  [0.1, 9.9], [-250, -0.5], [12.34, 12.35], [0, 1], [-1, 0], [2.5e-12, 7.1e-12],
];

function fresh() {
  return {
    cases: CASES.map((c) => ({ name: c.name, request: request(c), want: c.want })),
    range_num: SPANS.map(([lo, hi]) => [lo, hi, uPlot.rangeNum(lo, hi, 0.1, true)]),
  };
}

describe("a linear axis autoscales by the canvas' rule, screen == export", () => {
  it.each(CASES)("canvas: $name", async (c) => {
    const u = await canvas(c);
    for (const key of ["x", "y"] as const) {
      const got = [u.scales[key].min as number, u.scales[key].max as number];
      expect(got[0], key).toBeCloseTo(c.want[key][0], 10);
      expect(got[1], key).toBeCloseTo(c.want[key][1], 10);
    }
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.LINEAR_AUTOSCALE_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
