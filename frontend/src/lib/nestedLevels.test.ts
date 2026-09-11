// `lib/nestedLevels` — the shared two-factor level STRUCTURE and its display
// order, consumed by the variability chart and the nested box plot.
//
// This file exists because a sabotage caught a hole: the co-occurrence rule is
// NOT observable through `groupsByNestedCategory`. Replacing the filter with a
// full-column B list left every test in `statschooser.test.ts` green, because a
// cell that a cross product invents has no finite values and the empty-cell drop
// removes it again. The structure is observable HERE, so the contract is
// asserted here, at the level that states it.

import { describe, expect, it } from "vitest";

import { nestedLevels } from "./nestedLevels";
import type { DataStruct } from "./types";

/** lot/wafer, the JMP reading: wafer codes repeat across lots and mean
 *  different things. Lot 0 holds wafers 0 and 1; lot 1 holds wafer 2 only. */
const LW: DataStruct = {
  time: [1, 2, 3, 4],
  values: [
    [10, 0, 0],
    [11, 0, 1],
    [20, 1, 2],
    [21, 1, 2],
  ],
  labels: ["thickness", "lot", "wafer"],
  units: ["nm", "", ""],
  metadata: {},
};

describe("nestedLevels", () => {
  it("nests only the B levels that CO-OCCUR with each A level", () => {
    // The contract, and the thing a cross product would break: lot 1 must NOT
    // carry wafers 0 and 1, and lot 0 must NOT carry wafer 2.
    const lvls = nestedLevels(LW, 1, 2);
    expect(lvls.map((l) => l.aCode)).toEqual([0, 1]);
    expect(lvls.map((l) => l.bCodes)).toEqual([[0, 1], [2]]);
  });

  it("honours the user's level order on factor A", () => {
    const ordered: DataStruct = { ...LW, level_order: { 1: [1, 0] } };
    expect(nestedLevels(ordered, 1, 2).map((l) => l.aCode)).toEqual([1, 0]);
  });

  it("honours it on factor B too, INSIDE each A level", () => {
    // The Group O-2 defect this module was extracted to prevent: A honouring
    // the order while B kept sorting by raw code — one chart, two orders.
    const ordered: DataStruct = { ...LW, level_order: { 2: [1, 0] } };
    expect(nestedLevels(ordered, 1, 2).map((l) => l.bCodes)).toEqual([[1, 0], [2]]);
  });

  it("a B order naming a level absent from THIS A level does not invent it", () => {
    // `orderLevels` fails open on absence; nesting must not turn that into a
    // cell that has no rows. Wafer 2 is named first but belongs to lot 1.
    const ordered: DataStruct = { ...LW, level_order: { 2: [2, 1, 0] } };
    expect(nestedLevels(ordered, 1, 2).map((l) => l.bCodes)).toEqual([[1, 0], [2]]);
  });

  it("resolves labels for both factors, positionally aligned with the codes", () => {
    const named: DataStruct = { ...LW, cat_levels: { 1: ["A", "B"], 2: ["w0", "w1", "w2"] } };
    const lvls = nestedLevels(named, 1, 2);
    expect(lvls.map((l) => l.aLabel)).toEqual(["A", "B"]);
    expect(lvls[0].bLabels).toEqual(["w0", "w1"]);
    expect(lvls[1].bLabels).toEqual(["w2"]);
  });

  it("keeps a structurally empty A level — dropping is the CALLER's job", () => {
    // Only bucketing knows whether a cell has finite payload, so this returns
    // structure and lets `buildNestedLevels` / `groupsByNestedCategory` drop.
    // Here lot 1's rows have a non-finite RESPONSE, which this function never
    // reads — so both lots must still appear.
    const holey: DataStruct = {
      ...LW,
      values: [
        [10, 0, 0],
        [11, 0, 1],
        [Number.NaN, 1, 2],
        [Number.NaN, 1, 2],
      ],
    };
    expect(nestedLevels(holey, 1, 2).map((l) => l.aCode)).toEqual([0, 1]);
  });

  it("ignores rows where either factor is non-finite", () => {
    const gappy: DataStruct = {
      ...LW,
      values: [
        [10, 0, 0],
        [11, 0, Number.NaN],
        [20, Number.NaN, 2],
        [21, 1, 2],
      ],
    };
    const lvls = nestedLevels(gappy, 1, 2);
    expect(lvls.map((l) => l.aCode)).toEqual([0, 1]);
    expect(lvls.map((l) => l.bCodes)).toEqual([[0], [2]]);
  });
});
