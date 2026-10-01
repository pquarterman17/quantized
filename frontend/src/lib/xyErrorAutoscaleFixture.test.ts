// Error bars in the XY AUTOSCALE, screen == export, pinned as a SHARED wire
// fixture (`tests/fixtures/wire/xy_error_autoscale.json`).
//
// matplotlib's autoscale covers every errorbar artist, on X and Y alike, so
// the export never cuts a bar off. The canvas now does the same
// (`lib/uplotErrorRange.ts`). Each case below hand-states the data domain an
// auto-scaled axis must cover — every DRAWN point and both ends of every drawn
// bar; a hidden series counts for neither — and the canvas half asserts a REAL
// uPlot instance's scales are that domain ranged by the canvas' rule (uPlot's
// own for an ascending X, the full-scan pad for a loop). The backend half
// (`tests/test_export_xy_error_autoscale.py`) asserts matplotlib's autoscaled
// limits are the SAME domain padded by its margins. An explicit limit wins.
//
// Regenerate only after a DELIBERATE rule change:
//   XY_ERROR_FIXTURE_WRITE=1 npx vitest run src/lib/xyErrorAutoscaleFixture.test.ts

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

import { buildErrorSpans } from "./errorbars";
import type { ErrorBinding } from "./errorRoles";
import { createFigureDocument } from "./figureDocument";
import { buildFigureSpecFromDocument } from "./figureSpec";
import { buildColumns, composeDisplayPayload, effectiveChannels } from "./plotdata";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";
import { buildOpts } from "./uplotOpts";
import { padXDomain } from "./uplotXRange";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "tests", "fixtures", "wire", "xy_error_autoscale.json",
);

// Channels: 0 S1, 1 dS1 (y error), 2 dX (x error), 3 S2, 4 dS2 (S2's y error).
function dataset(time: number[], s1: number[]): Dataset {
  const dS1 = [1, 5, 1, 1];
  const dX = [0.5, 0.5, 2, 0.5];
  const s2 = [11, 12, 11, 12];
  const dS2 = [100, 100, 100, 100];
  return {
    id: "d1",
    name: "errors",
    data: {
      time,
      values: time.map((_, r) => [s1[r], dS1[r], dX[r], s2[r], dS2[r]]),
      labels: ["S1", "dS1", "dX", "S2", "dS2"],
      units: ["a.u.", "a.u.", "a.u.", "a.u.", "a.u."],
      metadata: {},
    },
  };
}

const Y_ERR: ErrorBinding = { channel: 1, target: 0, axis: "y", side: "both" };
const X_ERR: ErrorBinding = { channel: 2, target: -1, axis: "x", side: "both" };
const S2_ERR: ErrorBinding = { channel: 4, target: 3, axis: "y", side: "both" };

interface Case {
  name: string;
  time: number[];
  s1: number[];
  view: Partial<PlotView>;
  errors: ErrorBinding[];
  /** The [x, y] data domains the autoscale must cover (null: an explicit limit). */
  domain: { x: [number, number]; y: [number, number] } | null;
}

// S1 at x 0..3 is 10..13. Its y bars reach 9..11, 6..16, 11..13, 12..14, and
// the x bars -0.5..0.5, 0.5..1.5, 0..4, 2.5..3.5.
const ASC = { time: [0, 1, 2, 3], s1: [10, 11, 12, 13] };
const CASES: Case[] = [
  {
    name: "x and y error bars widen both axes",
    ...ASC,
    view: { yKeys: [0] },
    errors: [Y_ERR, X_ERR],
    domain: { x: [-0.5, 4], y: [6, 16] },
  },
  {
    name: "no error bars: the data alone",
    ...ASC,
    view: { yKeys: [0] },
    errors: [],
    domain: { x: [0, 3], y: [10, 13] },
  },
  {
    name: "a hidden series' bars do not count",
    ...ASC,
    view: { yKeys: [0, 3], hiddenChannels: [3] },
    errors: [Y_ERR, X_ERR, S2_ERR],
    domain: { x: [-0.5, 4], y: [6, 16] },
  },
  {
    // A loop (x 0, 3, 2, 1): the full-scan path, not uPlot's own.
    name: "non-monotonic x",
    time: [0, 3, 2, 1],
    s1: [10, 13, 12, 11],
    view: { yKeys: [0] },
    errors: [Y_ERR, X_ERR],
    // y bars 9..11, 8..18, 11..13, 10..12; x bars -0.5..0.5, 2.5..3.5, 0..4, 0.5..1.5
    domain: { x: [-0.5, 4], y: [8, 18] },
  },
  {
    name: "explicit limits win",
    ...ASC,
    view: { yKeys: [0], xLim: [0.5, 2.5], yLim: [10, 12] },
    errors: [Y_ERR, X_ERR],
    domain: null,
  },
];

