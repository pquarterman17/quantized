// Re-audit #13: a plain CSV with an error column drew an EMPTY Y title, and a
// multi-X book "(V)" with no name. The auto title read every series on the
// axis, hidden ones included -- the hidden error column made the series look
// like "several quantities", so the solo name was lost. The title now reads
// only the series drawn on that axis (as the export, which gets only those).
import { describe, expect, it, vi } from "vitest";

import type { PlotPayload } from "./plotdata";
import { drawnOnAxis } from "./sharedAxisTitle";
import { buildOpts } from "./uplotOpts";

const base = { width: 600, height: 400, xScale: "linear" as const, yScale: "linear" as const, tool: "zoom" as const, onReadout: vi.fn() };

const payload: PlotPayload = {
  data: [[0, 1, 2], [1, 2, 3], [0.1, 0.1, 0.1]] as PlotPayload["data"],
  series: [{ label: "Signal", unit: "" }, { label: "err", unit: "" }],
  xLabel: "Time",
  xUnit: "s",
};

describe("Y title from the drawn series only (re-audit #13)", () => {
  it("names the axis after the one drawn series when the error column is hidden", () => {
    expect(buildOpts(payload, { ...base, hidden: [false, true] }).axes?.[1]?.label).toBe("Signal");
  });

  it("a shared unit with a hidden second quantity keeps the drawn one's name", () => {
    const v: PlotPayload = { ...payload, series: [{ label: "Voltage", unit: "V" }, { label: "Noise", unit: "V" }] };
    expect(buildOpts(v, { ...base, hidden: [false, true] }).axes?.[1]?.label).toBe("Voltage (V)");
  });

  it("with every series drawn the rule is unchanged; with none drawn it reads them all", () => {
    // Both drawn: the joint title names both (gap audit 2 #11).
    expect(buildOpts(payload, base).axes?.[1]?.label).toBe("Signal, err");
    expect(drawnOnAxis([{}, {}], [true, true], 0)).toEqual([0, 1]);
    expect(drawnOnAxis([{ axis: 0 }, { axis: 1 }], [false, false], 1)).toEqual([1]);
  });
});
