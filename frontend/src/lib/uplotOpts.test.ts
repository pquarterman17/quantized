import { describe, expect, it, vi } from "vitest";

import {
  buildOpts,
  categoricalTickFormatter,
  fixedLogAxisSplits,
  niceLinearStep,
  reciprocalAxisSplits,
  reciprocalTransform,
  resolvePlotBg,
  tickFormatter,
  xIsAscending,
} from "./uplotOpts";
import type { PlotPayload } from "./plotdata";
import type { SeriesStyle } from "./types";

const payload: PlotPayload = {
  data: [
    [0, 1, 2],
    [10, 20, 30],
  ],
  series: [{ label: "M", unit: "emu" }],
  xLabel: "Field",
  xUnit: "Oe",
};

const base = { width: 600, height: 400, xScale: "linear" as const, onReadout: vi.fn() };

describe("buildOpts non-monotonic x (hysteresis loop) x-range", () => {
  // Field sweeps up then back down, starting and ending near the SAME value —
  // uPlot's binary-search autorange would collapse the x-axis to a sliver.
  const loop: PlotPayload = {
    data: [
      [-100, 0, 100, 0, -90],
      [-1, -0.5, 1, 0.5, -0.9],
    ],
    series: [{ label: "M", unit: "emu" }],
    xLabel: "Field",
    xUnit: "Oe",
  };

  it("supplies a full-scan x range covering the whole sweep, not the collapsed endpoints", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom" });
    const xr = (opts.scales?.x as { range?: unknown }).range;
    expect(typeof xr).toBe("function");
    const [lo, hi] = (xr as () => [number, number])();
    expect(lo).toBeLessThanOrEqual(-100);
    expect(hi).toBeGreaterThanOrEqual(100);
    expect(hi - lo).toBeGreaterThan(150); // the true sweep, not a [first,last] sliver
  });

  it("leaves the x range to uPlot (no function) when x is monotonic", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect((opts.scales?.x as { range?: unknown }).range).toBeUndefined();
  });

  it("an explicit xLim still wins over the loop x-range", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom", xLim: [-50, 50] });
    expect((opts.scales?.x as { range?: unknown }).range).toEqual([-50, 50]);
  });
});

describe("buildOpts publication template (fontSize + baseLineWidth)", () => {
  it("applies the template font size to the axes and base width to series", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", fontSize: 18, baseLineWidth: 3 });
    expect(opts.axes?.[0].font).toContain("18px");
    // series[0] is the x series; the first data series is index 1.
    expect((opts.series?.[1] as { width?: number }).width).toBe(3);
  });

  it("defaults to 12px / 1.5 when no template args are given (item 2, was 11px)", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.axes?.[0].font).toContain("12px");
    expect((opts.series?.[1] as { width?: number }).width).toBe(1.5);
  });

  it("sizes the axis title 2px over the tick font and grows label/tick room to match", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", fontSize: 18 });
    expect(opts.axes?.[0].labelFont).toContain("20px");
    expect(opts.axes?.[0].labelSize).toBeGreaterThan(30);
    // The y tick-band size is now a measuring FUNCTION (grows with the widest
    // label); its floor still grows past the prior flat 60 with a bigger font.
    const ySize = opts.axes?.[1].size;
    expect(typeof ySize).toBe("function");
    const floor = (ySize as (s: never, v: string[] | null, i: number, c: number) => number)(
      {} as never,
      null,
      1,
      0,
    );
    expect(floor).toBeGreaterThan(60);
  });

  it("y tick-band grows to fit wide (many-digit) labels so they don't overlap the title", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    const ySize = opts.axes?.[1].size as (
      s: { ctx: CanvasRenderingContext2D },
      v: string[] | null,
      i: number,
      c: number,
    ) => number;
    // A mock ctx whose text width scales with string length (jsdom has no real
    // metrics) — a wide label must yield a bigger band than a narrow one.
    const ctx = {
      font: "",
      measureText: (t: string) => ({ width: t.length * 8 }) as TextMetrics,
    } as CanvasRenderingContext2D;
    const narrow = ySize({ ctx }, ["0", "1", "2"], 1, 0);
    const wide = ySize({ ctx }, ["-0.000012", "0.000034", "0.000056"], 1, 0);
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe("buildOpts", () => {
  it("enables box-zoom drag in zoom AND pointer mode (MAIN #18 — muscle-memory box zoom)", () => {
    const zoom = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(zoom.cursor?.drag).toMatchObject({ x: true, y: true });
    const pointer = buildOpts(payload, { ...base, yScale: "linear", tool: "pointer" });
    expect(pointer.cursor?.drag).toMatchObject({ x: true, y: true });
    const pan = buildOpts(payload, { ...base, yScale: "linear", tool: "pan" });
    expect(pan.cursor?.drag).toMatchObject({ x: false, y: false });
  });

  it("suppresses the dashed crosshair ONLY in pointer mode (MAIN #18)", () => {
    const pointer = buildOpts(payload, { ...base, yScale: "linear", tool: "pointer" });
    expect(pointer.cursor).toMatchObject({ x: false, y: false });
    const zoom = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect((zoom.cursor as { x?: unknown }).x).toBeUndefined();
    expect((zoom.cursor as { y?: unknown }).y).toBeUndefined();
  });

  it("adds one plugin for pan and cursor, none for zoom or pointer (no annotations/refLines)", () => {
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).plugins).toHaveLength(0);
    // Pointer without an axisLabelEdit bridge stays plugin-free (the axis-title
    // drag plugin is only pushed when that bridge is wired — see PlotStage).
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "pointer" }).plugins).toHaveLength(0);
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "pan" }).plugins).toHaveLength(1);
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "cursor" }).plugins).toHaveLength(1);
  });

  it("adds the axis-title drag plugin in pointer mode once the edit bridge is wired", () => {
    const edit = { offsets: {}, styles: {}, interactive: true, onMove: () => {}, onReset: () => {}, onContextMenu: () => {} };
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "pointer", axisLabelEdit: edit });
    expect(opts.plugins).toHaveLength(1);
  });

  it("blanks uPlot's own y title once it has a drag offset — even in a non-pointer tool", () => {
    const edit = {
      offsets: { y: [-10, 4] as [number, number] },
      styles: {},
      interactive: false,
      onMove: () => {},
      onReset: () => {},
      onContextMenu: () => {},
    };
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", axisLabelEdit: edit });
    expect(opts.axes?.[1]?.label).toBe(""); // moved -> plugin draws it (offset renders)
    expect(opts.plugins).toHaveLength(1);
  });

  it("refLine dragging is interactive in pointer mode too (MAIN #18)", () => {
    const onRefLineMove = vi.fn();
    // refLinePlugin's own `interactive` flag isn't directly readable off the
    // built Options — assert indirectly via the ready hook's presence, which
    // refLinePlugin only sets when interactive+onMove are both supplied.
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "pointer",
      refLines: [{ id: "r1", axis: "x", value: 1 }],
      onRefLineMove,
    });
    const plugin = opts.plugins?.[0] as { hooks: { ready?: unknown } };
    expect(plugin.hooks.ready).toBeDefined();
  });

  it("annotationPlugin is interactive ONLY when both tool='pointer' AND annotationEdit is supplied", () => {
    const annotations = [{ id: "a1", x: 1, y: 2, text: "Tc" }];
    const bridge = { selectedId: null, onSelect: vi.fn(), onMove: vi.fn(), onResize: vi.fn(), onEditText: vi.fn(), onContextMenu: vi.fn() };
    const withBridge = buildOpts(payload, { ...base, yScale: "linear", tool: "pointer", annotations, annotationEdit: bridge });
    const passive = buildOpts(payload, { ...base, yScale: "linear", tool: "pointer", annotations });
    const wrongTool = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", annotations, annotationEdit: bridge });
    const p1 = withBridge.plugins?.[0] as { hooks: { ready?: unknown } };
    const p2 = passive.plugins?.[0] as { hooks: { ready?: unknown } };
    const p3 = wrongTool.plugins?.[0] as { hooks: { ready?: unknown } };
    expect(p1.hooks.ready).toBeDefined();
    expect(p2.hooks.ready).toBeUndefined();
    expect(p3.hooks.ready).toBeUndefined();
  });

  it("never passes undefined plugin hook callbacks into uPlot", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      annotations: [{ id: "a1", x: 1, y: 2, text: "passive" }],
      refLines: [{ id: "r1", axis: "x", value: 1 }],
    });
    expect(opts.plugins).toHaveLength(2);
    for (const plugin of opts.plugins ?? []) {
      expect(Object.values(plugin.hooks).every((callback) => callback !== undefined)).toBe(true);
    }
  });

  it("adds the stats plugin only in the stats tool", () => {
    expect(
      buildOpts(payload, { ...base, yScale: "linear", tool: "stats", onStats: vi.fn() }).plugins,
    ).toHaveLength(1);
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).plugins).toHaveLength(0);
  });

  it("adds the reference-line plugin only when ref lines exist", () => {
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", refLines: [] }).plugins).toHaveLength(0);
    const withRefs = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      refLines: [{ id: "r1", axis: "x", value: 1 }],
    });
    expect(withRefs.plugins).toHaveLength(1);
  });

  it("adds the wheel-zoom plugin only when the pref is on", () => {
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).plugins).toHaveLength(0);
    expect(
      buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", wheelZoom: true }).plugins,
    ).toHaveLength(1);
  });

  it("the qfit tool adds the ROI-band gadget plugin by default (fit/integrate/stats/differentiate/fft)", () => {
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "qfit" }).plugins).toHaveLength(1);
    expect(
      buildOpts(payload, { ...base, yScale: "linear", tool: "qfit", gadgetMode: "integrate" }).plugins,
    ).toHaveLength(1);
  });

  it("the qfit tool swaps to the paired-cursors plugin in cursors mode (gap #34)", () => {
    expect(
      buildOpts(payload, { ...base, yScale: "linear", tool: "qfit", gadgetMode: "cursors" }).plugins,
    ).toHaveLength(1);
  });

  it("adds the anchor-edit plugin only while the baseline anchor bridge is live (GOTO #2)", () => {
    expect(
      buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", anchorEdit: null }).plugins,
    ).toHaveLength(0);
    const withAnchors = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom", // composes with any tool — workshop-scoped, not tool-scoped
      anchorEdit: {
        getAnchors: () => [{ index: 0, x: 1, y: 2 }],
        onAdd: vi.fn(),
        onMove: vi.fn(),
        onRemove: vi.fn(),
      },
    });
    expect(withAnchors.plugins).toHaveLength(1);
  });
});

