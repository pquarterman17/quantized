// Analysis overlays never drive the Y autoscale, on screen AND in the export
// (UX audit 7 #8, lane UX-I), pinned as a SHARED wire fixture
// (`tests/fixtures/wire/overlay_autoscale.json`).
//
// THE RULE (lib/overlayAutoscale.ts; the export's calc/figure_overlay_scale.py):
// a fit curve, its band edges, a baseline and peak markers are left out of
// their axis' auto range whenever a data series is drawn on that axis. Each
// case puts an overlay BELOW the data -- the audit's fitted linear background
// diving through zero, which dragged a log axis to 1e-3 -- and hand-states the
// view of the data alone. The canvas half asserts a REAL uPlot instance lands
// there; the request half pins the exact Stage export request (overlays marked
// by `analysis_overlays`); the backend half
// (`tests/test_export_overlay_autoscale.py`) asserts the exported axes land on
// the same view: screen range == export range.
//
// Regenerate only after a DELIBERATE rule change:
//   OVERLAY_AUTOSCALE_FIXTURE_WRITE=1 npx vitest run src/lib/overlayAutoscaleFixture.test.ts

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

import type { FigureSpec } from "./api/figures";
import type { StoreGet } from "./exportActive";
import { createFigureDocument } from "./figureDocument";
import { buildStageFigureSpec } from "./figureSpecStage";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { BaselineOverlay, Dataset, FitOverlay } from "./types";
import { buildOpts } from "./uplotOpts";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "overlay_autoscale.json",
);

type Lim = [number, number];
const X = [5, 15, 25, 35, 45, 55, 65, 75, 85];
const DECAY = [80, 52, 400, 30, 24, 120, 17, 15, 14]; // a log-Y XRD-like trace, two peaks
const ON_0 = { yKey: 0, xKey: null };

interface Case {
  name: string;
  y: number[];
  yScale: "log" | "linear";
  fit: FitOverlay | null;
  baseline: BaselineOverlay | null;
  want: Lim;
}

const CASES: Case[] = [
  {
    name: "log Y: a fitted linear background diving through zero",
    y: DECAY, yScale: "log",
    fit: { datasetId: "d1", binding: ON_0, y: DECAY.map((v) => v * 0.98) },
    baseline: { datasetId: "d1", binding: ON_0, y: X.map((x) => 40 - 0.5 * x) }, // 37.5 .. -2.5, ~0 at 80
    want: [10, 1000],
  },
  {
    name: "linear Y: a baseline far below the data",
    y: [60, 72, 95, 70, 64, 61], yScale: "linear",
    fit: null,
    baseline: { datasetId: "d1", binding: ON_0, y: [-40, -30, -20, -10, 0, 10] },
    want: [56, 99],
  },
  {
    name: "linear Y: a fit band whose lower edge runs below the data",
    y: [60, 72, 95, 70, 64, 61], yScale: "linear",
    fit: {
      datasetId: "d1", binding: ON_0, y: [61, 71, 94, 71, 63, 61],
      band: [
        { label: "95% CI low", y: [5, 6, 7, 8, 9, 10], legend: "95% confidence band" },
        { label: "95% CI high", y: [70, 80, 100, 80, 70, 70], legend: "" },
      ],
    },
    baseline: null,
    want: [56, 99],
  },
];

function dataset(c: Case): Dataset {
  return {
    id: "d1",
    name: "scan",
    data: { time: X.slice(0, c.y.length), values: c.y.map((v) => [v]), labels: ["I"], units: ["cps"], metadata: {} },
  };
}

const viewOf = (c: Case): PlotView => ({ ...defaultPlotView(), yKeys: [0], yScale: c.yScale });

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** A real uPlot instance drawing `c`, overlays composed, as the Stage does. */
async function canvas(c: Case): Promise<uPlot> {
  const ds = dataset(c);
  const v = viewOf(c);
  const channels = effectiveChannels(ds.data, v.yKeys, v.xKey, undefined, v.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(ds.data, v.y2Keys, v.xKey, channels), {
    id: "d1", waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: c.fit, baselineOverlay: c.baseline, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(),
    xScale: "linear", yScale: c.yScale, hidden: payload.series.map(() => false),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

/** The request the Stage export sends for the same view and overlays. */
function request(c: Case): FigureSpec {
  const view = viewOf(c);
  const document = createFigureDocument({ id: "w1-doc", name: "Fit", datasetId: "d1", view });
  const get = (() => ({
    ...view,
    focusedWindowId: "w1",
    windowsForSave: () => [{ id: "w1", kind: "plot", document }],
    autoSeriesStyles: false, defaultTrace: "Line", defaultLineWidth: 1.5, excludedDisplay: "hide",
    fitOverlay: c.fit, baselineOverlay: c.baseline, peakOverlay: null,
  })) as unknown as StoreGet;
  return buildStageFigureSpec(get, dataset(c), "scan", { fmt: "svg", style: "default", dpi: 100, title: "", xLabel: "", yLabel: "" });
}

const built = CASES.map((c) => ({ name: c.name, request: request(c), want: c.want }));

describe("overlay autoscale: screen == export (shared wire fixture)", () => {
  it.each(CASES)("canvas: $name", async (c) => {
    const u = await canvas(c);
    expect(u.scales.y.min).toBeCloseTo(c.want[0], 10);
    expect(u.scales.y.max).toBeCloseTo(c.want[1], 10);
    // The case is live: some overlay reaches below the view the data gives.
    const overlayMin = Math.min(
      ...[c.fit?.y ?? [], ...(c.fit?.band ?? []).map((e) => e.y), c.baseline?.y ?? []]
        .flat()
        .filter((v): v is number => v !== null && (c.yScale === "linear" || v > 0)),
    );
    expect(overlayMin).toBeLessThan(c.want[0]);
  });

  it("the export requests carry the overlays, marked, and match the committed fixture", () => {
    for (const b of built) {
      const flags = b.request.analysis_overlays ?? [];
      expect(flags.some(Boolean), b.name).toBe(true);
      expect(flags).toHaveLength(b.request.y_keys!.length);
    }
    if (process.env.OVERLAY_AUTOSCALE_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify({
        about: "UX audit 7 #8 (lane UX-I): analysis overlays never drive the Y autoscale. `want` is the Y view the canvas draws (the data's alone); the backend leg asserts the exported axes land there. Legs: frontend/src/lib/overlayAutoscaleFixture.test.ts and tests/test_export_overlay_autoscale.py.",
        cases: built,
      }, null, 2)}\n`, "utf8");
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: typeof built };
    expect(fixture.cases).toEqual(JSON.parse(JSON.stringify(built)));
  });
});
