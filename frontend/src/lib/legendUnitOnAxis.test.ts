// UX8-C: the display-only legend flag of a shared-unit graph.
import { describe, expect, it } from "vitest";

import { legendUnitOnAxis } from "./legendUnitOnAxis";
import type { PlotPayload } from "./plotdata";
import type { DataStruct } from "./types";

const payload: PlotPayload = {
  data: [[0, 1], [1, 2], [3, 4], [5, 6]] as unknown as PlotPayload["data"],
  series: [
    { label: "MH_010K", unit: "emu" },
    { label: "MH_040K", unit: "emu", legend: "renamed upstream" },
    { label: "MH_010K (excluded)", unit: "emu", muted: true },
  ],
  xLabel: "Field",
  xUnit: "Oe",
};
const data = (meta: Record<string, unknown>): DataStruct => ({ time: [0], values: [[1]], labels: ["a"], units: ["emu"], metadata: meta });

describe("legendUnitOnAxis", () => {
  it("names each data curve by its bare label, keeping its unit and every companion untouched", () => {
    const out = legendUnitOnAxis(payload, data({ legend_unit_on_axis: true }));
    expect(out.series.map((s) => s.legend)).toEqual(["MH_010K", "renamed upstream", undefined]);
    expect(out.series.map((s) => s.unit)).toEqual(["emu", "emu", "emu"]);
  });

  it("is the identity without the flag", () => {
    expect(legendUnitOnAxis(payload, data({}))).toBe(payload);
    expect(legendUnitOnAxis(payload, undefined)).toBe(payload);
  });
});