describe("buildOpts defaultTrace", () => {
  type S = { width?: number; points?: { show?: boolean }; paths?: unknown };
  const series = (trace: string): S =>
    buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", defaultTrace: trace }).series?.[1] as S;

  it("Line: line only, no markers, no custom paths (default)", () => {
    const s = series("Line");
    expect(s.width).toBe(1.5);
    expect(s.points?.show).toBe(false);
    expect(s.paths).toBeUndefined();
  });

  it("Scatter: markers, zero line width", () => {
    const s = series("Scatter");
    expect(s.width).toBe(0);
    expect(s.points?.show).toBe(true);
  });

  it("Line + markers: line width kept, markers shown", () => {
    const s = series("Line + markers");
    expect(s.width).toBe(1.5);
    expect(s.points?.show).toBe(true);
  });

  it("Step: applies the caller-supplied stepped paths builder", () => {
    const fn = vi.fn();
    const s = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      defaultTrace: "Step",
      steppedPaths: fn as unknown as Parameters<typeof buildOpts>[1]["steppedPaths"],
    }).series?.[1] as S;
    expect(s.paths).toBe(fn);
  });

  it("disables time mode on the x scale (physics axes are never timestamps)", () => {
    // uPlot defaults scales.x.time = true, which formats Qz/2θ/field as dates
    // ("12/31/69", ":00.040") and blanks negative x. Must be explicitly false.
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.scales?.x?.time).toBe(false);
  });

  it("sets the log distribution on the y scale when yScale is log", () => {
    expect(buildOpts(payload, { ...base, yScale: "log", tool: "zoom" }).scales?.y?.distr).toBe(3);
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).scales?.y?.distr).toBe(1);
  });

  it("sets the log distribution on the x scale when xScale is log", () => {
    expect(buildOpts(payload, { ...base, xScale: "log", yScale: "linear", tool: "zoom" }).scales?.x?.distr).toBe(3);
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).scales?.x?.distr).toBe(1);
  });

  it("sets the custom (100) distribution + fwd/bwd transform on a reciprocal scale", () => {
    const xOpts = buildOpts(payload, { ...base, xScale: "reciprocal", yScale: "linear", tool: "zoom" });
    expect(xOpts.scales?.x?.distr).toBe(100);
    expect(xOpts.scales?.x?.fwd).toBeTypeOf("function");
    expect(xOpts.scales?.x?.bwd).toBeTypeOf("function");
    expect(xOpts.scales?.x?.fwd?.(2)).toBeCloseTo(0.5, 12);
    const yOpts = buildOpts(payload, { ...base, yScale: "reciprocal", tool: "zoom" });
    expect(yOpts.scales?.y?.distr).toBe(100);
  });

  it("labels the y series with its unit", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.series[1].label).toBe("M (emu)");
  });

  it("applies a legend-rename override to the series label and solo-axis label", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesLabels: ["Moment"],
    });
    expect(opts.series[1].label).toBe("Moment"); // override wins, no unit appended
    expect(opts.axes?.[1]?.label).toBe("Moment"); // solo-axis label follows the rename
  });

  it("keeps the default label where the rename entry is undefined", () => {
    const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "T" }] };
    const opts = buildOpts(two, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesLabels: [undefined, "renamed"],
    });
    expect(opts.series[1].label).toBe("M (emu)"); // untouched
    expect(opts.series[2].label).toBe("renamed");
  });

  it("labels the y axis when a single series is shown", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.axes?.[1]?.label).toBe("M (emu)");
    const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "" }] };
    // With >1 series the legend names them, so the axis label is omitted.
    expect(buildOpts(two, { ...base, yScale: "linear", tool: "zoom" }).axes?.[1]?.label).toBeUndefined();
  });

  it("applies explicit axis limits as static scale ranges", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      xLim: [0, 5],
      yLim: [-1, 10],
    });
    expect(opts.scales?.x?.range).toEqual([0, 5]);
    expect(opts.scales?.y?.range).toEqual([-1, 10]);
  });

  it("omits the range (autoscale) when no limits are given", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.scales?.x?.range).toBeUndefined();
    expect(opts.scales?.y?.range).toBeUndefined();
  });

  it("has no secondary axis when all series are on the primary", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.scales?.y2).toBeUndefined();
    expect(opts.axes).toHaveLength(2); // x + primary y only
  });

  it("applies a per-series color / width / line-style override", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [{ color: "#ff0000", width: 3, line: "dashed" }],
    });
    expect(opts.series[1].stroke).toBe("#ff0000");
    expect(opts.series[1].width).toBe(3);
    expect(opts.series[1].dash).toEqual([8, 4]); // dashed
  });

  it("shows circular markers (with size) when the style enables them", () => {
    const withMarkers = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [{ marker: true, markerSize: 7 }],
    });
    expect(withMarkers.series[1].points).toMatchObject({ show: true, size: 7 });
    const noMarkers = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [{ width: 2 }],
    });
    expect(noMarkers.series[1].points).toMatchObject({ show: false });
  });

  it("maps the dotted line style and leaves solid/unset dash-free", () => {
    const dotted = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [{ line: "dotted" }],
    });
    expect(dotted.series[1].dash).toEqual([2, 4]);
    const solid = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [{ line: "solid" }],
    });
    expect(solid.series[1].dash).toBeUndefined();
  });

  it("falls back to default width when the style entry is undefined", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: [undefined],
    });
    expect(opts.series[1].width).toBe(1.5);
    expect(opts.series[1].dash).toBeUndefined();
  });

  it("hides grid lines when showGrid is false, draws them otherwise", () => {
    const off = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", showGrid: false });
    expect((off.axes?.[0]?.grid as { show?: boolean }).show).toBe(false);
    expect((off.axes?.[1]?.grid as { show?: boolean }).show).toBe(false);
    const on = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", showGrid: true });
    expect((on.axes?.[1]?.grid as { stroke?: string }).stroke).toBeDefined();
    // default (undefined) keeps the grid
    const dflt = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect((dflt.axes?.[1]?.grid as { show?: boolean }).show).not.toBe(false);
  });

  it("formats ticks fixed/sci at the configured digits when the increment needs no more", () => {
    const fixed = tickFormatter({ mode: "fixed", digits: 2 });
    expect(fixed(null as never, [1.5, 2], 0, 0, 0)).toEqual(["1.50", "2.00"]);
    const sci = tickFormatter({ mode: "sci", digits: 1 });
    expect(sci(null as never, [1500], 0, 0, 0)).toEqual(["1.5e+3"]);
  });

  // MAIN #20 (owner bug report): a dense M-H moment axis (+-0.002, ticks
  // ~0.0001 apart) rendered 3-decimal labels -> duplicate "0.001"/"0"/
  // "-0.001" runs and a bare "-0". Reproduced via tools/visual with `yFmt`
  // untouched at {mode:"auto"} (see uplotOpts.ts's autoTickValues doc) —
  // uPlot's OWN default formatter (Intl.NumberFormat with no options, capped
  // at 3 fraction digits) is the confirmed mechanism, independent of the
  // `fixed`-mode path. Both are covered below: `fixed` PROVABLY duplicates
  // via bare toFixed(2) at this spacing (regression for the class, whether
  // or not the owner's plot ever used fixed mode); `auto` is the actual
  // repro mechanism, fixed by tickFormatter no longer deferring to uPlot.
  describe("increment-aware precision floor (MAIN #20)", () => {
    const denseSplits = [-0.0002, -0.0001, 0, 0.0001, 0.0002]; // 0.0001 apart

    it("bare toFixed(2)/(3) at this spacing PROVABLY duplicates — the mechanism class, independent of the fix", () => {
      // Documents why an increment floor is needed at all: plain toFixed at
      // a digit count below what 0.0001-apart splits need collapses every
      // value in the run to the same string, REGARDLESS of whether this
      // exact code path is what produced the owner's screenshot (that's a
      // separate question — see the "auto mode reproduces" case below,
      // which is the confirmed mechanism via tools/visual).
      const raw2 = denseSplits.map((v) => v.toFixed(2));
      expect(new Set(raw2).size).toBeLessThan(denseSplits.length);
      const raw3 = denseSplits.map((v) => v.toFixed(3));
      expect(new Set(raw3).size).toBeLessThan(denseSplits.length);
    });

    it("fixed mode: the increment floor keeps every dense-tick label distinct", () => {
      const fmt = tickFormatter({ mode: "fixed", digits: 2 });
      const labels = fmt(null as never, denseSplits, 0, 0, 0.0001);
      expect(labels).toEqual(["-0.0002", "-0.0001", "0.0000", "0.0001", "0.0002"]);
      expect(new Set(labels).size).toBe(denseSplits.length);
    });

    it("auto mode: the override formats the SAME dense splits without duplicates or a bare digit collapse", () => {
      const fmt = tickFormatter({ mode: "auto", digits: 2 });
      const labels = fmt(null as never, denseSplits, 0, 0, 0.0001);
      expect(new Set(labels).size).toBe(denseSplits.length);
      expect(labels).toContain("0"); // exact zero still renders bare, not "0.0000"
    });

    it("auto mode reproduces the SAME duplicate-run shape without a fixed/sci path involved (repro proof)", () => {
      // The owner's exact scenario: default {mode:"auto"} (no fixed/sci ever
      // configured) on a dense axis. This asserts the fix, but the shape of
      // the bug (pre-fix) was independently confirmed via tools/visual.
      const fmt = tickFormatter(undefined);
      const labels = fmt(null as never, denseSplits, 0, 0, 0.0001);
      expect(new Set(labels).size).toBe(denseSplits.length);
    });

    it("never renders a bare negative zero after rounding (fixed mode)", () => {
      const fmt = tickFormatter({ mode: "fixed", digits: 2 });
      // A split just below zero that ROUNDS to zero at 2 decimals must not
      // print "-0.00" — it's not meaningful data. foundIncr=0.01 needs
      // exactly 2 decimals, so the floor doesn't shift the digit count.
      expect(fmt(null as never, [-0.0004], 0, 0, 0.01)).toEqual(["0.00"]);
    });

    it("never renders a bare negative zero after rounding (auto mode)", () => {
      const fmt = tickFormatter({ mode: "auto", digits: 2 });
      expect(fmt(null as never, [-0.0000001], 0, 0, 1000)).toEqual(["0"]);
    });

    it("auto mode leaves a healthy large-integer range's labels byte-identical to uPlot's own Intl-grouped output", () => {
      // Field axis from the owner's screenshot: -15,000..15,000, no fraction
      // digits needed. decimalsForIncrement(5000) floors to 0, matching the
      // Intl.NumberFormat default's own effective output at this magnitude
      // (no regression on the healthy axis the owner's report showed).
      const fmt = tickFormatter(undefined);
      const labels = fmt(null as never, [-15000, -10000, -5000, 0, 5000, 10000, 15000], 0, 0, 5000);
      expect(labels).toEqual(["-15,000", "-10,000", "-5,000", "0", "5,000", "10,000", "15,000"]);
    });

    it("sci mode floors mantissa digits so same-decade dense ticks stay distinct", () => {
      const fmt = tickFormatter({ mode: "sci", digits: 1 });
      const labels = fmt(null as never, [1.1e-3, 1.2e-3, 1.3e-3], 0, 0, 0.0001);
      expect(new Set(labels).size).toBe(3);
      expect(labels).toEqual(["1.1e-3", "1.2e-3", "1.3e-3"]);
    });

    it("eng mode: mantissa in [1,1000), exponent a multiple of 3, sci-style suffix", () => {
      const fmt = tickFormatter({ mode: "eng", digits: 1 });
      expect(fmt(null as never, [0.0012], 0, 0, 0)).toEqual(["1.2e-3"]);
      expect(fmt(null as never, [-0.0012], 0, 0, 0)).toEqual(["-1.2e-3"]);
      expect(fmt(null as never, [0], 0, 0, 0)).toEqual(["0"]);
      expect(fmt(null as never, [12345], 0, 0, 0)).toEqual(["12.3e+3"]);
    });

    it("eng mode floors mantissa digits so dense same-exponent ticks stay distinct", () => {
      const fmt = tickFormatter({ mode: "eng", digits: 0 });
      const labels = fmt(null as never, [1.1e-3, 1.2e-3, 1.3e-3], 0, 0, 0.0001);
      expect(new Set(labels).size).toBe(3);
    });

    it("eng mode renormalizes when the mantissa rounds up to 1000", () => {
      const fmt = tickFormatter({ mode: "eng", digits: 0 });
      expect(fmt(null as never, [999.9996], 0, 0, 0)).toEqual(["1e+3"]);
    });
  });

  it("categoricalTickFormatter maps in-range integer splits to labels, blanks the rest", () => {
    const fmt = categoricalTickFormatter(["Low", "Mid", "High"]);
    expect(fmt(null as never, [0, 1, 2], 0, 0, 0)).toEqual(["Low", "Mid", "High"]);
    expect(fmt(null as never, [0.5, -1, 3, null as unknown as number], 0, 0, 0)).toEqual([
      "",
      "",
      "",
      null,
    ]);
  });

  it("a categorical payload (xCategories) attaches the ordinal tick formatter to the x axis, auto-override to y", () => {
    const cat: PlotPayload = { ...payload, xCategories: ["A", "B", "C"] };
    const opts = buildOpts(cat, { ...base, yScale: "linear", tool: "zoom" });
    expect(typeof opts.axes?.[0]?.values).toBe("function");
    const fn = opts.axes?.[0]?.values as unknown as (u: never, splits: number[]) => unknown[];
    expect(fn(null as never, [0, 1, 2])).toEqual(["A", "B", "C"]);
    // The y axis gets the increment-aware auto override (MAIN #20) — no
    // xFmt/yFmt was supplied, but "auto" no longer means "uPlot's own".
    expect(typeof opts.axes?.[1]?.values).toBe("function");
  });

  it("xCategories wins over an explicit numeric xFmt on the x axis", () => {
    const cat: PlotPayload = { ...payload, xCategories: ["A", "B", "C"] };
    const opts = buildOpts(cat, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      xFmt: { mode: "fixed", digits: 2 },
    });
    const fn = opts.axes?.[0]?.values as unknown as (u: never, splits: number[]) => unknown[];
    expect(fn(null as never, [0, 1])).toEqual(["A", "B"]); // not "0.00"/"1.00"
  });

  it("a plain numeric payload (no xCategories) still gets the increment-aware auto formatter", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(typeof opts.axes?.[0]?.values).toBe("function");
  });

  it("attaches the tick formatter to the x/y axes for every mode, including auto (MAIN #20)", () => {
    const formatted = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      xFmt: { mode: "fixed", digits: 1 },
      yFmt: { mode: "sci", digits: 2 },
    });
    expect(typeof formatted.axes?.[0]?.values).toBe("function");
    expect(typeof formatted.axes?.[1]?.values).toBe("function");
    // "auto" (no xFmt/yFmt at all) no longer means "defer to uPlot's own
    // formatter" — see uplotOpts.ts's autoTickValues doc for why.
    const auto = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(typeof auto.axes?.[0]?.values).toBe("function");
    expect(typeof auto.axes?.[1]?.values).toBe("function");
  });

  it("marks the x series ascending for sorted x (keeps uPlot's fast path)", () => {
    // base payload x = [0, 1, 2] is sorted ascending.
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.series[0].sorted).toBe(1);
  });

  it("marks the x series unsorted for a non-monotonic x (hysteresis loop)", () => {
    // M-vs-H loop: field sweeps +max -> -max -> +max, so x is not monotonic.
    // Without sorted:0 uPlot reads only the endpoints and collapses the x-range
    // to a sliver -> blank plot (the QD magnetometry bug).
    const loop: PlotPayload = {
      ...payload,
      data: [
        [70000, 0, -70000, 0, 70000],
        [1, 0.5, -1, -0.5, 1],
      ],
      series: [{ label: "M", unit: "emu" }],
    };
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.series[0].sorted).toBe(0);
  });

  it("xIsAscending: true for sorted/with-nulls, false on any decrease", () => {
    expect(xIsAscending([0, 1, 2, 3])).toBe(true);
    expect(xIsAscending([0, 1, 1, 2])).toBe(true); // non-strict (ties) is fine
    expect(xIsAscending([0, null, 2, null, 4])).toBe(true); // nulls skipped
    expect(xIsAscending([0, 1, 0.5, 2])).toBe(false);
    expect(xIsAscending([70000, -70000, 70000])).toBe(false);
  });

  it("sets the chart title only when a non-blank title is given", () => {
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", title: "Run 42" }).title).toBe(
      "Run 42",
    );
    // blank / whitespace / unset -> no title key (uPlot draws no title bar)
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", title: "  " }).title).toBeUndefined();
    expect(buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" }).title).toBeUndefined();
  });

  it("overrides the x-axis label, else derives it from the data", () => {
    const over = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", xAxisLabel: "H (kOe)" });
    expect(over.axes?.[0]?.label).toBe("H (kOe)");
    const auto = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(auto.axes?.[0]?.label).toBe("Field (Oe)"); // payload.xLabel + xUnit
  });

  // Item B (decode-plan #36 residual, PNR.opj Graph11): `null` forces NO x
  // title even though data is present — an Origin layer whose decoded
  // x_title is genuinely blank (the owner hand-deleted a redundant
  // per-panel label) must render nothing, never a synthesized fallback.
  // `""`/undefined keep deriving (the pre-existing, store-wide convention —
  // see `store/useApp.ts`'s `xAxisLabel` doc).
  it("null forces a blank x-axis title instead of deriving one", () => {
    const forced = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", xAxisLabel: null });
    expect(forced.axes?.[0]?.label).toBe("");
    // "" still means "no override" (today's store-wide convention), unaffected.
    const blankString = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", xAxisLabel: "" });
    expect(blankString.axes?.[0]?.label).toBe("Field (Oe)");
  });

  it("overrides the primary y-axis label and forces it to show with >1 series", () => {
    const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "T" }] };
    // Without an override, >1 series leaves the axis label to the legend (undefined).
    expect(buildOpts(two, { ...base, yScale: "linear", tool: "zoom" }).axes?.[1]?.label).toBeUndefined();
    // With an override it shows regardless of series count.
    const over = buildOpts(two, { ...base, yScale: "linear", tool: "zoom", yAxisLabel: "Moment (emu)" });
    expect(over.axes?.[1]?.label).toBe("Moment (emu)");
  });

  it("adds a right-side y2 scale + axis and routes axis-1 series to it", () => {
    const dual: PlotPayload = {
      ...payload,
      data: [
        [0, 1, 2],
        [10, 20, 30],
        [0.5, 0.6, 0.7],
      ],
      series: [
        { label: "M", unit: "emu", axis: 0 },
        { label: "T", unit: "K", axis: 1 },
      ],
    };
    const opts = buildOpts(dual, { ...base, yScale: "log", tool: "zoom" });
    expect(opts.scales?.y2?.distr).toBe(3); // y2 follows the log toggle
    expect(opts.axes).toHaveLength(3);
    expect(opts.axes?.[2]?.scale).toBe("y2");
    expect(opts.axes?.[2]?.side).toBe(1); // right side
    expect(opts.axes?.[2]?.label).toBe("T (K)"); // solo on the secondary
    // Series scale routing: first on "y", second on "y2".
    expect(opts.series[1].scale).toBe("y");
    expect(opts.series[2].scale).toBe("y2");
  });
});