function viewOf(c: Case): PlotView {
  return { ...defaultPlotView(), ...c.view };
}

const live: uPlot[] = [];
afterEach(() => {
  for (const u of live.splice(0)) u.destroy();
});

/** A real uPlot instance drawing `c` the way the Stage does: the composed
 *  payload, the error spans `usePlotPayload` builds, the hidden flags. */
async function canvas(c: Case): Promise<uPlot> {
  const ds = dataset(c.time, c.s1);
  const view = viewOf(c);
  const channels = effectiveChannels(ds.data, view.yKeys, view.xKey, ds.channelRoles, view.seriesOrder);
  const payload = composeDisplayPayload(buildColumns(ds.data, null, view.xKey, channels), {
    id: ds.id, waterfall: view.waterfall, dropped: new Set(), excludedDisplay: "hide",
    fitOverlay: null, baselineOverlay: null, peakOverlay: null, derivOverlay: null, selection: null,
  });
  const errorSpans = buildErrorSpans(ds.data, channels, c.errors);
  const hidden = payload.series.map((_, i) => i < channels.length && view.hiddenChannels.includes(channels[i]));
  const opts = buildOpts(payload, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    hidden, errorSpans, xLim: view.xLim, yLim: view.yLim,
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const u = new uPlot(opts, payload.data as uPlot.AlignedData, host);
  live.push(u);
  await new Promise((r) => setTimeout(r, 0)); // uPlot commits its scales async
  return u;
}

const scaleOf = (u: uPlot, key: string) => [u.scales[key].min, u.scales[key].max];

/** The canvas' range rule for a domain: uPlot's own (exact X, soft-padded Y)
 *  for an ascending X; the full-scan pads (`padXDomain`, 10% Y) for a loop. */
function canvasWant(c: Case, d: { x: [number, number]; y: [number, number] }) {
  const loop = c.time.some((t, i) => i > 0 && t < c.time[i - 1]);
  if (!loop) return { x: d.x, y: uPlot.rangeNum(d.y[0], d.y[1], 0.1, true) };
  const pad = (d.y[1] - d.y[0]) * 0.1;
  return { x: padXDomain(d.x, false), y: [d.y[0] - pad, d.y[1] + pad] };
}

function request(c: Case) {
  const doc = createFigureDocument({ id: "w1", name: "Errors", datasetId: "d1", view: viewOf(c), errors: c.errors });
  return buildFigureSpecFromDocument(doc, dataset(c.time, c.s1), "errors", { fmt: "svg" });
}

function fresh() {
  return {
    cases: CASES.map((c) => ({
      name: c.name,
      request: request(c),
      x_domain: c.domain?.x ?? null,
      y_domain: c.domain?.y ?? null,
      x_lim: c.view.xLim ?? null,
      y_lim: c.view.yLim ?? null,
    })),
  };
}

describe("XY autoscale covers every drawn error bar, screen == export", () => {
  it.each(CASES)("canvas: $name", async (c) => {
    const u = await canvas(c);
    if (!c.domain) {
      expect(scaleOf(u, "x")).toEqual(c.view.xLim);
      expect(scaleOf(u, "y")).toEqual(c.view.yLim);
      return;
    }
    const want = canvasWant(c, c.domain);
    expect(scaleOf(u, "x")[0]).toBeCloseTo(want.x[0] as number, 12);
    expect(scaleOf(u, "x")[1]).toBeCloseTo(want.x[1] as number, 12);
    expect(scaleOf(u, "y")[0]).toBeCloseTo(want.y[0] as number, 12);
    expect(scaleOf(u, "y")[1]).toBeCloseTo(want.y[1] as number, 12);
  });

  it("a zoom wins on X, and Y autoscales to the bars inside it", async () => {
    const u = await canvas(CASES[0]);
    u.setScale("x", { min: 1.5, max: 3.5 });
    await new Promise((r) => setTimeout(r, 0));
    expect(scaleOf(u, "x")).toEqual([1.5, 3.5]);
    // Rows x=2, 3 draw y bars 11..13 and 12..14; the 6..16 bar at x=1 is outside.
    expect(scaleOf(u, "y")).toEqual(uPlot.rangeNum(11, 14, 0.1, true));
  });

  it("the requests carry the bars (so the export has something to cover)", () => {
    expect(request(CASES[0]).error_spans?.[0]).toMatchObject({ x: expect.anything(), y: expect.anything() });
    expect(request(CASES[1]).error_spans).toBeUndefined();
  });

  it("matches the committed fixture the backend half reads", () => {
    const now = fresh();
    if (process.env.XY_ERROR_FIXTURE_WRITE) {
      writeFileSync(FIXTURE, `${JSON.stringify(now, null, 2)}\n`, "utf8");
    }
    expect(JSON.parse(readFileSync(FIXTURE, "utf8"))).toEqual(JSON.parse(JSON.stringify(now)));
  });
});
