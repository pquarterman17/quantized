// Parity for the live repaint (lib/uplotLivePaint.ts): a display-only edit
// patched onto a live instance must draw exactly what a fresh `buildOpts`
// with the same inputs would. The "instance" here is the opts' own series
// objects (uPlot keeps them as its live series), driven through the same
// setSeries/redraw/batch surface PlotViewport uses.

import type uPlot from "uplot";
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import type { SeriesStyle } from "./types";
import { applyLivePaint, bindLivePaint, livePaintOf, styleStructureKey, type LivePaintRef } from "./uplotLivePaint";
import { buildOpts, seriesColorsFor, type BuildOptsArgs } from "./uplotOpts";
import { buildSeriesDefs } from "./uplotSeries";

const THREE: PlotPayload = {
  data: [
    [0, 1, 2, 3],
    [10, 20, 30, 40],
    [5, 6, 7, 8],
    [1, 2, 1, 2],
  ],
  series: [
    { label: "A", unit: "" },
    { label: "B", unit: "" },
    { label: "C", unit: "", kind: "points" },
  ],
  xLabel: "x",
  xUnit: "",
};

type Args = Omit<BuildOptsArgs, "width" | "height" | "xScale" | "yScale" | "tool" | "onReadout">;

function fullArgs(a: Args): BuildOptsArgs {
  return { width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(), plotted: [0, 1, 2], ...a };
}

/** A stand-in live instance over `opts`' series, recording its calls. */
function liveOf(opts: uPlot.Options) {
  const calls: unknown[][] = [];
  const u = {
    series: opts.series,
    scales: { x: { min: 0, max: 3 }, y: { min: 0, max: 50 } },
    batch: (fn: () => void) => fn(),
    redraw: (rebuild?: boolean) => calls.push(["redraw", rebuild]),
    setScale: (k: string, v: unknown) => calls.push(["setScale", k, v]),
    setSeries: (i: number, o: { show: boolean }) => {
      calls.push(["setSeries", i, o]);
      opts.series[i].show = o.show;
    },
  } as unknown as uPlot;
  return { u, calls };
}

const val = (u: uPlot, v: unknown, i: number): unknown => (typeof v === "function" ? (v as (u: uPlot, i: number) => unknown)(u, i) : v);

/** Every paint value the next draw of `u`'s series/bands would use. */
function drawnPaint(u: uPlot, series: uPlot.Series[], bands: uPlot.Band[]) {
  return {
    series: series.slice(1).map((s, k) => ({
      stroke: val(u, s.stroke, k + 1),
      fill: val(u, s.fill, k + 1),
      pStroke: val(u, s.points?.stroke, k + 1),
      pFill: val(u, s.points?.fill, k + 1),
      width: s.width,
      dash: s.dash,
      show: s.show,
    })),
    bands: bands.map((b, bi) => val(u, b.fill, bi)),
  };
}

function patch(from: Args, to: Args) {
  const opts = buildOpts(THREE, fullArgs(from));
  const ref: LivePaintRef = { current: null };
  bindLivePaint(opts, ref);
  const { u, calls } = liveOf(opts);
  const toArgs = fullArgs(to);
  const { series, bands } = buildSeriesDefs(THREE, toArgs, [], true, seriesColorsFor(toArgs.bg));
  const ok = applyLivePaint(u, ref, livePaintOf(series, bands), { y: [0, 50], y2: null });
  return { ok, u, opts, calls, fresh: buildOpts(THREE, toArgs) };
}

const RED: SeriesStyle = { color: "#e03030" };
const BLUE: SeriesStyle = { color: "#30a0e0" };

