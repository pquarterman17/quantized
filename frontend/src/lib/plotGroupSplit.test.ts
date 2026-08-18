// P1.5: applyGroupSplit's own unit tests, plus a direct parity assertion
// against lib/plotspec.ts's buildXY (the Graph Builder preview's group
// split) -- both must produce the identical level order/labels/masking for
// the identical inputs (P1.5 item 3: "level-aware labels everywhere").

import { describe, expect, it } from "vitest";

import { applyGroupSplit } from "./plotGroupSplit";
import type { PlotPayload } from "./plotdata";

function payload(): PlotPayload {
  return {
    data: [
      [1, 2, 3, 4],
      [10, 20, 30, 40],
    ],
    series: [{ label: "Moment", unit: "emu", axis: 0 }],
    xLabel: "x",
    xUnit: "",
  };
}

describe("applyGroupSplit", () => {
  it("splits one series into one per distinct level, masking non-matching rows to null", () => {
    // rows -> group codes 0,1,0,1
    const out = applyGroupSplit(payload(), [0, 1, 0, 1], "Sample", (c) => (c === 0 ? "A" : "B"));
    expect(out.series.map((s) => s.label)).toEqual(["Moment (Sample=A)", "Moment (Sample=B)"]);
    expect(out.data).toEqual([
      [1, 2, 3, 4],
      [10, null, 30, null], // level A rows
      [null, 20, null, 40], // level B rows
    ]);
  });

  it("levels sort ascending by numeric code, independent of first-seen order", () => {
    const out = applyGroupSplit(payload(), [2, 0, 1, 2], "G", (c) => `L${c}`);
    expect(out.series.map((s) => s.label)).toEqual(["Moment (G=L0)", "Moment (G=L1)", "Moment (G=L2)"]);
  });

  it("is the identity (unchanged payload) when there are no finite group codes", () => {
    const p = payload();
    const out = applyGroupSplit(p, [null, null, undefined, NaN], "G", (c) => `L${c}`);
    expect(out).toBe(p);
  });

  it("carries the base series' unit/axis onto every expanded level", () => {
    const out = applyGroupSplit(payload(), [0, 0, 1, 1], "G", (c) => `L${c}`);
    expect(out.series).toEqual([
      { label: "Moment (G=L0)", unit: "emu", axis: 0 },
      { label: "Moment (G=L1)", unit: "emu", axis: 0 },
    ]);
  });

  it("splits every Y series independently when more than one is plotted", () => {
    const p: PlotPayload = {
      data: [
        [1, 2],
        [10, 20],
        [100, 200],
      ],
      series: [
        { label: "M", unit: "emu", axis: 0 },
        { label: "H", unit: "Oe", axis: 0 },
      ],
      xLabel: "x",
      xUnit: "",
    };
    const out = applyGroupSplit(p, [0, 1], "G", (c) => `L${c}`);
    expect(out.series.map((s) => s.label)).toEqual(["M (G=L0)", "M (G=L1)", "H (G=L0)", "H (G=L1)"]);
    expect(out.data).toEqual([
      [1, 2],
      [10, null],
      [null, 20],
      [100, null],
      [null, 200],
    ]);
  });
});
