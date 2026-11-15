// Review fixes for the data-driven marks (canvas side): the spline on a long series (no spread
// overflow, cached, capped), its rule against step / fill, decimation, hidden series and HiDPI
// scale in the lazy plugins, and drop lines on a turned plot. The Python half is
// tests/test_calc_figure_marks_review.py.
import { beforeAll, describe, expect, it, vi } from "vitest";

import { SUBSTEPS, splineDense, splineDenseCached, splineRefusal } from "./cubicSpline";
import { blocksDecimation, ensureMarks, marks, SPLINE_MAX_ROWS } from "./marksLoader";
import { sizeScatterPlugin } from "./marksImpl";
import type { ColorScatterSpec } from "./colorscatter";
import type { PlotPayload } from "./plotdata";
import { buildOpts } from "./uplotOpts";
import { colorScatterPlugin } from "./uplotOverlays";
import { dropLinePlugins } from "./uplotDropLines";
import { SPLINE_PATHS } from "./uplotSpline";

const ramp = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("spline on a long series", () => {
  it("a 20,000-row series builds (no call-stack overflow from spread pushes) and is dense", () => {
    const x = ramp(SPLINE_MAX_ROWS);
    const d = splineDense(x, x.map((v) => Math.sin(v / 50)))!;
    expect(d.x).toHaveLength((SPLINE_MAX_ROWS - 1) * SUBSTEPS + 1);
    expect(d.knots).toHaveLength(SPLINE_MAX_ROWS);
  });

  it("past the cap it is refused ('long'): the series draws straight", () => {
    const x = ramp(SPLINE_MAX_ROWS + 1);
    expect(splineRefusal(x, x)).toBe("long");
    expect(splineDense(x, x)).toBeNull();
    expect(splineRefusal([0, 1, 0, 1], [0, 1, 0, 1])).toBe("loop");
    expect(splineRefusal([0, 1], [0, 1])).toBe("short");
  });

  it("the dense curve is cached per data identity (a zoom / pan does not refit it)", () => {
    const x = ramp(2000);
    const y = x.map((v) => v % 7);
    const a = splineDenseCached(x, y);
    expect(splineDenseCached(x, y)).toBe(a);
    expect(splineDenseCached(x, y.slice())).not.toBe(a); // new data -> refit
  });

  it("a series whose spline was refused is cached too (null stays null)", () => {
    const x = [0, 1, 0];
    const y = [0, 1, 2];
    expect(splineDenseCached(x, y)).toBeNull();
    expect(splineDenseCached(x, y)).toBeNull();
  });
});

describe("decimation is blocked where it would change the drawn curve", () => {
  it("size-by always (row-indexed); a spline up to the cap; nothing for a plain or over-cap series", () => {
    expect(blocksDecimation([{ sizeBy: 1 }], 1_000_000)).toBe(true);
    expect(blocksDecimation([{ connect: "spline" }], SPLINE_MAX_ROWS)).toBe(true);
    expect(blocksDecimation([{ connect: "spline" }], SPLINE_MAX_ROWS + 1)).toBe(false); // straight: decimates like any line
    expect(blocksDecimation([undefined, { color: "#f00" }, { dropLines: "x" }], 50_000)).toBe(false);
  });
});

