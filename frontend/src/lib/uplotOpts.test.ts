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
});
