import { describe, expect, it, vi } from "vitest";

import {
  buildOpts,
  categoricalTickFormatter,
  fixedLogAxisSplits,
  niceLinearStep,
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

const base = { width: 600, height: 400, xLog: false, onReadout: vi.fn() };

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
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom" });
    const xr = (opts.scales?.x as { range?: unknown }).range;
    expect(typeof xr).toBe("function");
    const [lo, hi] = (xr as () => [number, number])();
    expect(lo).toBeLessThanOrEqual(-100);
    expect(hi).toBeGreaterThanOrEqual(100);
    expect(hi - lo).toBeGreaterThan(150); // the true sweep, not a [first,last] sliver
  });

  it("leaves the x range to uPlot (no function) when x is monotonic", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect((opts.scales?.x as { range?: unknown }).range).toBeUndefined();
  });

  it("an explicit xLim still wins over the loop x-range", () => {
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom", xLim: [-50, 50] });
    expect((opts.scales?.x as { range?: unknown }).range).toEqual([-50, 50]);
  });
});

describe("buildOpts publication template (fontSize + baseLineWidth)", () => {
  it("applies the template font size to the axes and base width to series", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", fontSize: 18, baseLineWidth: 3 });
    expect(opts.axes?.[0].font).toContain("18px");
    // series[0] is the x series; the first data series is index 1.
    expect((opts.series?.[1] as { width?: number }).width).toBe(3);
  });

  it("defaults to 12px / 1.5 when no template args are given (item 2, was 11px)", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.axes?.[0].font).toContain("12px");
    expect((opts.series?.[1] as { width?: number }).width).toBe(1.5);
  });

  it("sizes the axis title 2px over the tick font and grows label/tick room to match", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", fontSize: 18 });
    expect(opts.axes?.[0].labelFont).toContain("20px");
    expect(opts.axes?.[0].labelSize).toBeGreaterThan(30);
    expect(opts.axes?.[1].size as number).toBeGreaterThan(60);
  });
});

describe("buildOpts", () => {
  it("enables box-zoom drag only in zoom mode", () => {
    const zoom = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(zoom.cursor?.drag).toMatchObject({ x: true, y: true });
    const pan = buildOpts(payload, { ...base, yLog: false, tool: "pan" });
    expect(pan.cursor?.drag).toMatchObject({ x: false, y: false });
  });

  it("adds one plugin for pan and cursor, none for zoom", () => {
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).plugins).toHaveLength(0);
    expect(buildOpts(payload, { ...base, yLog: false, tool: "pan" }).plugins).toHaveLength(1);
    expect(buildOpts(payload, { ...base, yLog: false, tool: "cursor" }).plugins).toHaveLength(1);
  });

  it("adds the stats plugin only in the stats tool", () => {
    expect(
      buildOpts(payload, { ...base, yLog: false, tool: "stats", onStats: vi.fn() }).plugins,
    ).toHaveLength(1);
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).plugins).toHaveLength(0);
  });

  it("adds the reference-line plugin only when ref lines exist", () => {
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom", refLines: [] }).plugins).toHaveLength(0);
    const withRefs = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      refLines: [{ id: "r1", axis: "x", value: 1 }],
    });
    expect(withRefs.plugins).toHaveLength(1);
  });

  it("adds the wheel-zoom plugin only when the pref is on", () => {
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).plugins).toHaveLength(0);
    expect(
      buildOpts(payload, { ...base, yLog: false, tool: "zoom", wheelZoom: true }).plugins,
    ).toHaveLength(1);
  });

  it("the qfit tool adds the ROI-band gadget plugin by default (fit/integrate/stats/differentiate/fft)", () => {
    expect(buildOpts(payload, { ...base, yLog: false, tool: "qfit" }).plugins).toHaveLength(1);
    expect(
      buildOpts(payload, { ...base, yLog: false, tool: "qfit", gadgetMode: "integrate" }).plugins,
    ).toHaveLength(1);
  });

  it("the qfit tool swaps to the paired-cursors plugin in cursors mode (gap #34)", () => {
    expect(
      buildOpts(payload, { ...base, yLog: false, tool: "qfit", gadgetMode: "cursors" }).plugins,
    ).toHaveLength(1);
  });
});

