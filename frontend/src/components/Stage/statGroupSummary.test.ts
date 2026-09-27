// statGroupSummary — the per-group summary table and its row-selection link
// (PRIMARY_SOFTWARE_AUDIT_PLAN P2.6 box 4). Pure: no React, no store.

import { describe, expect, it } from "vitest";

import { countGroupAxis, planGroupAxis } from "../../lib/groupAxis";
import { analysisData, droppedRows } from "../../lib/rowstate";
import { resolveGroupsIndexed } from "../../lib/statstage";
import type { DataStruct, Dataset } from "../../lib/types";
import {
  applyGesture,
  buildGroupSummary,
  describe as describeStats,
  markOf,
  selectedCount,
  selectionMarks,
  toAnalysisRows,
  visibleSummaryRows,
} from "./statGroupSummary";
import { levelAxes, type LevelsInput } from "./statStageLevels";

// grp declares A B C D. A: rows 0-2. B: rows 3-5, row 4 EXCLUDED, row 5 NaN.
// C: declared, no rows. D: rows 6-7. lot/wafer nest in cols 2/3.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7],
  values: [
    [0, 1, 0, 0],
    [0, 2, 0, 1],
    [0, 3, 1, 0],
    [1, 10, 1, 0],
    [1, 11, 1, 1],
    [1, Number.NaN, 0, 0],
    [3, 20, 1, 1],
    [3, 22, 0, 1],
  ],
  labels: ["grp", "y", "lot", "wafer"],
  units: ["", "", "", ""],
  metadata: {},
  cat_levels: { 0: ["A", "B", "C", "D"], 2: ["L0", "L1"], 3: ["W0", "W1"] },
};
const DS: Dataset = { id: "ds", name: "ds", data: DATA, excludedRows: [4] };

function axesFor(over: Partial<LevelsInput> = {}) {
  const data = analysisData(DS);
  return levelAxes({
    active: DS, data, mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
    barValueChannels: [1], facetCol: null, slices: null, ...over,
  })!;
}

describe("buildGroupSummary", () => {
  it("one row per axis slot — the empty level included — with the rows behind each box", () => {
    const s = buildGroupSummary(DS, axesFor());
    expect(s.rows.map((r) => [r.key, r.label, r.n])).toEqual([
      ["0", "grp = A", 3],
      ["1", "grp = B", 1],
      ["2", "grp = C", 0],
      ["3", "grp = D", 2],
    ]);
    // ORIGINAL rows: B keeps row 3 only — row 4 is excluded, row 5 is NaN.
    expect(s.rows.map((r) => r.rows)).toEqual([[0, 1, 2], [3], [], [6, 7]]);
    expect(s.rows[1]).toMatchObject({ nonFinite: 1, excluded: 1 });
    expect(s.rows[2].absent).toBe(true);
    expect(s.valueLabels).toEqual(["y"]);
    expect(s.rows[0].stats[0]).toMatchObject({ mean: 2, median: 2, min: 1, max: 3, sd: 1 });
    expect(Number.isNaN(s.rows[2].stats[0].mean)).toBe(true);
  });

  it("n is the axis's n, slot for slot (one walk collects both)", () => {
    const plan = planGroupAxis(DATA, 0, 2, [1], true);
    const axis = countGroupAxis(plan, DATA, droppedRows(DS), [1]);
    const s = buildGroupSummary(DS, axesFor({ group2Col: 2 }));
    expect(s.rows.map((r) => r.n)).toEqual(axis.slots.map((x) => x.n));
    expect(s.rows.map((r) => r.rows.length)).toEqual(axis.slots.map((x) => x.n));
  });

  it("nested: one row per (A, B) cell keyed `a|b`, empty cells kept — no key collisions", () => {
    const s = buildGroupSummary(DS, axesFor({ groupCol: 2, group2Col: 3 }));
    const keys = s.rows.map((r) => r.key);
    expect(keys).toEqual(["0|0", "0|1", "1|0", "1|1"]);
    expect(new Set(keys).size).toBe(keys.length);
    // lot L0 / wafer W0: rows 0 and 5 — 5 is NaN, so only row 0.
    expect(s.rows[0].rows).toEqual([0]);
    // L1/W1: rows 4 (excluded) and 6.
    expect(s.rows[3].rows).toEqual([6]);
  });

  it("two codes that share a label stay two keys with their own rows", () => {
    const dup: Dataset = { ...DS, data: { ...DATA, cat_levels: { ...DATA.cat_levels, 0: ["A", "A", "C", "D"] } } };
    const axes = levelAxes({
      active: dup, data: analysisData(dup), mode: "box", groupCol: 0, group2Col: null, valueCol: 1, plotted: [1],
      barValueChannels: [1], facetCol: null, slices: null,
    })!;
    const s = buildGroupSummary(dup, axes);
    expect(s.rows.slice(0, 2).map((r) => [r.key, r.rows])).toEqual([["0", [0, 1, 2]], ["1", [3]]]);
    const g = applyGesture(s.rows, "1", { toggle: false, range: false }, null, [], new Set())!;
    expect(g.rows).toEqual([3]);
  });

  it("per-channel fallback: slots are channels (`ch:<col>`), each described on its own column", () => {
    const s = buildGroupSummary(DS, axesFor({ groupCol: null, plotted: [1, 2] }));
    expect(s.rows.map((r) => r.key)).toEqual(["ch:1", "ch:2"]);
    expect(s.valueLabels).toEqual(["value"]);
    expect(s.rows[1].stats[0].max).toBe(1);
    expect(s.rows[0].rows).toEqual([0, 1, 2, 3, 6, 7]);
  });

  it("bar: one stats column per bar channel", () => {
    const s = buildGroupSummary(DS, axesFor({ mode: "bar", barValueChannels: [1, 2] }));
    expect(s.valueLabels).toEqual(["y", "lot"]);
    expect(s.rows[0].stats).toHaveLength(2);
  });

  it("hide empty levels: the table lists what the plot draws", () => {
    const s = buildGroupSummary(DS, axesFor());
    expect(visibleSummaryRows(s, true).map((r) => r.key)).toEqual(["0", "1", "3"]);
    expect(visibleSummaryRows(s, false)).toHaveLength(4);
  });
});