describe("with the module loaded", () => {
  const payload: PlotPayload = {
    data: [[1, 2, 3, 4], [10, 20, 15, 30]],
    series: [{ label: "M", unit: "" }],
    xLabel: "H",
    xUnit: "",
  };
  const opts = (style: unknown, extra: object = {}) =>
    buildOpts(payload, {
      width: 600, height: 400, xScale: "linear", yScale: "linear", tool: "zoom", onReadout: vi.fn(),
      plotted: [0], seriesStyles: [style] as never, ...extra,
    });
  const stepped = vi.fn();

  beforeAll(async () => {
    ensureMarks([{ connect: "spline" }]);
    await vi.waitFor(() => expect(marks()).not.toBeNull());
  });

  it("spline wins over a step shape (the export drops the step too)", () => {
    const o = opts({ connect: "spline", step: "post" }, { steppedPaths: stepped });
    expect((o.series![1] as { paths?: unknown }).paths).toBe(SPLINE_PATHS);
    expect((opts({ step: "post" }, { steppedPaths: stepped }).series![1] as { paths?: unknown }).paths).toBe(stepped);
  });

  it("a fill BETWEEN keeps the straight line; a fill under rides the spline", () => {
    expect((opts({ connect: "spline", fill: { vs: 3 } }).series![1] as { paths?: unknown }).paths).toBeUndefined();
    expect((opts({ connect: "spline", fill: "under" }).series![1] as { paths?: unknown }).paths).toBe(SPLINE_PATHS);
  });

  it("the spline builder closes a fill path down to the zero line along the same curve", () => {
    const calls: string[] = [];
    class P {
      moveTo(_x: number, y: number) { calls.push(`m${y}`); }
      lineTo(_x: number, y: number) { calls.push(`l${y}`); }
      closePath() { calls.push("z"); }
    }
    vi.stubGlobal("Path2D", P);
    const u = {
      data: [[1, 2, 3, 4], [10, 20, 15, 30]], series: [{}, { scale: "y", fill: "red" }], scales: { y: {} },
      valToPos: (v: number, s: string) => (s === "y" ? 100 - v : v),
    };
    const out = SPLINE_PATHS(u as never, 1, 0, 3) as { fill: unknown };
    vi.unstubAllGlobals();
    expect(out.fill).not.toBeNull();
    expect(calls).toContain("z");
    expect(calls.filter((c) => c === "m100")).toHaveLength(1); // the baseline (value 0 -> pos 100) start
  });

  it("drop lines are not drawn on a turned (horizontal-bar) plot", () => {
    expect(dropLinePlugins([{ dropLines: "x", bars: "horizontal" }])).toHaveLength(0);
    expect(dropLinePlugins([{ dropLines: "x", bars: true }])).toHaveLength(1);
  });

  function stubU(show: boolean, dpr = 1) {
    const arcs: number[] = [];
    vi.stubGlobal("devicePixelRatio", dpr);
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fill() {}, fillText() {},
      arc(_x: number, _y: number, r: number) { arcs.push(r); }, measureText: () => ({ width: 0 }),
      set fillStyle(_v: string) {}, set strokeStyle(_v: string) {}, set font(_v: string) {},
      set textAlign(_v: string) {}, set textBaseline(_v: string) {},
    };
    const u = {
      ctx, bbox: { left: 0, top: 0, width: 300, height: 200 }, valToPos: (v: number) => v,
      data: [[0], [10]], series: [{}, { stroke: "#f00", show }],
    };
    return { u, arcs };
  }
  const spec = (): ColorScatterSpec => ({
    channel: 1, z: [0], colormap: "viridis", lo: 0, hi: 1, flat: true, diam: [8],
    size: { channel: 1, label: "m", lo: 0, hi: 1, minPx: 8, maxPx: 8 },
  });

  it("a legend-hidden size-by series draws no points (and no key points either)", () => {
    const { u, arcs } = stubU(false);
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    sizeScatterPlugin(new Map([[1, spec()]])).hooks.draw?.(u);
    expect(arcs).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("a legend-hidden colour-by series draws no points", () => {
    const { u, arcs } = stubU(false);
    const colour: ColorScatterSpec = { channel: 2, z: [1], colormap: "gray", lo: 0, hi: 2 };
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    colorScatterPlugin(new Map([[1, colour]])).hooks.draw?.(u);
    expect(arcs).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("on a 2x display the plotted disc and its key disc agree (both in device px)", () => {
    const { u, arcs } = stubU(true, 2);
    // @ts-expect-error — minimal stub stands in for a uPlot instance
    sizeScatterPlugin(new Map([[1, spec()]])).hooks.draw?.(u);
    vi.unstubAllGlobals();
    // 8 px diameter -> radius 4 css px -> 8 device px at 2x; the key's (single-value) disc is the same size.
    expect(arcs[0]).toBe(8);
    expect(arcs[1]).toBe(8);
  });
});
