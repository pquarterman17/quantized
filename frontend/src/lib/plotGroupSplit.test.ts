// P1.5: applyGroupSplit's own hand-written unit tests (below), PLUS a real
// runtime parity test (the final describe block) against lib/plotspec.ts's
// buildXY (the Graph Builder preview's group split) -- built through the
// SAME upstream buildColumns fetch and compared with `toEqual`, not two
// independently hand-synced expectations (review round P2: the ORIGINAL
// header here claimed this parity without an actual runtime check backing
// it -- exactly the P1.4 "two implementations drift apart, unnoticed"
// trap). That real test is what catches the two functions diverging; it is
// what makes "level-aware labels everywhere" (P1.5 item 3) a proven claim
// rather than an assertion.

import { describe, expect, it } from "vitest";

import { groupLevelLabel } from "./categorical";
import { buildColumns, type PlotPayload } from "./plotdata";
import { applyGroupSplit } from "./plotGroupSplit";
import { buildXY } from "./plotspec";
import type { DataStruct } from "./types";

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

  it("masks a non-finite Y value to null even on an otherwise-matching row -- guarded directly, not by relying on an already-masked upstream payload", () => {
    // Deliberately does NOT go through buildColumns (which already nulls
    // non-finite values before applyGroupSplit ever sees them, masking this
    // exact class of bug in the parity tests below) -- a raw NaN/Infinity
    // in the payload's own column must be masked HERE, independent of any
    // upstream invariant.
    const p: PlotPayload = {
      data: [
        [1, 2, 3],
        [10, NaN, 30],
      ],
      series: [{ label: "M", unit: "emu", axis: 0 }],
      xLabel: "x",
      xUnit: "",
    };
    const out = applyGroupSplit(p, [0, 0, 0], "G", (c) => `L${c}`);
    expect(out.data).toEqual([[1, 2, 3], [10, null, 30]]);
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

// Review round P2: REAL runtime parity against lib/plotspec.ts's buildXY --
// applyGroupSplit(buildColumns(data, ...)) must equal buildXY(data, ...)
// exactly, for the identical inputs, through the actual code paths (not a
// hand-copied expectation). Covers: level ordering (finite codes sorted
// ascending), label format, a categorical group channel's string levels
// (cat_levels, P1.5 item 3's own "never a raw code" rule), a non-finite Y
// value on an otherwise-matching row (the finite-guard divergence this
// round fixed), and more than one plotted Y channel.
function parityData(): DataStruct {
  return {
    time: [1, 2, 3, 4, 5],
    values: [
      [10, 100, 0],
      [20, 200, 1],
      [NaN, 300, 0], // non-finite Y on a level-0 (matching) row
      [40, 400, 1],
      [50, 500, 0],
    ],
    labels: ["M", "H", "Sample"],
    units: ["emu", "Oe", ""],
    metadata: {},
    cat_levels: { 2: ["NbAu-1", "NbAu-2"] }, // channel 2 (Sample) is categorical
  };
}

function viaApplyGroupSplit(data: DataStruct, xKey: number | null, yChannels: number[], groupCol: number) {
  const base = buildColumns(data, null, xKey, yChannels);
  const groupCodes = data.values.map((row) => row[groupCol]);
  return applyGroupSplit(base, groupCodes, data.labels[groupCol], (code) => groupLevelLabel(data, groupCol, code));
}

describe("applyGroupSplit vs buildXY — real runtime parity (P1.5 review P2)", () => {
  it("agree exactly for a single Y channel grouped by a categorical column", () => {
    const data = parityData();
    const expected = buildXY(data, null, [0], 2);
    const actual = viaApplyGroupSplit(data, null, [0], 2);
    expect(actual).toEqual(expected);
    // Not a vacuous pass -- prove the categorical label and the NaN mask
    // both actually landed, on both sides.
    expect(expected.series.map((s) => s.label)).toEqual(["M (Sample=NbAu-1)", "M (Sample=NbAu-2)"]);
    expect(expected.data[1]).toContain(null); // the NaN row masked to null
  });

  it("agree exactly for multiple Y channels", () => {
    const data = parityData();
    const expected = buildXY(data, null, [0, 1], 2);
    const actual = viaApplyGroupSplit(data, null, [0, 1], 2);
    expect(actual).toEqual(expected);
  });

  it("agree exactly with an explicit (non-time) x channel", () => {
    const data = parityData();
    const expected = buildXY(data, 1, [0], 2);
    const actual = viaApplyGroupSplit(data, 1, [0], 2);
    expect(actual).toEqual(expected);
  });
});
