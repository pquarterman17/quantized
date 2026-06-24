import { describe, expect, it, vi } from "vitest";

import { buildOpts } from "./uplotOpts";
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
