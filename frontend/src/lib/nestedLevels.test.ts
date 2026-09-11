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

  it("gives a B code ONE name, whichever A level it appears under (review H1)", () => {
    // The defect this module exists to prevent, found inside it — and the
    // fixture matters, because a simpler one does NOT discriminate (my first
    // attempt used a single sidecar covering every wafer, which both the broken
    // and the fixed version resolve identically; the sabotage stayed green).
    //
    // `barlayout.textLabelsFor` walks the sidecar keys in order and returns the
    // FIRST that is full-length, self-consistent, AND COVERS THE LEVELS IT IS
    // ASKED ABOUT. So two sidecars, where the earlier one covers only a subset,
    // make the answer depend on which levels you ask about:
    //   key "1" names wafers 0 and 1, and is BLANK for wafer 2 (blank cells are
    //           skipped as uninformative, so it does not cover 2);
    //   key "2" names all three.
    // Lot 0 holds wafers {0,1} -> key "1" covers -> "k1w0". Lot 1 holds {0,2}
    // -> key "1" misses 2 -> falls through to key "2" -> "k2w0". Wafer 0, two
    // names, same axis. Resolving once over the whole column's level set is
    // what removes the question.
    const twoSidecars: DataStruct = {
      time: [1, 2, 3, 4],
      values: [
        [10, 0, 0],
        [11, 0, 1],
        [20, 1, 0],
        [21, 1, 2],
      ],
      labels: ["thickness", "lot", "wafer"],
      units: ["nm", "", ""],
      metadata: {
        text_columns: {
          "1": ["k1w0", "k1w1", "k1w0", ""],
          "2": ["k2w0", "k2w1", "k2w0", "k2w2"],
        },
      },
    };
    const lvls = nestedLevels(twoSidecars, 1, 2);
    const namesFor = (code: number) =>
      lvls.flatMap((l) => l.bCodes.flatMap((c, i) => (c === code ? [l.bLabels[i]] : [])));

    // Wafer 0 appears under BOTH lots; it must carry one name, not two.
    expect(namesFor(0)).toHaveLength(2);
    expect(new Set(namesFor(0)).size).toBe(1);
  });

  it("keeps an A level whose every B code is non-finite — with NO nested levels", () => {
    // Review M1: the previous version of this test made the RESPONSE non-finite,
    // which this function never reads, so it asserted nothing the first test did
    // not already cover — appending a `.filter(l => l.bCodes.length > 0)`, the
    // direct negation of the documented contract, left all 31 tests green.
    // A genuinely empty A level needs its B codes gone, not its response.
    const emptyB: DataStruct = {
      time: [1, 2, 3],
      values: [
        [10, 0, 0],
        [11, 1, Number.NaN],
        [12, 1, Number.NaN],
      ],
      labels: ["thickness", "lot", "wafer"],
      units: ["nm", "", ""],
      metadata: {},
    };
    const lvls = nestedLevels(emptyB, 1, 2);
    expect(lvls.map((l) => l.aCode)).toEqual([0, 1]);
    expect(lvls[1].bCodes).toEqual([]);
    expect(lvls[1].bLabels).toEqual([]);
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