describe("buildOpts defaultTrace", () => {
  type S = { width?: number; points?: { show?: boolean }; paths?: unknown };
  const series = (trace: string): S =>
    buildOpts(payload, { ...base, yLog: false, tool: "zoom", defaultTrace: trace }).series?.[1] as S;

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
      yLog: false,
      tool: "zoom",
      defaultTrace: "Step",
      steppedPaths: fn as unknown as Parameters<typeof buildOpts>[1]["steppedPaths"],
    }).series?.[1] as S;
    expect(s.paths).toBe(fn);
  });

  it("disables time mode on the x scale (physics axes are never timestamps)", () => {
    // uPlot defaults scales.x.time = true, which formats Qz/2θ/field as dates
    // ("12/31/69", ":00.040") and blanks negative x. Must be explicitly false.
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.scales?.x?.time).toBe(false);
  });

  it("sets the log distribution on the y scale when yLog", () => {
    expect(buildOpts(payload, { ...base, yLog: true, tool: "zoom" }).scales?.y?.distr).toBe(3);
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).scales?.y?.distr).toBe(1);
  });

  it("sets the log distribution on the x scale when xLog", () => {
    expect(buildOpts(payload, { ...base, xLog: true, yLog: false, tool: "zoom" }).scales?.x?.distr).toBe(3);
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).scales?.x?.distr).toBe(1);
  });

  it("labels the y series with its unit", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.series[1].label).toBe("M (emu)");
  });

  it("applies a legend-rename override to the series label and solo-axis label", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
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
      yLog: false,
      tool: "zoom",
      seriesLabels: [undefined, "renamed"],
    });
    expect(opts.series[1].label).toBe("M (emu)"); // untouched
    expect(opts.series[2].label).toBe("renamed");
  });

  it("labels the y axis when a single series is shown", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.axes?.[1]?.label).toBe("M (emu)");
    const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "" }] };
    // With >1 series the legend names them, so the axis label is omitted.
    expect(buildOpts(two, { ...base, yLog: false, tool: "zoom" }).axes?.[1]?.label).toBeUndefined();
  });

  it("applies explicit axis limits as static scale ranges", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      xLim: [0, 5],
      yLim: [-1, 10],
    });
    expect(opts.scales?.x?.range).toEqual([0, 5]);
    expect(opts.scales?.y?.range).toEqual([-1, 10]);
  });

  it("omits the range (autoscale) when no limits are given", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.scales?.x?.range).toBeUndefined();
    expect(opts.scales?.y?.range).toBeUndefined();
  });

  it("has no secondary axis when all series are on the primary", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.scales?.y2).toBeUndefined();
    expect(opts.axes).toHaveLength(2); // x + primary y only
  });

  it("applies a per-series color / width / line-style override", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
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
      yLog: false,
      tool: "zoom",
      seriesStyles: [{ marker: true, markerSize: 7 }],
    });
    expect(withMarkers.series[1].points).toMatchObject({ show: true, size: 7 });
    const noMarkers = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      seriesStyles: [{ width: 2 }],
    });
    expect(noMarkers.series[1].points).toMatchObject({ show: false });
  });

  it("maps the dotted line style and leaves solid/unset dash-free", () => {
    const dotted = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      seriesStyles: [{ line: "dotted" }],
    });
    expect(dotted.series[1].dash).toEqual([2, 4]);
    const solid = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      seriesStyles: [{ line: "solid" }],
    });
    expect(solid.series[1].dash).toBeUndefined();
  });

  it("falls back to default width when the style entry is undefined", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      seriesStyles: [undefined],
    });
    expect(opts.series[1].width).toBe(1.5);
    expect(opts.series[1].dash).toBeUndefined();
  });

  it("hides grid lines when showGrid is false, draws them otherwise", () => {
    const off = buildOpts(payload, { ...base, yLog: false, tool: "zoom", showGrid: false });
    expect((off.axes?.[0]?.grid as { show?: boolean }).show).toBe(false);
    expect((off.axes?.[1]?.grid as { show?: boolean }).show).toBe(false);
    const on = buildOpts(payload, { ...base, yLog: false, tool: "zoom", showGrid: true });
    expect((on.axes?.[1]?.grid as { stroke?: string }).stroke).toBeDefined();
    // default (undefined) keeps the grid
    const dflt = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect((dflt.axes?.[1]?.grid as { show?: boolean }).show).not.toBe(false);
  });

  it("formats ticks fixed/sci and leaves auto to uPlot", () => {
    const fixed = tickFormatter({ mode: "fixed", digits: 2 });
    expect(fixed?.(null as never, [1.5, 2], 0, 0, 0)).toEqual(["1.50", "2.00"]);
    const sci = tickFormatter({ mode: "sci", digits: 1 });
    expect(sci?.(null as never, [1500], 0, 0, 0)).toEqual(["1.5e+3"]);
    expect(tickFormatter({ mode: "auto", digits: 2 })).toBeUndefined();
    expect(tickFormatter(undefined)).toBeUndefined();
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

  it("a categorical payload (xCategories) attaches the ordinal tick formatter to the x axis only", () => {
    const cat: PlotPayload = { ...payload, xCategories: ["A", "B", "C"] };
    const opts = buildOpts(cat, { ...base, yLog: false, tool: "zoom" });
    expect(typeof opts.axes?.[0]?.values).toBe("function");
    const fn = opts.axes?.[0]?.values as unknown as (u: never, splits: number[]) => unknown[];
    expect(fn(null as never, [0, 1, 2])).toEqual(["A", "B", "C"]);
    // The y axis is untouched (no xFmt/yFmt supplied).
    expect(opts.axes?.[1]?.values).toBeUndefined();
  });

  it("xCategories wins over an explicit numeric xFmt on the x axis", () => {
    const cat: PlotPayload = { ...payload, xCategories: ["A", "B", "C"] };
    const opts = buildOpts(cat, {
      ...base,
      yLog: false,
      tool: "zoom",
      xFmt: { mode: "fixed", digits: 2 },
    });
    const fn = opts.axes?.[0]?.values as unknown as (u: never, splits: number[]) => unknown[];
    expect(fn(null as never, [0, 1])).toEqual(["A", "B"]); // not "0.00"/"1.00"
  });

  it("a plain numeric payload (no xCategories) is completely unaffected", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(opts.axes?.[0]?.values).toBeUndefined();
  });

  it("attaches the tick formatter to the x/y axes (and omits it for auto)", () => {
    const formatted = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      xFmt: { mode: "fixed", digits: 1 },
      yFmt: { mode: "sci", digits: 2 },
    });
    expect(typeof formatted.axes?.[0]?.values).toBe("function");
    expect(typeof formatted.axes?.[1]?.values).toBe("function");
    const auto = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(auto.axes?.[0]?.values).toBeUndefined();
    expect(auto.axes?.[1]?.values).toBeUndefined();
  });

  it("marks the x series ascending for sorted x (keeps uPlot's fast path)", () => {
    // base payload x = [0, 1, 2] is sorted ascending.
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
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
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom" });
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
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom", title: "Run 42" }).title).toBe(
      "Run 42",
    );
    // blank / whitespace / unset -> no title key (uPlot draws no title bar)
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom", title: "  " }).title).toBeUndefined();
    expect(buildOpts(payload, { ...base, yLog: false, tool: "zoom" }).title).toBeUndefined();
  });

  it("overrides the x-axis label, else derives it from the data", () => {
    const over = buildOpts(payload, { ...base, yLog: false, tool: "zoom", xAxisLabel: "H (kOe)" });
    expect(over.axes?.[0]?.label).toBe("H (kOe)");
    const auto = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect(auto.axes?.[0]?.label).toBe("Field (Oe)"); // payload.xLabel + xUnit
  });

  // Item B (decode-plan #36 residual, PNR.opj Graph11): `null` forces NO x
  // title even though data is present — an Origin layer whose decoded
  // x_title is genuinely blank (the owner hand-deleted a redundant
  // per-panel label) must render nothing, never a synthesized fallback.
  // `""`/undefined keep deriving (the pre-existing, store-wide convention —
  // see `store/useApp.ts`'s `xAxisLabel` doc).
  it("null forces a blank x-axis title instead of deriving one", () => {
    const forced = buildOpts(payload, { ...base, yLog: false, tool: "zoom", xAxisLabel: null });
    expect(forced.axes?.[0]?.label).toBe("");
    // "" still means "no override" (today's store-wide convention), unaffected.
    const blankString = buildOpts(payload, { ...base, yLog: false, tool: "zoom", xAxisLabel: "" });
    expect(blankString.axes?.[0]?.label).toBe("Field (Oe)");
  });

  it("overrides the primary y-axis label and forces it to show with >1 series", () => {
    const two: PlotPayload = { ...payload, series: [...payload.series, { label: "B", unit: "T" }] };
    // Without an override, >1 series leaves the axis label to the legend (undefined).
    expect(buildOpts(two, { ...base, yLog: false, tool: "zoom" }).axes?.[1]?.label).toBeUndefined();
    // With an override it shows regardless of series count.
    const over = buildOpts(two, { ...base, yLog: false, tool: "zoom", yAxisLabel: "Moment (emu)" });
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
    const opts = buildOpts(dual, { ...base, yLog: true, tool: "zoom" });
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
    const sel = buildOpts(payload, { ...base, yLog: false, tool: "select" });
    expect(sel.cursor?.drag).toMatchObject({ x: true, y: false, setScale: false });
  });

  it("routes the drag-end band to onRangeSelect (not onRegionSelect)", () => {
    const onRangeSelect = vi.fn();
    const onRegionSelect = vi.fn();
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
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
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "select", onRangeSelect });
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
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom" });
    expect((opts.series?.[0] as { sorted?: number }).sorted).toBe(0);
    const asc = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    expect((asc.series?.[0] as { sorted?: number }).sorted).toBe(1);
  });

  it("wraps the line paths to draw the full acquisition order", () => {
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom", linearPaths: spyLinear });
    const s = opts.series?.[1] as { paths?: (u: unknown, si: number, i0: number, i1: number) => unknown };
    expect(s.paths).toBeDefined();
    // uPlot would call with a collapsed window (e.g. 2..2); the wrapper must
    // forward the full index range instead.
    const fakeU = { data: [loop.data[0]] };
    s.paths!(fakeU, 1, 2, 2);
    expect(spyLinear).toHaveBeenCalledWith(fakeU, 1, 0, 4);
  });

  it("does NOT override paths when x is ascending", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", linearPaths: spyLinear });
    expect((opts.series?.[1] as { paths?: unknown }).paths).toBeUndefined();
  });

  it("wraps marker points the same way", () => {
    const opts = buildOpts(loop, {
      ...base, yLog: false, tool: "zoom", defaultTrace: "Scatter", pointsPaths: spyPoints,
    });
    const pts = (opts.series?.[1] as { points?: { paths?: (u: unknown, si: number, i0: number, i1: number, f?: unknown) => unknown } }).points;
    expect(pts?.paths).toBeDefined();
    const fakeU = { data: [loop.data[0]] };
    pts!.paths!(fakeU, 1, 2, 2, null);
    expect(spyPoints).toHaveBeenCalledWith(fakeU, 1, 0, 4, null);
  });

  it("supplies a full-scan y range (uPlot's own scan window is collapsed)", () => {
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom" });
    const range = opts.scales?.y?.range;
    expect(typeof range).toBe("function");
    const [lo, hi] = (range as () => [number, number])();
    expect(lo).toBeLessThanOrEqual(-1);
    expect(hi).toBeGreaterThanOrEqual(1);
  });

  it("keeps an explicit yLim over the full-scan range", () => {
    const opts = buildOpts(loop, { ...base, yLog: false, tool: "zoom", yLim: [-5, 5] });
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

  it("fixes the y2 range from y2Lim and scales it with y2Log", () => {
    const opts = buildOpts(dual, {
      ...base,
      yLog: false,
      tool: "zoom",
      y2Lim: [400, 1500],
      y2Log: true,
    });
    expect(opts.scales?.y2?.range).toEqual([400, 1500]);
    expect(opts.scales?.y2?.distr).toBe(3); // its own log flag, not yLog's
    expect(opts.scales?.y?.distr).toBe(1); // primary stays linear
  });

  it("inherits yLog and autoscales when y2 state is absent (legacy behaviour)", () => {
    const opts = buildOpts(dual, { ...base, yLog: true, tool: "zoom" });
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

describe("buildOpts fixed log-range ticks (plot-fidelity fix)", () => {
  it("supplies a custom splits function on a log Y axis with a fixed yLim", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: true,
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
    const opts = buildOpts(payload, { ...base, yLog: true, tool: "zoom" });
    expect(opts.axes?.[1].splits).toBeUndefined();
  });

  it("leaves splits undefined on a fixed but LINEAR axis", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", yLim: [0, 100] });
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
      yLog: false,
      tool: "zoom",
      y2Lim: [0.9772, 1.2916],
      y2Log: true,
      y2Step: 0.05,
    });
    const splits = opts.axes?.[2].splits;
    expect(typeof splits).toBe("function");
    const fn = splits as (u: uPlot, i: number, min: number, max: number) => number[];
    expect(fn(null as unknown as uPlot, 2, 0.9772, 1.2916)).toEqual([1.0, 1.05, 1.1, 1.15, 1.2, 1.25]);
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
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", seriesStyles: blackStyle });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).not.toBe("black");
  });

  it("keeps a literal black series stroke when the window is pinned to 'light'", () => {
    const opts = buildOpts(payload, {
      ...base,
      yLog: false,
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
      yLog: false,
      tool: "zoom",
      seriesStyles: whiteStyle,
      bg: "light",
    });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).not.toBe("white");
  });

  it("keeps a literal white series stroke on the default (dark) background", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom", seriesStyles: whiteStyle });
    const series = opts.series?.[1] as { stroke?: string };
    expect(series.stroke).toBe("white");
  });

  it("leaves a visible literal colour unchanged in either mode", () => {
    const dark = buildOpts(payload, { ...base, yLog: false, tool: "zoom", seriesStyles: violetStyle });
    const light = buildOpts(payload, {
      ...base,
      yLog: false,
      tool: "zoom",
      seriesStyles: violetStyle,
      bg: "light",
    });
    expect((dark.series?.[1] as { stroke?: string }).stroke).toBe("#8b5cf6");
    expect((light.series?.[1] as { stroke?: string }).stroke).toBe("#8b5cf6");
  });

  it("leaves the default palette (token) colour untouched when no override is given", () => {
    const opts = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    const series = opts.series?.[1] as { stroke?: string };
    // jsdom has no stylesheet loaded, so the palette token falls back to the
    // hardcoded default in `seriesColor` — the point of this assertion is
    // just that it ISN'T silently replaced by the ink-substitution path.
    expect(series.stroke).toBe("#8b5cf6");
  });

  it("axis stroke/grid colours flip between the dark and light mode tokens", () => {
    const dark = buildOpts(payload, { ...base, yLog: false, tool: "zoom" });
    const light = buildOpts(payload, { ...base, yLog: false, tool: "zoom", bg: "light" });
    expect(dark.axes?.[0].stroke).not.toBe(light.axes?.[0].stroke);
  });
});
