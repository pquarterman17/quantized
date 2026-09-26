// P2.6 "Missing levels and unbalanced groups are explicit" — the slot rule,
// the cap, the count labels / caveat, the notice and the dropped-row
// accounting (lib/levelSlots.ts).

import { describe, expect, it } from "vitest";

import {
  CAVEAT,
  MAX_LEVEL_SLOTS,
  barChartFromSlots,
  barCounts,
  buildBarLevelSlots,
  buildLevelSlots,
  countLabels,
  declaredLevels,
  droppedSummary,
  hideEmptySlots,
  isCaveated,
  levelNotice,
} from "./levelSlots";
import type { DataStruct, Dataset } from "./types";

/** channel 0 = lot (categorical, 3 declared levels A/B/C), 1 = y, 2 = wafer
 *  (categorical, 2 declared levels w1/w2). Lot C (code 2) has NO rows; lot B's
 *  y is all NaN; wafer w2 never occurs under lot A. */
function data(): DataStruct {
  return {
    time: [0, 1, 2, 3, 4, 5],
    values: [
      [0, 1, 0],
      [0, 2, 0],
      [0, 3, 0],
      [1, NaN, 0],
      [1, NaN, 1],
      [0, 4, 0],
    ],
    labels: ["lot", "y", "wafer"],
    units: ["", "", ""],
    metadata: {},
    cat_levels: { 0: ["A", "B", "C"], 2: ["w1", "w2"] },
  };
}
const ds = (over: Partial<Dataset> = {}): Dataset => ({ id: "d", name: "d", data: data(), ...over });

describe("buildLevelSlots — missing levels (P2.6)", () => {
  it("(a)+(b): a declared level with no rows and a level whose Y is all NaN are EMPTY slots, not gaps", () => {
    const r = buildLevelSlots(ds(), 1, 0, null, [], false);
    expect(r.slots.map((s) => s.label)).toEqual(["lot = A", "lot = B", "lot = C"]);
    expect(r.slots.map((s) => s.points.length)).toEqual([4, 0, 0]);
    expect(r.slots[1].nanY).toBe(2);
    expect(r.hiddenEmpty).toBe(0);
    expect(r.capped).toBe(false);
  });

  it("hideEmpty drops exactly the empty slots and says how many", () => {
    const r = buildLevelSlots(ds(), 1, 0, null, [], true);
    expect(r.slots.map((s) => s.label)).toEqual(["lot = A"]);
    expect(r.hiddenEmpty).toBe(2);
    expect(r.capped).toBe(false); // the USER hid them, not the cap
  });

  it("(b): a level whose rows are all EXCLUDED is an empty slot that counts them as dropped", () => {
    // rows 0-2 and 5 are lot A; excluding all four empties lot A too.
    const r = buildLevelSlots(ds({ excludedRows: [0, 1, 2, 5] }), 1, 0, null, [], false);
    expect(r.slots.map((s) => s.points.length)).toEqual([0, 0, 0]);
    expect(r.slots[0].dropped).toBe(4);
  });

  it("point rowIndex is the ANALYSIS-view row (the jitter identity), not the raw row", () => {
    const r = buildLevelSlots(ds({ excludedRows: [1] }), 1, 0, null, [], false);
    // raw rows 0,2,5 survive for lot A -> analysis rows 0,1,4
    expect(r.slots[0].points).toEqual([
      { value: 1, rowIndex: 0 },
      { value: 3, rowIndex: 1 },
      { value: 4, rowIndex: 4 },
    ]);
    expect(r.slots[0].dropped).toBe(1);
  });

  it("(c): nested never-occurring combinations follow the SAME rule — empty labelled slots in nested order", () => {
    const r = buildLevelSlots(ds(), 1, 0, 2, [], false);
    expect(r.slots.map((s) => [s.label, s.points.length])).toEqual([
      ["lot = A / wafer = w1", 4],
      ["lot = A / wafer = w2", 0],
      ["lot = B / wafer = w1", 0],
      ["lot = B / wafer = w2", 0],
      ["lot = C / wafer = w1", 0],
      ["lot = C / wafer = w2", 0],
    ]);
    expect(buildLevelSlots(ds(), 1, 0, 2, [], true).slots.map((s) => s.label)).toEqual(["lot = A / wafer = w1"]);
  });

  it("honours the user's level order for declared-but-absent levels too", () => {
    const d = data();
    d.level_order = { 0: [2, 0] };
    expect(declaredLevels(d, 0)).toEqual([2, 0, 1]);
    const r = buildLevelSlots({ id: "d", name: "d", data: d }, 1, 0, null, [], false);
    expect(r.slots.map((s) => s.label)).toEqual(["lot = C", "lot = A", "lot = B"]);
  });

  it("per-plotted-channel fallback: a channel with no finite value is an empty slot", () => {
    const d = data();
    d.values = d.values.map((row) => [...row, NaN]);
    d.labels = [...d.labels, "dead"];
    d.units = [...d.units, ""];
    const r = buildLevelSlots({ id: "d", name: "d", data: d }, 1, null, null, [1, 3], false);
    expect(r.slots.map((s) => [s.label, s.points.length, s.nanY])).toEqual([
      ["y", 4, 2],
      ["dead", 0, 6],
    ]);
  });
});

