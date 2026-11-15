// Gap audit 3, N5 + N6 on the canvas and on the wire: marker size from a
// column, drop lines and spline connect. The Python half is
// tests/test_calc_figure_marks.py; both read the SAME wire keys
// (`size_by` / `size_range` / `drop_lines` / `connect`).

import { renderHook, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { buildColorByColumns, colorScaleLegendEntries, type ColorScatterSpec } from "./colorscatter";
import { buildExportStyles, toWireSeriesStyles } from "./exportStyles";
import { portableStyle, seriesStyleFromExport } from "./graphFormat";
import { marks, useMarksVersion } from "./marksLoader";
import { sizeScatterPlugin, withSizes } from "./marksImpl";
import { sanitizeExportSeriesStyles } from "./publicationStyles";
import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import { dropLinesPlugin } from "./uplotDropLines";
import { colorScatterPlugin } from "./uplotOverlays";
import type { DataStruct } from "./types";

import { regionDecorSettled } from "./regionDecorLoader";

// The colour-mapped scatter draws from the startup chunk (lib/uplotScatterDraw.ts).
beforeAll(() => regionDecorSettled);

const ds: DataStruct = {
  time: [0, 1, 2, 3],
  values: [[10, 0], [20, 1], [15, 2], [30, 4]],
  labels: ["M", "mass"],
  units: ["emu", "g"],
  metadata: {},
};
const payload: PlotPayload = {
  data: [[1, 2, 3, 4], [10, 20, 15, 30]],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "H",
  xUnit: "Oe",
};
const opts = (style: unknown, p: PlotPayload = payload, extra: object = {}) =>
  buildOpts(p, {
    width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
    plotted: [0], seriesStyles: [style] as never, ...extra,
  });


// The marks are a lazy chunk (lib/marksLoader.ts). FIRST in this file, before anything has
// loaded it: until it arrives a series that asks for a mark draws NOTHING of it —
// never a different shape — and its arrival bumps the version the plot rebuilds on.
describe("lazy marks: before the module arrives", () => {
  it("a spline / size-by / drop-line series is HIDDEN (no straight stand-in, no default-size dots) and there is no drop-line plugin; its arrival bumps the rebuild version", async () => {
    const { result } = renderHook(() => useMarksVersion());
    const v0 = result.current;
    expect(marks()).toBeNull();
    const calls: string[] = [];
    class P { moveTo() { calls.push("m"); } lineTo() { calls.push("l"); } }
    vi.stubGlobal("Path2D", P);
    const o = opts({ connect: "spline", dropLines: "both" });
    const sp = o.series![1] as { width: number; paths?: unknown; points: { show: boolean } };
    expect(sp.width).toBe(0); // hidden: a straight polyline here would later jump to a spline
    expect(sp.points.show).toBe(false);
    expect(sp.paths).toBeUndefined();
    expect(calls).toEqual([]);
    expect(o.plugins?.length ?? 0).toBe(opts(undefined).plugins?.length ?? 0); // no drop-line plugin yet
    vi.unstubAllGlobals();
    const sized = opts({ sizeBy: 1, width: 2 }).series![1] as { width: number; points: { show: boolean } };
    expect(sized.width).toBe(0);
    expect(sized.points.show).toBe(false);
    expect(marks()).toBeNull(); // still pending: all of the above was synchronous
    await waitFor(() => expect(marks()).not.toBeNull());
    await waitFor(() => expect(result.current).toBeGreaterThan(v0)); // the plot's rebuild trigger
  });
});

describe("N5 size by column: the canvas spec", () => {
  it("a sizeBy series gets a flat spec carrying per-row diameters and the size key", () => {
    const m = withSizes(new Map(), ds, [0], { 0: { sizeBy: 1, sizeRange: [4, 12] } });
    const spec = m.get(1)!;
    expect(spec.flat).toBe(true);
    expect(spec.size).toMatchObject({ channel: 1, lo: 0, hi: 4, minPx: 4, maxPx: 12 });
    expect(spec.diam).toEqual([4, 6, 8, 12]);
  });

  it("colorBy + sizeBy keeps the colour scale AND sizes the points", () => {
    const styles = { 0: { colorBy: 1, sizeBy: 0 } };
    const spec = withSizes(buildColorByColumns(ds, [0], styles), ds, [0], styles).get(1)!;
    expect(spec.flat).toBeUndefined();
    expect(spec.diam).toHaveLength(4);
  });

  it("a flat size spec adds no colour-scale chip", () => {
    const m = withSizes(new Map(), ds, [0], { 0: { sizeBy: 1 } });
    expect(colorScaleLegendEntries(ds, m)).toEqual([]);
  });

  it("a size-only series keeps its LINE but hides the native points", () => {
    const m = withSizes(new Map(), ds, [0], { 0: { sizeBy: 1, width: 2 } });
    const o = opts({ sizeBy: 1, width: 2 }, payload, { colorByColumns: m });
    const s = o.series![1] as { width: number; points: { show: boolean } };
    expect(s.width).toBe(2);
    expect(s.points.show).toBe(false);
  });

  function drawPlugin(spec: ColorScatterSpec, stroke: unknown = "#ff0000") {
    const dots: { r: number; fillStyle: string }[] = [];
    let fillStyle = "";
    let r = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      arc(_x: number, _y: number, rad: number) { r = rad; },
      fill() { dots.push({ r, fillStyle }); },
      fillText() {}, measureText: () => ({ width: 0 }),
      set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
      set fillStyle(v: string) { fillStyle = v; },
    };
    const u = {
      ctx, bbox: { left: 0, top: 0, width: 200, height: 100 },
      valToPos: (v: number, s: string) => (s === "x" ? v : 100 - v),
      data: [[0, 1, 2], [10, 20, 30]],
      series: [{}, { stroke }],
    };
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    sizeScatterPlugin(new Map([[1, spec]])).hooks.draw?.(u);
    const before = dots.length;
    // The eager colour plugin leaves a size-by series to the lazy one (no double draw).
    // @ts-expect-error — same stub
    colorScatterPlugin(new Map([[1, spec]])).hooks.draw?.(u);
    expect(dots.length).toBe(before);
    return dots;
  }

  it("reads the stroke of an INITIALISED uPlot, where it is a function (live-check regression)", () => {
    const fn = () => "#00ff00";
    const dots = drawPlugin(
      { channel: 1, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, diam: [4, 4, 4] },
      fn,
    );
    expect(dots.map((d) => d.fillStyle)).toEqual(["#00ff00", "#00ff00", "#00ff00"]);
  });

  it("the plugin draws each point at its own radius in the series stroke", () => {
    const dots = drawPlugin({
      channel: 1, z: [], colormap: "viridis", lo: 0, hi: 1, flat: true, diam: [4, 8, null],
      size: { channel: 1, label: "mass (g)", lo: 0, hi: 2, minPx: 4, maxPx: 12 },
    });
    expect(dots.slice(0, 2)).toEqual([{ r: 2, fillStyle: "#ff0000" }, { r: 4, fillStyle: "#ff0000" }]); // null = no point; the key follows
  });
});