describe("buildOpts select tool (#50 plot-brush)", () => {
  it("drags an x-band without rescaling (like region, unlike zoom)", () => {
    const sel = buildOpts(payload, { ...base, yScale: "linear", tool: "select" });
    expect(sel.cursor?.drag).toMatchObject({ x: true, y: false, setScale: false });
  });

  it("routes the drag-end band to onRangeSelect (not onRegionSelect)", () => {
    const onRangeSelect = vi.fn();
    const onRegionSelect = vi.fn();
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "select",
      onRangeSelect,
      onRegionSelect,
    });
    // Invoke the setSelect hook with a fake uPlot: 100px→data 1, 150px→data 1.5.
    const u = { select: { left: 100, width: 50 }, posToVal: (px: number) => px / 100 };
    opts.hooks?.setSelect?.[0]?.(u as never);
    expect(onRangeSelect).toHaveBeenCalledWith(1, 1.5);
    expect(onRegionSelect).not.toHaveBeenCalled();
  });

  it("ignores a zero-width (click) select", () => {
    const onRangeSelect = vi.fn();
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "select", onRangeSelect });
    const u = { select: { left: 100, width: 0 }, posToVal: (px: number) => px / 100 };
    opts.hooks?.setSelect?.[0]?.(u as never);
    expect(onRangeSelect).not.toHaveBeenCalled();
  });
});

