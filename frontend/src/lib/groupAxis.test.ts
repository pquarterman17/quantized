// lib/groupAxis — P2.6 box 2, "missing levels and unbalanced groups are
// explicit". The axis must carry every level the column DECLARES or any row
// carries, count why each one has the rows it has, and line up with the groups
// the stage actually plots (`statstage.resolveGroups`) by order alone.

import { describe, expect, it } from "vitest";

import {
  MAX_AXIS_SLOTS,
  alignSlots,
  balanceCaveat,
  barCountAnchor,
  buildGroupAxis,
  groupNotice,
  visibleSlots,
  type AxisInput,
} from "./groupAxis";
import { pruneExcluded } from "./rowstate";
import { resolveGroups } from "./statstage";
import type { DataStruct } from "./types";

/** grp is categorical with FOUR declared levels: A B C D.
 *  - A: three good rows
 *  - B: two rows, both with a NaN value
 *  - C: declared, no row at all
 *  - D: two rows, both excluded by the caller (rows 5 and 6)
 *  plus one row with a missing (NaN) group code. */
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [
    [0, 1],
    [0, 2],
    [0, 3],
    [1, Number.NaN],
    [1, Number.NaN],
    [3, 7],
    [3, 8],
    [Number.NaN, 9],
  ],
  labels: ["grp", "y"],
  units: ["", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D"] },
};
const DROPPED = new Set([5, 6]);

function input(over: Partial<AxisInput> = {}): AxisInput {
  return {
    levels: DATA,
    rows: DATA,
    dropped: DROPPED,
    groupCol: 0,
    group2Col: null,
    valueCols: [1],
    fallbackCols: [1],
    prefixed: true,
    ...over,
  };
}

describe("buildGroupAxis — single factor", () => {
  it("keeps every declared level, including one no row uses, with its reason", () => {
    const { slots, unassigned, hiddenAbsent } = buildGroupAxis(input());
    expect(slots.map((s) => s.label)).toEqual(["grp = A", "grp = B", "grp = C", "grp = D"]);
    expect(slots.map((s) => [s.n, s.nonFinite, s.excluded, s.absent])).toEqual([
      [3, 0, 0, false],
      [0, 2, 0, false], // all-NaN Y
      [0, 0, 0, true], // declared, never occurs
      [0, 0, 2, false], // all excluded
    ]);
    expect(unassigned).toBe(1);
    expect(hiddenAbsent).toBe(0);
  });

  it("honours the user's level order, declared-only levels included", () => {
    const ordered = { ...DATA, level_order: { 0: [2, 3, 0, 1] } };
    const { slots } = buildGroupAxis(input({ levels: ordered, rows: ordered }));
    expect(slots.map((s) => s.label)).toEqual(["grp = C", "grp = D", "grp = A", "grp = B"]);
  });

  it("bare labels for bars", () => {
    expect(buildGroupAxis(input({ prefixed: false })).slots.map((s) => s.label)).toEqual(["A", "B", "C", "D"]);
  });

  it("over the slot cap, never-occurring levels go and are counted; occurring empties stay", () => {
    const many = Array.from({ length: MAX_AXIS_SLOTS + 5 }, (_, i) => `L${i}`);
    const big = { ...DATA, cat_levels: { 0: many } };
    const axis = buildGroupAxis(input({ levels: big, rows: big }));
    // A, B, D occur (B all-NaN, D all-excluded); every other declared level is absent.
    expect(axis.slots.map((s) => s.label)).toEqual(["grp = L0", "grp = L1", "grp = L3"]);
    expect(axis.hiddenAbsent).toBe(MAX_AXIS_SLOTS + 5 - 3);
  });

  it("per-channel fallback: one slot per channel, empty channel kept", () => {
    const d: DataStruct = { ...DATA, values: DATA.values.map((r) => [r[1], Number.NaN]), labels: ["y", "z"] };
    const { slots } = buildGroupAxis(input({ levels: d, rows: d, groupCol: null, fallbackCols: [0, 1] }));
    expect(slots.map((s) => [s.label, s.n, s.nonFinite, s.excluded])).toEqual([
      ["y", 4, 2, 2],
      ["z", 0, 6, 2],
    ]);
  });
});