describe("N5 size key on the canvas", () => {
  it("the lazy plugin draws the key: the channel's label and discs at min / mid / max", () => {
    const texts: string[] = [];
    const radii: number[] = [];
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {},
      arc(_x: number, _y: number, r: number) { radii.push(r); },
      fillText(t: string) { texts.push(t); },
      measureText: () => ({ width: 40 }),
      set fillStyle(_v: string) {}, set font(_v: string) {}, set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    };
    const u = {
      ctx, bbox: { left: 0, top: 0, width: 300, height: 200 },
      valToPos: (v: number, s: string) => (s === "x" ? v : 100 - v),
      data: [[0], [10]], series: [{}, { stroke: "#f00" }],
    };
    const spec = withSizes(new Map(), ds, [0], { 0: { sizeBy: 1, sizeRange: [4, 12] } }).get(1)!;
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    sizeScatterPlugin(new Map([[1, spec]])).hooks.draw?.(u);
    expect(texts).toContain("mass (g)");
    expect(texts).toEqual(expect.arrayContaining(["0", "2", "4"]));
    // 1 data disc + 3 key discs, at radii px/2: 2, 4, 6 for the key (devicePixelRatio is 1 here).
    expect(radii.slice(-3).sort((a, b) => a - b)).toEqual([2, 4, 6]);
  });
});