describe("buildOpts non-monotonic x (hysteresis loops)", () => {
  // An M-vs-H loop: field sweeps up then back down — x is NOT ascending.
  const loop: PlotPayload = {
    data: [
      [-2, 0, 2, 0, -2],
      [-1, -0.5, 1, 0.5, -1],
    ],
    series: [{ label: "M", unit: "emu" }],
    xLabel: "Field",
    xUnit: "Oe",
  };
  const spyLinear = vi.fn(() => null);
  const spyPoints = vi.fn(() => null);

  it("declares the x series unsorted and sorted data ascending", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom" });
    expect((opts.series?.[0] as { sorted?: number }).sorted).toBe(0);
    const asc = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect((asc.series?.[0] as { sorted?: number }).sorted).toBe(1);
  });

  it("wraps the line paths to draw the full acquisition order", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom", linearPaths: spyLinear });
    const s = opts.series?.[1] as { paths?: (u: unknown, si: number, i0: number, i1: number) => unknown };
    expect(s.paths).toBeDefined();
    // uPlot would call with a collapsed window (e.g. 2..2); the wrapper must
    // forward the full index range instead.
    const fakeU = { data: [loop.data[0]] };
    s.paths!(fakeU, 1, 2, 2);
    expect(spyLinear).toHaveBeenCalledWith(fakeU, 1, 0, 4);
  });

  it("does NOT override paths when x is ascending", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", linearPaths: spyLinear });
    expect((opts.series?.[1] as { paths?: unknown }).paths).toBeUndefined();
  });

  it("wraps marker points the same way", () => {
    const opts = buildOpts(loop, {
      ...base, yScale: "linear", tool: "zoom", defaultTrace: "Scatter", pointsPaths: spyPoints,
    });
    const pts = (opts.series?.[1] as { points?: { paths?: (u: unknown, si: number, i0: number, i1: number, f?: unknown) => unknown } }).points;
    expect(pts?.paths).toBeDefined();
    const fakeU = { data: [loop.data[0]] };
    pts!.paths!(fakeU, 1, 2, 2, null);
    expect(spyPoints).toHaveBeenCalledWith(fakeU, 1, 0, 4, null);
  });

  it("supplies a full-scan y range (uPlot's own scan window is collapsed)", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom" });
    const range = opts.scales?.y?.range;
    expect(typeof range).toBe("function");
    const [lo, hi] = (range as () => [number, number])();
    expect(lo).toBeLessThanOrEqual(-1);
    expect(hi).toBeGreaterThanOrEqual(1);
  });

  it("keeps an explicit yLim over the full-scan range", () => {
    const opts = buildOpts(loop, { ...base, yScale: "linear", tool: "zoom", yLim: [-5, 5] });
    expect(opts.scales?.y?.range).toEqual([-5, 5]);
  });
});