describe("buildLevelSlots — the slot cap", () => {
  function wide(nA: number, nB: number): Dataset {
    // every A level occurs once, with B = 0 only -> nA * (nB - 1) empty cells
    const values = Array.from({ length: nA }, (_, a) => [a, a + 1, 0]);
    return {
      id: "w",
      name: "w",
      data: {
        time: values.map((_, i) => i),
        values,
        labels: ["lot", "y", "wafer"],
        units: ["", "", ""],
        metadata: {},
        cat_levels: {
          0: Array.from({ length: nA }, (_, i) => `L${i}`),
          2: Array.from({ length: nB }, (_, i) => `W${i}`),
        },
      },
    };
  }

  it(`an empty-inclusive layout over ${MAX_LEVEL_SLOTS} slots hides the EMPTY slots and flags it`, () => {
    const r = buildLevelSlots(wide(21, 10), 1, 0, 2, [], false); // 210 > 200
    expect(r.capped).toBe(true);
    expect(r.slots).toHaveLength(21); // only the occurring cells
    expect(r.slots.every((s) => s.points.length > 0)).toBe(true);
    expect(r.hiddenEmpty).toBe(210 - 21);
    expect(levelNotice(r.slots.map((s) => s.points.length), r.hiddenEmpty, r.capped)).toContain(
      `${210 - 21} empty level slots hidden (over the ${MAX_LEVEL_SLOTS}-slot cap)`,
    );
  });

  it(`exactly ${MAX_LEVEL_SLOTS} slots is still under the cap — every empty slot is shown`, () => {
    const r = buildLevelSlots(wide(20, 10), 1, 0, 2, [], false); // 200
    expect(r.capped).toBe(false);
    expect(r.slots).toHaveLength(200);
  });

  it("the cap never hides a slot WITH data, even past it", () => {
    const r = buildLevelSlots(wide(250, 1), 1, 0, 2, [], false); // 250 filled, 0 empty
    expect(r.slots).toHaveLength(250);
    expect(r.capped).toBe(false);
  });
});

describe("countLabels / isCaveated / levelNotice", () => {
  it("n=0 and the caveat always show; the plain count follows showN", () => {
    expect(countLabels([10, 0, 2, 9], true)).toEqual(["n=10", "n=0", `n=2${CAVEAT}`, "n=9"]);
    expect(countLabels([10, 0, 2, 9], false)).toEqual([null, "n=0", `n=2${CAVEAT}`, null]);
  });

  it("caveat thresholds: n < 3, or n/max < 0.2 (0.2 itself is not flagged)", () => {
    expect(isCaveated(2, 3)).toBe(true);
    expect(isCaveated(3, 3)).toBe(false);
    expect(isCaveated(19, 100)).toBe(true);
    expect(isCaveated(20, 100)).toBe(false);
    expect(isCaveated(0, 100)).toBe(false);
  });

  it("the notice fires on imbalance or low n, and stays silent for balanced groups", () => {
    expect(levelNotice([10, 12, 11])).toBeNull();
    expect(levelNotice([100, 10])).toBe(
      `${CAVEAT} Unbalanced groups (n = 10 to 100; min/max n = 0.10 < 0.2): ` +
        `summary stats and error bars on ${CAVEAT} groups are unreliable`,
    );
    expect(levelNotice([5, 2, 0])).toContain("1 group with n < 3");
    expect(levelNotice([0, 0])).toBeNull();
  });

  it("says 'Small groups', not 'Unbalanced', when only the low-n rule fired (PR #433 nit)", () => {
    expect(levelNotice([2])).toMatch(new RegExp(`^${CAVEAT} Small groups \\(n = 2 to 2; 1 group with n < 3\\)`));
    expect(levelNotice([2, 2])).toContain("Small groups");
    expect(levelNotice([10, 2])).toContain("Small groups"); // ratio exactly 0.2: not unbalanced
    expect(levelNotice([11, 2])).toContain("Unbalanced groups"); // ratio 0.18
  });

  it("never prints a false inequality: a ratio just under 0.2 is floored, not rounded up", () => {
    expect(levelNotice([1000, 199])).toContain("min/max n = 0.19 < 0.2");
  });
});

