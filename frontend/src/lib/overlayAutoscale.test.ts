// UX audit 7 #8 (lane UX-I): analysis overlays never drive the Y autoscale.
// A Peak Analyzer fit on a log-Y XRD pattern drew its fitted LINEAR background
// diving through zero, and the log autoscale followed it down to 10^-3. The
// canvas half asserts a REAL uPlot instance's scales, as
// flatAutoscaleFixture.test.ts does.

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

import { offAutoscale } from "./overlayAutoscale";
import { composeDisplayPayload, type DisplayCompose, type PlotPayload } from "./plotdata";
import type { AxisScale } from "./types";
import { fullYExtents } from "./uplotErrorRange";
import { buildOpts } from "./uplotOpts";

const N = 40;
const X = Array.from({ length: N }, (_, i) => 5 + i * 2); // 2θ 5..83, ascending
const LOOP_X = X.map((x, i) => (i % 2 ? x : 90 - x)); // non-monotonic: the full-scan path
// A decaying pattern with two peaks, 15..80 counts.
const Y = X.map((x) => 15 + 60 * Math.exp(-x / 30) + (Math.abs(x - 33) < 2 ? 300 : 0) + (Math.abs(x - 57) < 2 ? 120 : 0));
// The fitted linear background: positive, then tiny, then through zero.
const BG = X.map((x) => 40 - 0.4999 * x);
const FIT = Y.map((y, i) => y + BG[i]! * 0.01);
const DERIV = Y.map((y, i) => (i ? y - Y[i - 1]! : 0));

const base = (xs = X): PlotPayload => ({
  data: [xs, Y] as uPlot.AlignedData,
  series: [{ label: "Intensity", unit: "cps" }],
  xLabel: "2θ",
  xUnit: "deg",
});

const compose = (p: PlotPayload, extra: Partial<DisplayCompose>): PlotPayload =>
  composeDisplayPayload(p, {
    id: "d1", waterfall: 0, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null, ...extra,
  });

const binding = { yKey: 0, xKey: null };
const overlays: Partial<DisplayCompose> = {
  fitOverlay: { datasetId: "d1", binding, y: FIT, band: [{ label: "lo", y: BG }, { label: "hi", y: FIT }] },
  baselineOverlay: { datasetId: "d1", binding, y: BG },
  peakOverlay: { datasetId: "d1", binding, y: X.map((x, i) => (x === 33 ? Y[i]! : null)) },
};

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

async function yRange(payload: PlotPayload, yScale: AxisScale, hidden?: boolean[]): Promise<[number, number]> {
  const opts = buildOpts(payload, {
    width: 600, height: 400, tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale,
    hidden: hidden ?? payload.series.map(() => false),
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return [u.scales.y.min!, u.scales.y.max!];
}

describe("analysis overlays never change the autoscaled Y range", () => {
  it.each(["log", "linear"] as const)("fit, band, baseline and peak overlays leave a %s Y on the data", async (scale) => {
    const bare = await yRange(base(), scale);
    const withOverlays = compose(base(), overlays);
    expect(withOverlays.series.length).toBe(6); // data, fit, 2 band edges, baseline, peaks
    expect(await yRange(withOverlays, scale)).toEqual(bare);
  });

  it("a log Y stays within one decade of the data minimum, not 10^-3", async () => {
    const [lo] = await yRange(compose(base(), overlays), "log");
    expect(lo).toBeGreaterThanOrEqual(Math.min(...Y) / 10);
  });

  it("the full-scan (non-monotonic X) path ignores the overlays too", () => {
    for (const positiveOnly of [true, false]) {
      const bare = fullYExtents(base(LOOP_X), undefined, 0, positiveOnly);
      expect(fullYExtents(compose(base(LOOP_X), overlays), undefined, 0, positiveOnly)).toEqual(bare);
    }
  });

  it("an overlay alone on its axis still ranges it (the dy/dx preview on Y2)", async () => {
    const p = compose(base(), { derivOverlay: { datasetId: "d1", binding, y: DERIV } });
    expect(offAutoscale(p.series)).toEqual([false, false]);
    const opts = buildOpts(p, { width: 600, height: 400, tool: "zoom", onReadout: vi.fn(), xScale: "linear", yScale: "linear" });
    expect(opts.series[2]?.auto).not.toBe(false);
  });

  it("with every data series hidden, the overlays range the axis again", () => {
    const p = compose(base(), overlays);
    expect(offAutoscale(p.series)).toEqual([false, true, true, true, true, true]);
    expect(offAutoscale(p.series, [true, false, false, false, false, false])).toEqual(p.series.map(() => false));
  });
});