describe("buildOpts y2 axis state (Origin double-Y apply, 13.2 #6)", () => {
  const dual: PlotPayload = {
    ...payload,
    data: [
      [0, 1, 2],
      [10, 20, 30],
      [0.5, 0.6, 0.7],
    ],
    series: [
      { label: "M", unit: "emu", axis: 0 },
      { label: "T", unit: "K", axis: 1 },
    ],
  };

  it("fixes the y2 range from y2Lim and scales it with y2Scale", () => {
    const opts = buildOpts(dual, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      y2Lim: [400, 1500],
      y2Scale: "log",
    });
    expect(opts.scales?.y2?.range).toEqual([400, 1500]);
    expect(opts.scales?.y2?.distr).toBe(3); // its own scale, not yScale's
    expect(opts.scales?.y?.distr).toBe(1); // primary stays linear
  });

  it("inherits yScale and autoscales when y2 state is absent (legacy behaviour)", () => {
    const opts = buildOpts(dual, { ...base, yScale: "log", tool: "zoom" });
    expect(opts.scales?.y2?.distr).toBe(3);
    expect(opts.scales?.y2?.range).toBeUndefined();
  });
});

describe("niceLinearStep", () => {
  it("picks a 1/2/5 x 10^n step aiming for ~5 ticks across the span", () => {
    expect(niceLinearStep(1)).toBeCloseTo(0.2); // 1/5 = 0.2 exactly
    expect(niceLinearStep(10)).toBeCloseTo(2); // 10/5 = 2 exactly
    expect(niceLinearStep(0.5)).toBeCloseTo(0.1); // 0.5/5 = 0.1 exactly
  });

  it("degenerates to 1 for a non-positive span", () => {
    expect(niceLinearStep(0)).toBe(1);
    expect(niceLinearStep(-5)).toBe(1);
  });
});