describe("buildGroupAxis — nested", () => {
  // lot x wafer: lot 0 has wafers 0,1; lot 1 has wafer 0 only; wafer 1 of
  // lot 1 NEVER occurs.
  const LW: DataStruct = {
    time: [0, 1, 2, 3],
    values: [
      [0, 0, 1],
      [0, 1, 2],
      [1, 0, 3],
      [1, 0, 4],
    ],
    labels: ["lot", "wafer", "y"],
    units: ["", "", ""],
    metadata: {},
  };
  const nested = (over: Partial<AxisInput> = {}) =>
    input({ levels: LW, rows: LW, dropped: new Set(), groupCol: 0, group2Col: 1, valueCols: [2], ...over });

  it("shows the never-occurring combination as an empty slot, in nested order", () => {
    const { slots } = buildGroupAxis(nested());
    expect(slots.map((s) => [s.label, s.n, s.absent])).toEqual([
      ["lot = 0 / wafer = 0", 1, false],
      ["lot = 0 / wafer = 1", 1, false],
      ["lot = 1 / wafer = 0", 2, false],
      ["lot = 1 / wafer = 1", 0, true],
    ]);
  });

  it("over the cap, keeps only combinations that occur and counts the rest", () => {
    // 15 lots x 15 wafers = 225 > 200 cross; only the diagonal occurs.
    const n = 15;
    const diag: DataStruct = {
      time: Array.from({ length: n }, (_, i) => i),
      values: Array.from({ length: n }, (_, i) => [i, i, i]),
      labels: ["lot", "wafer", "y"],
      units: ["", "", ""],
      metadata: {},
    };
    const axis = buildGroupAxis(nested({ levels: diag, rows: diag }));
    expect(axis.slots).toHaveLength(n);
    expect(axis.slots.every((s) => s.n === 1)).toBe(true);
    expect(axis.hiddenAbsent).toBe(n * n - n);
  });

  it("over the cap, each A level's occurring B levels still follow B's display order", () => {
    // 15 x 15 > 200. Lot 0 carries wafers 3, 1, 2 (row order); wafer order is
    // descending, so the slots must read 3, 2, 1 under lot 0.
    const rows = [[0, 3], [0, 1], [0, 2], ...Array.from({ length: 14 }, (_, i) => [i + 1, i])];
    const d: DataStruct = {
      time: rows.map((_, i) => i),
      values: rows.map(([a, b]) => [a, b, 1]),
      labels: ["lot", "wafer", "y"],
      units: ["", "", ""],
      metadata: {},
      level_order: { 1: Array.from({ length: 15 }, (_, i) => 14 - i) },
    };
    const axis = buildGroupAxis(nested({ levels: d, rows: d }));
    expect(axis.slots.slice(0, 3).map((s) => s.label)).toEqual([
      "lot = 0 / wafer = 3",
      "lot = 0 / wafer = 2",
      "lot = 0 / wafer = 1",
    ]);
    expect(axis.slots.every((s) => !s.absent)).toBe(true);
  });
});

describe("alignSlots — threads the plotted groups onto the axis by order", () => {
  it("filled slots take resolveGroups' own labels and indices, in order", () => {
    const analysis = pruneExcluded(DATA, DROPPED);
    const groups = resolveGroups(analysis, 0, 1, [1]);
    const aligned = alignSlots(buildGroupAxis(input()).slots, groups.map((g) => g.label));
    expect(aligned?.map((s) => [s.label, s.group])).toEqual([
      ["grp = A", 0],
      ["grp = B", null],
      ["grp = C", null],
      ["grp = D", null],
    ]);
  });

  it("matches resolveGroups under a level order and nesting (the parity the design rests on)", () => {
    const d: DataStruct = {
      time: [0, 1, 2, 3, 4, 5],
      values: [
        [0, 1, 5],
        [1, 0, 6],
        [1, 1, Number.NaN],
        [2, 0, 7],
        [2, 1, 8],
        [0, 0, 9],
      ],
      labels: ["lot", "wafer", "y"],
      units: ["", "", ""],
      metadata: {},
      level_order: { 0: [2, 0, 1], 1: [1, 0] },
    };
    const groups = resolveGroups(d, 0, 2, [2], 1);
    const axis = buildGroupAxis({
      levels: d, rows: d, dropped: new Set(), groupCol: 0, group2Col: 1, valueCols: [2], fallbackCols: [], prefixed: true,
    });
    const aligned = alignSlots(axis.slots, groups.map((g) => g.label));
    expect(aligned).not.toBeNull();
    // Filled slots, read back in axis order, ARE the plotted groups in theirs.
    expect(aligned!.filter((s) => s.group !== null).map((s) => s.label)).toEqual(groups.map((g) => g.label));
    // ... and the one all-NaN combination sits where the level order puts it.
    expect(aligned!.filter((s) => s.group === null).map((s) => s.label)).toEqual(["lot = 1 / wafer = 1"]);
  });

  it("refuses (null) when the group count disagrees, rather than mislabel a box", () => {
    expect(alignSlots(buildGroupAxis(input()).slots, ["x", "y"])).toBeNull();
  });

  it("refuses a STALE draw whose count matches but whose groups are another column's", () => {
    // One filled slot here (grp = A); a draw still holding a different
    // grouping with one group must not be threaded onto it.
    expect(alignSlots(buildGroupAxis(input()).slots, ["fac = 0"])).toBeNull();
  });

  it("visibleSlots drops only the empty slots when hiding", () => {
    const aligned = alignSlots(buildGroupAxis(input()).slots, ["grp = A"])!;
    expect(visibleSlots(aligned, true).map((s) => s.label)).toEqual(["grp = A"]);
    expect(visibleSlots(aligned, false)).toHaveLength(4);
  });
});