describe("hideEmptySlots — the option as a pure view step", () => {
  it("drops the empty slots of a result built with hiding off, and counts them", () => {
    const base = buildLevelSlots(ds(), 1, 0, null, [], false);
    const hidden = hideEmptySlots(base, true);
    expect(hidden.slots.map((s) => s.label)).toEqual(["lot = A"]);
    expect(hidden.hiddenEmpty).toBe(2);
    expect(hideEmptySlots(base, false)).toBe(base);
    // Same filled slot OBJECTS either way — the stats never need recomputing.
    expect(hidden.slots[0]).toBe(base.slots[0]);
  });
});

describe("droppedSummary", () => {
  it("counts excluded rows, NaN-Y values and level-less rows, with a per-level breakdown", () => {
    const r = buildLevelSlots(ds({ excludedRows: [0] }), 1, 0, null, [], false);
    expect(droppedSummary(r)).toEqual({
      text: "Dropped: 1 excluded/filtered row, 2 non-finite Y values",
      detail: "lot = A: 1 excluded/filtered\nlot = B: 2 non-finite Y",
    });
  });

  it("counts a row whose GROUP code is missing instead of letting it vanish", () => {
    const d = data();
    d.values = [...d.values, [NaN, 7, 0], [NaN, 8, 0]];
    d.time = [...d.time, 6, 7];
    const r = buildLevelSlots({ id: "d", name: "d", data: d }, 1, 0, null, [], false);
    expect(r.noLevel).toBe(2);
    expect(droppedSummary(r)?.text).toBe("Dropped: 2 non-finite Y values, 2 rows with no level");
  });

  it("counts an excluded row ONCE in the per-channel fallback, however many channels plot it", () => {
    const d = data();
    d.values = d.values.map((row) => [...row, 1]);
    d.labels = [...d.labels, "z"];
    d.units = [...d.units, ""];
    const r = buildLevelSlots({ id: "d", name: "d", data: d, excludedRows: [0] }, 1, null, null, [1, 3], false);
    expect(r.droppedTotal).toBe(1);
    expect(droppedSummary(r)?.text).toBe("Dropped: 1 excluded/filtered row, 2 non-finite Y values");
  });

  it("is null when nothing was dropped", () => {
    expect(droppedSummary({ lossy: [], droppedTotal: 0, noLevel: 0 })).toBeNull();
  });
});

describe("buildBarLevelSlots — bar categories follow the same slot rule", () => {
  it("declared/NaN-only levels are empty categories (n=0 in every series); hide drops them", () => {
    const b = buildBarLevelSlots(ds(), 0, [1], false);
    const m = barChartFromSlots(b, ["y"]);
    expect(m.groups.map((g) => [g.label, g.series[0].n])).toEqual([["A", 4], ["B", 0], ["C", 0]]);
    expect(barChartFromSlots(buildBarLevelSlots(ds(), 0, [1], true), ["y"]).groups.map((g) => g.label)).toEqual(["A"]);
  });

  it("a category is kept while ANY series has data there", () => {
    const d = data();
    d.values = d.values.map((row) => [...row, row[0] === 1 ? 5 : NaN]); // series 2 only has lot B
    d.labels = [...d.labels, "z"];
    d.units = [...d.units, ""];
    const b = buildBarLevelSlots({ id: "d", name: "d", data: d }, 0, [1, 3], true);
    expect(b.labels).toEqual(["A", "B"]);
    expect(barCounts(barChartFromSlots(b, ["y", "z"]), false)).toEqual([4, 0, 0, 2]);
  });

  it("STACKED labels each category with its TOTAL n — never n=0 over a visible bar (PR #433)", () => {
    // Lot A has rows only in y, lot B only in z (the TOP segment). The old
    // top-segment n printed "n=0" over lot A's visible bar.
    const d = data();
    d.values = d.values.map((row) => [...row, row[0] === 1 ? 5 : NaN]);
    d.labels = [...d.labels, "z"];
    d.units = [...d.units, ""];
    const b = buildBarLevelSlots({ id: "d", name: "d", data: d }, 0, [1, 3], true);
    const counts = barCounts(barChartFromSlots(b, ["y", "z"]), true, b);
    expect(counts).toEqual([4, 2]);
    expect(countLabels(counts, true)).toEqual(["n=4", `n=2${CAVEAT}`]);
  });

  it("STACKED counts a row that has values in several series ONCE", () => {
    const d = data();
    d.values = d.values.map((row) => [...row, 7]); // z finite on every row
    d.labels = [...d.labels, "z"];
    d.units = [...d.units, ""];
    const b = buildBarLevelSlots({ id: "d", name: "d", data: d }, 0, [1, 3], false);
    // A: 4 rows (y and z both finite -> still 4); B: 2 rows (z only); C: none.
    expect(barCounts(barChartFromSlots(b, ["y", "z"]), true, b)).toEqual([4, 2, 0]);
  });
});