describe("fixedLogAxisSplits", () => {
  it("returns [] for a degenerate range (non-positive or inverted)", () => {
    expect(fixedLogAxisSplits(0, 10)).toEqual([]);
    expect(fixedLogAxisSplits(-1, 10)).toEqual([]);
    expect(fixedLogAxisSplits(10, 5)).toEqual([]);
    expect(fixedLogAxisSplits(5, 5)).toEqual([]);
  });

  it("gives pure powers-of-10 ticks for a multi-decade span (a normal reflectivity view)", () => {
    expect(fixedLogAxisSplits(1, 1e6)).toEqual([1, 10, 100, 1000, 1e4, 1e5, 1e6]);
  });

  it("gives pure powers-of-10 ticks even for an unrounded multi-decade span", () => {
    // PNR.opj "7kOe": y in [1e-10, 10.0], 11 decades — bounds already land on
    // decade boundaries, but the generator must never sneak the raw min/max
    // in as an extra non-decade tick the way uPlot's own logAxisSplits would.
    expect(fixedLogAxisSplits(1e-10, 10)).toEqual([
      1e-10, 1e-9, 1e-8, 1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2, 0.1, 1, 10,
    ]);
  });

  // Real PNR.opj sub-decade log figures (byte-verified via extract_figures):
  // Graph50 y in [0.713912526706576, 1.2731814642573132], y_step 0.1;
  // Graph52 y in [0.9772255479678681, 1.2916288117909744], y_step 0.05.
  it("Graph50: steps by the decoded LINEAR increment, not a decade multiplier", () => {
    expect(fixedLogAxisSplits(0.713912526706576, 1.2731814642573132, 0.1)).toEqual([
      0.8, 0.9, 1.0, 1.1, 1.2,
    ]);
  });

  it("Graph52: a different decoded step gives a different clean sequence", () => {
    expect(fixedLogAxisSplits(0.9772255479678681, 1.2916288117909744, 0.05)).toEqual([
      1.0, 1.05, 1.1, 1.15, 1.2, 1.25,
    ]);
  });

  it("falls back to a nice-number step for a sub-decade range with no decoded step", () => {
    const out = fixedLogAxisSplits(0.7, 1.3, null);
    // niceLinearStep(0.6) -> 0.1; ticks land on clean 0.1 multiples.
    expect(out).toEqual([0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]);
  });

  it("ignores a non-positive decoded step (falls back to nice-number)", () => {
    expect(fixedLogAxisSplits(0.7, 1.3, 0)).toEqual(fixedLogAxisSplits(0.7, 1.3, null));
    expect(fixedLogAxisSplits(0.7, 1.3, -0.1)).toEqual(fixedLogAxisSplits(0.7, 1.3, null));
  });
});

describe("reciprocalTransform (MAIN #12)", () => {
  it("is 1/v for positive v", () => {
    expect(reciprocalTransform(2)).toBe(0.5);
    expect(reciprocalTransform(0.25)).toBe(4);
    expect(reciprocalTransform(1)).toBe(1);
  });

  it("is self-inverse for positive v — fwd(fwd(v)) === v, so one function serves as both fwd and bwd", () => {
    for (const v of [1, 2, 5, 100, 0.001, 300]) {
      expect(reciprocalTransform(reciprocalTransform(v))).toBeCloseTo(v, 9);
    }
  });

  it("degrades non-positive input to NaN — the same domain restriction the log scale already has", () => {
    expect(Number.isNaN(reciprocalTransform(0))).toBe(true);
    expect(Number.isNaN(reciprocalTransform(-5))).toBe(true);
  });
});

describe("reciprocalAxisSplits (MAIN #12)", () => {
  it("returns [] for a degenerate range (non-positive or inverted)", () => {
    expect(reciprocalAxisSplits(0, 10)).toEqual([]);
    expect(reciprocalAxisSplits(-1, 10)).toEqual([]);
    expect(reciprocalAxisSplits(10, 5)).toEqual([]);
    expect(reciprocalAxisSplits(5, 5)).toEqual([]);
  });

  it("every returned tick lies within [min, max], sorted ascending", () => {
    const out = reciprocalAxisSplits(100, 300);
    expect(out.length).toBeGreaterThan(2);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(100);
      expect(v).toBeLessThanOrEqual(300);
    }
    expect(out).toEqual([...out].sort((a, b) => a - b));
  });

  it("ticks are evenly spaced IN RECIPROCAL SPACE (the defining property), even though the raw values aren't", () => {
    const out = reciprocalAxisSplits(100, 300);
    const recips = out.map((v) => 1 / v);
    const steps = recips.slice(1).map((r, i) => r - recips[i]);
    for (const s of steps) expect(s).toBeCloseTo(steps[0], 9); // constant step in 1/x
    // ...but the raw tick values are NOT evenly spaced — that's the whole
    // point of a reciprocal axis (labels read the natural variable, e.g. T
    // in Kelvin, while spacing follows 1/T — Origin's "Reciprocal" axis
    // convention referenced in the task brief).
    const rawSteps = out.slice(1).map((v, i) => v - out[i]);
    expect(new Set(rawSteps.map((s) => s.toFixed(6))).size).toBeGreaterThan(1);
  });

  it("lands on both endpoints when they sit on the reciprocal step grid", () => {
    // 1/50 = 0.02, 1/200 = 0.005 — a clean 0.005 reciprocal step lands on both.
    const out = reciprocalAxisSplits(50, 200);
    expect(out[0]).toBeCloseTo(50, 6);
    expect(out[out.length - 1]).toBeCloseTo(200, 6);
  });

  it("a bigger targetTicks never yields FEWER ticks than a smaller one", () => {
    const few = reciprocalAxisSplits(100, 1000, 2);
    const many = reciprocalAxisSplits(100, 1000, 10);
    expect(many.length).toBeGreaterThanOrEqual(few.length);
  });
});