describe("balanceCaveat", () => {
  const g = (...ns: number[]) => ns.map((n, i) => ({ label: `g${i}`, n }));

  it("flags n < 3", () => {
    expect(balanceCaveat(g(2, 5))).toBe("Caveat: n < 3 in 1 group - summaries and intervals are unreliable");
  });

  it("flags min/max below 0.2, and not at exactly 0.2", () => {
    expect(balanceCaveat(g(3, 20))).toContain("unbalanced groups (n 3-20)");
    expect(balanceCaveat(g(4, 20))).toBeNull();
  });

  it("ignores empty groups (they are reported as empty, not as small)", () => {
    expect(balanceCaveat(g(0, 10, 12))).toBeNull();
  });
});

describe("groupNotice", () => {
  it("names empties, drops, unassigned rows and the caveat on one line, per level in the tooltip", () => {
    const aligned = alignSlots(buildGroupAxis(input()).slots, ["grp = A"])!;
    const n = groupNotice({
      slots: aligned, counted: [{ label: "grp = A", n: 3 }], hideEmpty: false, hiddenAbsent: 0, unassigned: 1,
    });
    expect(n?.line).toBe(
      "3 empty levels (n=0) · 4 rows dropped (2 non-finite, 2 excluded/filtered) · 1 row with no level",
    );
    expect(n?.detail.split("\n")).toEqual([
      "grp = B: n=0, 2 non-finite",
      "grp = C: n=0 (never occurs)",
      "grp = D: n=0, 2 excluded/filtered",
    ]);
    expect(n?.caveat).toBeNull();
  });

  it("says they are hidden when the user hides them", () => {
    const aligned = alignSlots(buildGroupAxis(input()).slots, ["grp = A"])!;
    const n = groupNotice({ slots: aligned, counted: [], hideEmpty: true, hiddenAbsent: 0, unassigned: 0 });
    expect(n?.line.startsWith("3 empty levels hidden")).toBe(true);
  });

  it("is null when every level is present, balanced and nothing was dropped", () => {
    const slots = [{ label: "a", group: 0, n: 5, nonFinite: 0, excluded: 0, absent: false }];
    expect(groupNotice({ slots, counted: [{ label: "a", n: 5 }], hideEmpty: false, hiddenAbsent: 0, unassigned: 0 })).toBeNull();
  });

  it("carries the caveat and lists the small groups first in the tooltip", () => {
    const slots = [
      { label: "a", group: 0, n: 2, nonFinite: 0, excluded: 0, absent: false },
      { label: "b", group: 1, n: 40, nonFinite: 0, excluded: 0, absent: false },
    ];
    const n = groupNotice({
      slots, counted: [{ label: "a", n: 2 }, { label: "b", n: 40 }], hideEmpty: false, hiddenAbsent: 0, unassigned: 0,
    });
    expect(n?.line).toBe("Caveat: n < 3 in 1 group; unbalanced groups (n 2-40)");
    expect(n?.caveat).toBe("Caveat: n < 3 in 1 group; unbalanced groups (n 2-40) - summaries and intervals are unreliable");
    expect(n?.detail).toBe("small groups: a: n=2");
  });
});

describe("barCountAnchor", () => {
  it("sits above the whisker, never below zero, and at zero for a missing bar", () => {
    expect(barCountAnchor(2, 0.5)).toBe(2.5);
    expect(barCountAnchor(2, Number.NaN)).toBe(2);
    expect(barCountAnchor(-3, 1)).toBe(0);
    expect(barCountAnchor(Number.NaN, Number.NaN)).toBe(0);
  });
});