describe("describe", () => {
  it("median of an even count averages the middle pair; SD needs two values", () => {
    expect(describeStats([4, 1, 3, 2]).median).toBe(2.5);
    expect(Number.isNaN(describeStats([5]).sd)).toBe(true);
    expect(describeStats([Number.NaN, 2]).mean).toBe(2);
  });
});

describe("applyGesture", () => {
  const s = buildGroupSummary(DS, axesFor());
  const rows = s.rows;
  const none = new Set<string>();

  it("plain: replaces the selection with the group's rows", () => {
    expect(applyGesture(rows, "0", { toggle: false, range: false }, null, [3, 6], none)).toEqual({
      rows: [0, 1, 2],
      keys: ["0"],
    });
  });

  it("an EMPTY level is selectable and selects nothing", () => {
    expect(applyGesture(rows, "2", { toggle: false, range: false }, null, [0, 1], none)).toEqual({ rows: [], keys: ["2"] });
  });

  it("toggle adds a group to whatever else is selected, and removes a fully selected one", () => {
    const add = applyGesture(rows, "3", { toggle: true, range: false }, null, [0, 1, 2, 5], new Set(["0"]))!;
    expect(add.rows).toEqual([0, 1, 2, 5, 6, 7]);
    expect(add.keys.sort()).toEqual(["0", "3"]);
    const drop = applyGesture(rows, "0", { toggle: true, range: false }, null, add.rows, new Set(add.keys))!;
    expect(drop.rows).toEqual([5, 6, 7]);
    expect(drop.keys).toEqual(["3"]);
  });

  it("toggle on a picked empty level un-picks it", () => {
    const g = applyGesture(rows, "2", { toggle: true, range: false }, null, [], new Set(["2", "0"]))!;
    expect(g.keys).toEqual(["0"]);
  });

  it("range: every group from the anchor to here, in table order", () => {
    const g = applyGesture(rows, "3", { toggle: false, range: true }, "1", [], none)!;
    expect(g.keys).toEqual(["1", "2", "3"]);
    expect(g.rows.sort((a, b) => a - b)).toEqual([3, 6, 7]);
  });

  it("range with no usable anchor is a plain pick; an unknown key is refused", () => {
    expect(applyGesture(rows, "1", { toggle: false, range: true }, "gone", [], none)?.keys).toEqual(["1"]);
    expect(applyGesture(rows, "nope", { toggle: false, range: false }, null, [], none)).toBeNull();
  });

  it("a scope (one facet panel) narrows the group to its rows there", () => {
    const g = applyGesture(rows, "0", { toggle: false, range: false }, null, [], none, (r) => r !== 1)!;
    expect(g.rows).toEqual([0, 2]);
  });
});

describe("marks", () => {
  const s = buildGroupSummary(DS, axesFor());
  const [a, b, c] = s.rows;

  it("all / some / none, and a picked empty level reads selected", () => {
    const sel = new Set([0, 1, 2, 3, 4]);
    expect(markOf(a, sel, new Set())).toBe(2);
    expect(markOf(a, new Set([1]), new Set())).toBe(1);
    // Row 4 is selected but EXCLUDED: B's only box row is 3.
    expect(markOf(b, new Set([4]), new Set())).toBe(0);
    expect(markOf(c, sel, new Set())).toBe(0);
    expect(markOf(c, sel, new Set(["2"]))).toBe(2);
    expect(selectedCount(a, new Set([2, 7]))).toBe(1);
  });

  it("selectionMarks: keyed per drawn slot; unkeyed (closed-up) draws get no marks", () => {
    const axes = axesFor();
    const byKey = new Map(s.rows.map((r) => [r.key, r] as const));
    const drawn = axes.flat.slots.filter((x) => x.n > 0); // hide-empty order
    const m = selectionMarks(drawn, byKey, new Set([6, 7]), new Set(), new Set());
    expect(m?.slots).toEqual([0, 0, 2]);
    expect(selectionMarks(drawn.map((x) => ({ ...x, key: undefined })), byKey, new Set([6]), new Set(), new Set())).toBeNull();
    expect(selectionMarks(drawn, byKey, new Set(), new Set(), new Set())).toBeNull();
  });
});

describe("toAnalysisRows", () => {
  it("maps original rows to the analysis-view positions the points' rowIndex counts in", () => {
    // Row 4 is excluded, so original 6 is analysis position 5; 4 has none.
    expect([...toAnalysisRows(DS, [0, 4, 6])]).toEqual([0, 5]);
    // …and that IS the rowIndex the strip/box points carry for row 6.
    const groups = resolveGroupsIndexed(analysisData(DS)!, 0, 1, [1], null);
    const d = groups.find((g) => g.label.endsWith("D"))!;
    expect(d.points.map((p) => p.rowIndex)).toEqual([5, 6]);
  });
});