describe("buildOpts fixed log-range ticks (plot-fidelity fix)", () => {
  it("supplies a custom splits function on a log Y axis with a fixed yLim", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "log",
      tool: "zoom",
      yLim: [0.7139, 1.2732],
      yStep: 0.1,
    });
    const splits = opts.axes?.[1].splits;
    expect(typeof splits).toBe("function");
    const fn = splits as (u: uPlot, i: number, min: number, max: number) => number[];
    expect(fn(null as unknown as uPlot, 1, 0.7139, 1.2732)).toEqual([0.8, 0.9, 1.0, 1.1, 1.2]);
  });

  it("leaves splits undefined on a log Y axis with NO fixed range (autoscale)", () => {
    const opts = buildOpts(payload, { ...base, yScale: "log", tool: "zoom" });
    expect(opts.axes?.[1].splits).toBeUndefined();
  });

  it("leaves splits undefined on a fixed but LINEAR axis", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", yLim: [0, 100] });
    expect(opts.axes?.[1].splits).toBeUndefined();
  });

  it("supplies splits on the secondary axis using y2Step when y2 has a fixed log range", () => {
    const dual: PlotPayload = {
      ...payload,
      data: [
        [0, 1, 2],
        [10, 20, 30],
        [0.9, 1.0, 1.1],
      ] as PlotPayload["data"],
      series: [
        { label: "M", unit: "emu", axis: 0 },
        { label: "T", unit: "K", axis: 1 },
      ],
    };
    const opts = buildOpts(dual, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      y2Lim: [0.9772, 1.2916],
      y2Scale: "log",
      y2Step: 0.05,
    });
    const splits = opts.axes?.[2].splits;
    expect(typeof splits).toBe("function");
    const fn = splits as (u: uPlot, i: number, min: number, max: number) => number[];
    expect(fn(null as unknown as uPlot, 2, 0.9772, 1.2916)).toEqual([1.0, 1.05, 1.1, 1.15, 1.2, 1.25]);
  });
});

describe("buildOpts reciprocal-scale ticks (MAIN #12)", () => {
  it("supplies a custom splits function on a reciprocal X axis EVEN with no fixed range (autoscale)", () => {
    // Unlike log (which can rely on uPlot's own rangeLog-anchored splits when
    // autoscaled), reciprocal has no uPlot-native locator at all — the
    // splits function must be present unconditionally.
    const opts = buildOpts(payload, { ...base, xScale: "reciprocal", yScale: "linear", tool: "zoom" });
    const splits = opts.axes?.[0].splits;
    expect(typeof splits).toBe("function");
    const fn = splits as (u: uPlot, i: number, min: number, max: number) => number[];
    expect(fn(null as unknown as uPlot, 0, 100, 300)).toEqual(reciprocalAxisSplits(100, 300));
  });

  it("also supplies splits on a reciprocal X axis WITH a fixed xLim", () => {
    const opts = buildOpts(payload, {
      ...base,
      xScale: "reciprocal",
      yScale: "linear",
      tool: "zoom",
      xLim: [100, 300],
    });
    const splits = opts.axes?.[0].splits;
    expect(typeof splits).toBe("function");
    const fn = splits as (u: uPlot, i: number, min: number, max: number) => number[];
    expect(fn(null as unknown as uPlot, 0, 100, 300)).toEqual(reciprocalAxisSplits(100, 300));
  });

  it("leaves splits undefined on a linear axis (no regression)", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.axes?.[0].splits).toBeUndefined();
  });

  it("supplies splits on the secondary axis when y2 is reciprocal", () => {
    const dual: PlotPayload = {
      ...payload,
      data: [
        [0, 1, 2],
        [10, 20, 30],
        [100, 150, 200],
      ] as PlotPayload["data"],
      series: [
        { label: "M", unit: "emu", axis: 0 },
        { label: "T", unit: "K", axis: 1 },
      ],
    };
    const opts = buildOpts(dual, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      y2Scale: "reciprocal",
    });
    expect(typeof opts.axes?.[2].splits).toBe("function");
    expect(opts.scales?.y2?.distr).toBe(100);
  });
});

describe("resolvePlotBg", () => {
  it("defaults to the dark ('theme') mode when bg is omitted", () => {
    const tokens = resolvePlotBg(undefined);
    expect(tokens.isDark).toBe(true);
  });

  it("'theme' and 'dark' resolve to the same (always-dark) tokens", () => {
    expect(resolvePlotBg("theme")).toEqual(resolvePlotBg("dark"));
  });

  it("'light' resolves to a non-dark background", () => {
    const tokens = resolvePlotBg("light");
    expect(tokens.isDark).toBe(false);
  });
});

describe("buildOpts literal-colour contrast substitution (dark-lines-on-dark-mode fix)", () => {
  // BuildOptsArgs.seriesStyles is an array aligned 1:1 with payload.series
  // (not the store's Record<number, SeriesStyle> — that's PlotView's shape,
  // resolved to this array form by usePlotPayload before reaching buildOpts).
  const blackStyle: (SeriesStyle | undefined)[] = [{ color: "black" }];
  const whiteStyle: (SeriesStyle | undefined)[] = [{ color: "white" }];
  const violetStyle: (SeriesStyle | undefined)[] = [{ color: "#8b5cf6" }];

  it("substitutes a literal black series stroke on the default (dark) background", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", seriesStyles: blackStyle });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).not.toBe("black");
  });

  it("keeps a literal black series stroke when the window is pinned to 'light'", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: blackStyle,
      bg: "light",
    });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).toBe("black");
  });

  it("substitutes a literal white series stroke when the window is pinned to 'light'", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: whiteStyle,
      bg: "light",
    });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).not.toBe("white");
  });

  it("keeps a literal white series stroke on the default (dark) background", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", seriesStyles: whiteStyle });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).toBe("white");
  });

  it("leaves a visible literal colour unchanged in either mode", () => {
    const dark = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", seriesStyles: violetStyle });
    const light = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: violetStyle,
      bg: "light",
    });
    expect((dark.series?.[1] as { stroke?: string }).stroke).toBe("#8b5cf6");
    expect((light.series?.[1] as { stroke?: string }).stroke).toBe("#8b5cf6");
  });

  it("leaves the default palette (token) colour untouched when no override is given", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    const series = opts.series?.[1] as { stroke?: string };
    // jsdom has no stylesheet loaded, so the palette token falls back to the
    // hardcoded default in `seriesColor` — the point of this assertion is
    // just that it ISN'T silently replaced by the ink-substitution path.
    expect(series.stroke).toBe("#8b5cf6");
  });

  it("axis stroke/grid colours flip between the dark and light mode tokens", () => {
    const dark = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    const light = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", bg: "light" });
    expect(dark.axes?.[0].stroke).not.toBe(light.axes?.[0].stroke);
  });
});

