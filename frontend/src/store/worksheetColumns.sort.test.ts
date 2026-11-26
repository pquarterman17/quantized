// Sort Columns by a label row applies as ONE undo step and every index-keyed
// field follows its column, exactly as for Move column.

import { beforeEach, describe, expect, it } from "vitest";

import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";
import { reorderColumns } from "./worksheetColumns";

const book = (): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [1, 2],
    values: [[10, 100, 1000, 11], [20, 200, 2000, 22]],
    labels: ["A", "B", "C", "Sum"],
    units: ["", "", "", ""],
    metadata: {},
  },
  formulas: [{ name: "Sum", expr: "A + B", deps: ["A", "B"] }],
  columnDesignations: { 2: "Y-error" },
  cellRules: { 0: [{ kind: "duplicate", tone: "warn" }] },
});

const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "", macroRecording: true, macroSteps: [] });
});

describe("reorderColumns", () => {
  it("permutes the base columns in one undo step; the computed column stays last and recomputes", () => {
    const before = st().history.length;
    expect(reorderColumns("b", [2, 0, 1])).toBe(true);
    expect(ds().data.labels).toEqual(["C", "A", "B", "Sum"]);
    expect(ds().data.values.map((r) => r.slice(0, 3))).toEqual([[1000, 10, 100], [2000, 20, 200]]);
    expect(st().history.length).toBe(before + 1); // however many moves it took
    st().undo();
    expect(ds().data.labels).toEqual(["A", "B", "C", "Sum"]);
    expect(ds().data.values[0]).toEqual([10, 100, 1000, 11]);
    expect(ds().columnDesignations).toEqual({ 2: "Y-error" });
  });

  it("index-keyed fields follow their column", () => {
    reorderColumns("b", [2, 0, 1]);
    expect(ds().columnDesignations).toEqual({ 0: "Y-error" });
    expect(Object.keys(ds().cellRules!)).toEqual(["1"]);
  });

  it("records the moves for replay, in order", () => {
    reorderColumns("b", [2, 0, 1]);
    expect(st().macroSteps.map((s) => s.code)).toEqual(['qz.moveColumn("Book1", 2, 0)']);
  });

  it("an identical order is no change and no undo step; a bad permutation is refused", () => {
    expect(reorderColumns("b", [0, 1, 2])).toBe(false);
    expect(reorderColumns("b", [0, 0, 1])).toBe(false);
    expect(reorderColumns("b", [0, 1])).toBe(false);
    expect(st().history).toHaveLength(0);
    expect(ds().data.labels).toEqual(["A", "B", "C", "Sum"]);
  });
});