describe("applyLivePaint — a patched instance draws what a rebuild would", () => {
  const cases: [string, Args, Args][] = [
    ["line colour + width + dash", { seriesStyles: [RED] }, { seriesStyles: [{ ...BLUE, width: 3, line: "dotted" }] }],
    ["glyph marker colour", { seriesStyles: [{ ...RED, marker: true, markerShape: "square" }] }, { seriesStyles: [{ ...BLUE, marker: true, markerShape: "square" }] }],
    ["circle marker colour", { seriesStyles: [{ ...RED, marker: true }] }, { seriesStyles: [{ ...BLUE, marker: true }] }],
    ["fill-under colour", { seriesStyles: [{ ...RED, fill: "under" }] }, { seriesStyles: [{ ...BLUE, fill: "under" }] }],
    ["band colour", { seriesStyles: [{ ...RED, fill: { vs: 1 } }] }, { seriesStyles: [{ ...BLUE, fill: { vs: 1 } }] }],
    ["hide + show", { hidden: [false, true, false] }, { hidden: [true, false, false] }],
    ["palette to literal on the points-kind series", {}, { seriesStyles: [undefined, undefined, BLUE] }],
  ];
  it.each(cases)("%s", (_name, from, to) => {
    const { ok, u, opts, fresh } = patch(from, to);
    expect(ok).toBe(true);
    const freshU = liveOf(fresh).u;
    expect(drawnPaint(u, opts.series, opts.bands ?? [])).toEqual(drawnPaint(freshU, fresh.series, fresh.bands ?? []));
  });

  it("toggles visibility with setSeries on the uPlot index and re-applies the committed y limit", () => {
    const { calls } = patch({ hidden: [false, false, false] }, { hidden: [false, true, false] });
    expect(calls).toEqual([
      ["setSeries", 2, { show: false }],
      ["redraw", false],
      ["setScale", "y", { min: 0, max: 50 }],
    ]);
  });

  it("a colour-only edit redraws without rebuilding paths or touching scales", () => {
    const { calls } = patch({ seriesStyles: [RED] }, { seriesStyles: [BLUE] });
    expect(calls).toEqual([["redraw", false]]);
  });

  it("a width edit rebuilds the cached paths (the gap clips are width-sized)", () => {
    const { calls } = patch({ seriesStyles: [RED] }, { seriesStyles: [{ ...RED, width: 4 }] });
    expect(calls[0]).toEqual(["redraw", true]);
  });

  it("an unchanged paint does nothing at all", () => {
    const { ok, calls } = patch({ seriesStyles: [RED] }, { seriesStyles: [{ ...RED }] });
    expect(ok).toBe(true);
    expect(calls).toEqual([]);
  });

  it("refuses (caller rebuilds) when the series structure differs", () => {
    const { ok, calls, u } = patch({ seriesStyles: [RED] }, { seriesStyles: [{ ...RED, marker: true, markerShape: "diamond" }] });
    expect(ok).toBe(false);
    expect(calls).toEqual([]);
    expect(val(u, u.series[1].stroke, 1)).toBe("#e03030"); // untouched
  });
});

describe("styleStructureKey", () => {
  const key = (s: (SeriesStyle | undefined)[], trace?: "Line" | "Step" | "Scatter") => styleStructureKey(s, trace, 1.5);

  it("ignores colour, width (while drawn) and dash", () => {
    expect(key([RED])).toBe(key([{ ...BLUE, width: 4, line: "dashed" }]));
  });

  it("changes for markers, fill kind, step and colour-by", () => {
    const k = key([RED]);
    for (const extra of [{ marker: true }, { fill: "under" as const }, { step: "pre" as const }, { colorBy: 2 }]) {
      expect(key([{ ...RED, ...extra }])).not.toBe(k);
    }
  });

  it("reads no style, a paint-only style and a missing list as the same structure", () => {
    expect(key([undefined, undefined])).toBe(key([RED, { width: 3, line: "dashed" }]));
    expect(styleStructureKey(undefined, "Line", 1.5)).toBe(key([RED]));
    expect(key([undefined, { marker: true }])).not.toBe(key([{ marker: true }, undefined]));
  });

  it("changes when a line stops being drawn (width 0)", () => {
    expect(key([{ ...RED, width: 0 }])).not.toBe(key([RED]));
  });

  it("under the Step trace, setting a dash at all is structural", () => {
    expect(key([RED], "Step")).not.toBe(key([{ ...RED, line: "dashed" }], "Step"));
    expect(key([{ ...RED, line: "dotted" }], "Step")).toBe(key([{ ...RED, line: "dashed" }], "Step"));
  });
});