describe("buildOpts rich-text labels (GOTO #5)", () => {
  it("blanks the plain x label (band still reserved) and adds the rich plugin", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      // NOTE: "\\mu" — in a TS string "\m" silently drops the backslash and
      // "\f" is a form feed; both would test the wrong input.
      xAxisLabel: "$\\mu_0H$ (T)",
    });
    expect(opts.axes?.[0]?.label).toBe("");
    expect(opts.plugins).toHaveLength(1);
  });

  it("keeps uPlot's plain draw for INVALID markup (literal fallback, no plugin)", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", xAxisLabel: "$\\foo$" });
    expect(opts.axes?.[0]?.label).toBe("$\\foo$");
    expect(opts.plugins).toHaveLength(0);
  });

  it("keeps today's fast path exactly for $-free labels", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", xAxisLabel: "H (kOe)" });
    expect(opts.axes?.[0]?.label).toBe("H (kOe)");
    expect(opts.plugins).toHaveLength(0);
  });

  it("blanks a rich y-label override and pushes the plugin", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      yAxisLabel: "$M_{s}$ (emu)",
    });
    expect(opts.axes?.[1]?.label).toBe("");
    expect(opts.plugins).toHaveLength(1);
  });

  it("a rich AUTO solo-series label engages too (derived labels can be rich)", () => {
    const richAuto: PlotPayload = {
      data: [
        [0, 1],
        [1, 2],
      ],
      series: [{ label: "$\chi''$", unit: "emu" }],
      xLabel: "T",
      xUnit: "K",
    };
    const opts = buildOpts(richAuto, { ...base, yScale: "linear", tool: "zoom" });
    expect(opts.axes?.[1]?.label).toBe("");
    expect(opts.plugins).toHaveLength(1);
  });

  it("blanks a rich y2 label on the secondary axis", () => {
    const dual: PlotPayload = {
      data: [
        [0, 1],
        [1, 2],
        [3, 4],
      ],
      series: [
        { label: "M", unit: "emu" },
        { label: "R", unit: "ohm", axis: 1 },
      ],
      xLabel: "T",
      xUnit: "K",
    };
    const opts = buildOpts(dual, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      y2AxisLabel: "$H_{c2}$ (T)",
    });
    expect(opts.axes?.[2]?.label).toBe("");
    expect(opts.plugins).toHaveLength(1);
  });

  it("keeps the raw title string (the plugin swaps the DOM content at init)", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      title: "$\Delta T$ sweep",
    });
    expect(opts.title).toBe("$\Delta T$ sweep");
    expect(opts.plugins).toHaveLength(1);
  });
});

describe("buildOpts fill under/between curves (MAIN #13)", () => {
  const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "T" }] };

  it("sets series.fill/fillTo=0 for fill: 'under', derived (translucent) from its stroke", () => {
    const styles: (SeriesStyle | undefined)[] = [{ fill: "under", color: "#8b5cf6" }];
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom", seriesStyles: styles });
    const s = opts.series?.[1] as { fill?: string; fillTo?: number };
    expect(s.fill).toBe("color-mix(in oklab, #8b5cf6 25%, transparent)");
    expect(s.fillTo).toBe(0);
  });

  it("leaves fill/fillTo unset for 'none' or no style at all", () => {
    const opts = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    const s = opts.series?.[1] as { fill?: string; fillTo?: number };
    expect(s.fill).toBeUndefined();
    expect(s.fillTo).toBeUndefined();
  });

  it("adds an opts.bands entry for fill: {vs: channel}, resolved via `plotted`", () => {
    // plotted = [0, 1]: display series 0 = channel 0 ("A"), 1 = channel 1 ("B").
    const styles: (SeriesStyle | undefined)[] = [{ fill: { vs: 1 }, color: "#ff0000" }, undefined];
    const opts = buildOpts(two, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: styles,
      plotted: [0, 1],
    });
    expect(opts.bands).toEqual([
      { series: [1, 2], fill: "color-mix(in oklab, #ff0000 25%, transparent)" },
    ]);
    // The banding series itself carries no per-series fill (bands are opts-level).
    expect((opts.series?.[1] as { fill?: string }).fill).toBeUndefined();
  });

  it("omits bands entirely when nothing requests one", () => {
    const opts = buildOpts(two, { ...base, yScale: "linear", tool: "zoom", plotted: [0, 1] });
    expect(opts.bands).toBeUndefined();
  });

  it("drops a fill: {vs} band whose target channel isn't in `plotted`", () => {
    const styles: (SeriesStyle | undefined)[] = [{ fill: { vs: 5 } }];
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      seriesStyles: styles,
      plotted: [0],
    });
    expect(opts.bands).toBeUndefined();
  });
});

describe("buildOpts colour-mapped scatter (MAIN #14)", () => {
  it("hides the native line/points for a series with a colorByColumns entry", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      colorByColumns: new Map([[1, { channel: 1, z: [1, 2, 3], colormap: "viridis", lo: 1, hi: 3 }]]),
    });
    const s = opts.series?.[1] as { width?: number; points?: { show?: boolean } };
    expect(s.width).toBe(0);
    expect(s.points?.show).toBe(false);
  });

  it("registers the colour-scatter draw plugin only when colorByColumns is non-empty", () => {
    const withColorBy = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      colorByColumns: new Map([[1, { channel: 1, z: [1], colormap: "viridis", lo: 1, hi: 1 }]]),
    });
    const plain = buildOpts(payload, { ...base, yScale: "linear", tool: "zoom" });
    expect(withColorBy.plugins?.length).toBe((plain.plugins?.length ?? 0) + 1);
  });

  it("leaves a series with no colorByColumns entry drawn normally", () => {
    const opts = buildOpts(payload, {
      ...base,
      yScale: "linear",
      tool: "zoom",
      colorByColumns: new Map(), // empty -> no series affected
    });
    const s = opts.series?.[1] as { width?: number };
    expect(s.width).toBe(1.5); // the ordinary default line width
  });
});