describe("N6 spline connect + drop lines on the canvas", () => {
  it("connect: spline installs the spline path builder on that series only", () => {
    const o = opts({ connect: "spline" });
    expect((o.series![1] as { paths?: unknown }).paths).toBeTypeOf("function");
    const plain = opts(undefined);
    expect((plain.series![1] as { paths?: unknown }).paths).toBeUndefined();
  });

  it("the spline builder strokes the dense curve; a loop falls back to straight row order", () => {
    const calls: [string, number, number][] = [];
    class P {
      moveTo(x: number, y: number) { calls.push(["m", x, y]); }
      lineTo(x: number, y: number) { calls.push(["l", x, y]); }
    }
    vi.stubGlobal("Path2D", P);
    const build = (p: PlotPayload) => {
      calls.length = 0;
      const o = opts({ connect: "spline" }, p);
      const paths = (o.series![1] as { paths: (u: unknown, s: number, a: number, b: number) => unknown }).paths;
      const u = { data: p.data, series: [{}, { scale: "y" }], scales: { y: {} }, valToPos: (v: number) => v };
      paths(u, 1, 0, p.data[0].length - 1);
      return calls.slice();
    };
    expect(build(payload)).toHaveLength(3 * 16 + 1); // dense: 49 vertices
    const loop: PlotPayload = { ...payload, data: [[0, 1, 2, 1, 0], [0, 1, 0, -1, 0]] };
    expect(build(loop).map((c) => [c[1], c[2]])).toEqual([[0, 0], [1, 1], [2, 0], [1, -1], [0, 0]]);
    vi.unstubAllGlobals();
  });

  it("dropLinesPlugin runs each point to the plot edge (bottom for x, left for y)", () => {
    const segs: [number, number, number, number][] = [];
    let mx = 0;
    let my = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, setLineDash() {}, stroke() {},
      moveTo(x: number, y: number) { mx = x; my = y; },
      lineTo(x: number, y: number) { segs.push([mx, my, x, y]); },
    };
    const u = {
      ctx, bbox: { left: 10, top: 5, width: 200, height: 100 },
      valToPos: (v: number, s: string) => (s === "x" ? 10 + v : 105 - v),
      data: [[0, 1], [10, 20]], series: [{}, { stroke: "#f00", scale: "y" }],
    };
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    dropLinesPlugin(new Map([[1, "both"]])).hooks.draw?.(u);
    expect(segs).toContainEqual([10, 95, 10, 105]); // x=0,y=10 down to the bottom edge (105)
    expect(segs).toContainEqual([11, 85, 11, 105]);
    expect(segs).toContainEqual([10, 95, 10, 95]); // y-drop reaches the left edge (x=10)
    expect(segs).toContainEqual([11, 85, 10, 85]);
  });
});

describe("the wire keys and their round trips", () => {
  it("buildExportStyles emits size_by / size_range / drop_lines / connect (and the shape)", () => {
    const [s] = buildExportStyles([0], {
      0: { sizeBy: 1, sizeRange: [4, 12], dropLines: "both", connect: "spline", markerShape: "square" },
    });
    expect(s).toMatchObject({
      size_by: 1, size_range: [4, 12], drop_lines: "both", connect: "spline", marker_shape: "square",
    });
    const plain = buildExportStyles([0], {})[0] ?? {};
    for (const k of ["size_by", "size_range", "drop_lines", "connect"]) expect(plain).not.toHaveProperty(k);
  });

  it("survives the wire boundary and the persistence sanitizer, and drops junk", () => {
    const styles = buildExportStyles([0], { 0: { sizeBy: 1, dropLines: "x", connect: "spline" } });
    const [wire] = toWireSeriesStyles(styles, false) as [Record<string, unknown>];
    expect(wire).toMatchObject({ size_by: 1, drop_lines: "x", connect: "spline" });
    const [back] = sanitizeExportSeriesStyles([wire])!;
    expect(back).toMatchObject({ size_by: 1, drop_lines: "x", connect: "spline" });
    // Junk is left for the backend to reject (tests/test_calc_figure_marks.py); other keys still drop.
    const [junk] = sanitizeExportSeriesStyles([{ bogus: 1 }])!;
    expect(junk).toBeNull();
  });

  it("a saved publication style restores dropLines/connect (not the channel-bound size-by)", () => {
    const st = seriesStyleFromExport({ drop_lines: "y", connect: "spline", size_range: [4, 9], size_by: 1 });
    expect(st).toMatchObject({ dropLines: "y", connect: "spline" });
    expect(st).not.toHaveProperty("sizeBy");
  });

  it("a graph format is data-free: sizeBy is stripped, drop lines / spline travel", () => {
    const out = portableStyle({ sizeBy: 1, sizeRange: [4, 9], dropLines: "x", connect: "spline" });
    expect(out).toEqual({ dropLines: "x", connect: "spline", sizeRange: [4, 9] }); // the range rides along; harmless without sizeBy
  });
});
