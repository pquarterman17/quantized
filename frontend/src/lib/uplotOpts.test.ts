import { describe, expect, it, vi } from "vitest";

import { buildOpts, tickFormatter, xIsAscending } from "./uplotOpts";
import type { PlotPayload } from "./plotdata";

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
