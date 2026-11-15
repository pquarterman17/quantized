// Worksheet Hide / Show columns and freeze panes (gap audit 5, item 8): each
// action is ONE undo step, the view state is per sheet and VIEW-ONLY (data,
// formulas and plotting never see it), it follows column insert / delete /
// move, and it round-trips a saved workspace with in-range validation.

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs";
import type { Dataset } from "../lib/types";
import { parseWorkspaceDataset } from "../lib/workspaceDatasetParse";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import { useApp } from "./useApp";
import { hideColumns, setFrozenColumns, showColumns } from "./worksheetColumnView";
import { deleteColumns, insertColumn, moveColumn } from "./worksheetColumns";

const N = 6;
const sheet = (id: string): Dataset => ({
  id,
  name: id,
  data: {
    time: [1, 2],
    values: [
      [10, 20, 30, 40, 50, 60],
      [11, 21, 31, 41, 51, 61],
    ],
    labels: ["A1", "B1", "C1", "D1", "E1", "F1"],
    units: Array(N).fill(""),
    metadata: {},
  },
});

const st = () => useApp.getState();
const ds = (id = "b") => st().datasets.find((d) => d.id === id)!;

beforeEach(() => {
  useApp.setState({ datasets: [sheet("b"), sheet("other")], activeId: "b", history: [], future: [], status: "", macroRecording: false, macroSteps: [] });
});

describe("hide / show", () => {
  it("hides columns view-only: the data, labels and formulas keep every column", () => {
    const before = ds().data;
    hideColumns("b", [3, 1, 1]);
    expect(ds().hiddenCols).toEqual([1, 3]);
    expect(ds().data).toBe(before); // untouched, same object
    expect(st().status).toMatch(/hid 2 columns/);
    expect(ds("other").hiddenCols).toBeUndefined(); // per worksheet
  });

  it("each action is ONE undo step", () => {
    hideColumns("b", [1, 2, 3]);
    expect(st().history).toHaveLength(1);
    hideColumns("b", [4]);
    expect(st().history).toHaveLength(2);
    st().undo();
    expect(ds().hiddenCols).toEqual([1, 2, 3]);
    st().undo();
    expect(ds().hiddenCols).toBeUndefined();
    st().redo();
    expect(ds().hiddenCols).toEqual([1, 2, 3]);
    showColumns("b");
    expect(ds().hiddenCols).toBeUndefined();
    st().undo(); // Show all is one step too
    expect(ds().hiddenCols).toEqual([1, 2, 3]);
  });

  it("unhides one column at a time, and ignores no-ops without an undo entry", () => {
    hideColumns("b", [1, 2]);
    const steps = st().history.length;
    showColumns("b", [1]);
    expect(ds().hiddenCols).toEqual([2]);
    hideColumns("b", [2, 99, -1]); // already hidden / out of range
    showColumns("b", [5]); // not hidden
    expect(st().history).toHaveLength(steps + 1);
    showColumns("b", [2]);
    expect(ds().hiddenCols).toBeUndefined(); // absent, never []
  });
});

describe("freeze", () => {
  it("freezes the first N columns, one undo step, 0 unfreezes", () => {
    setFrozenColumns("b", 2);
    expect(ds().frozenCols).toBe(2);
    expect(st().history).toHaveLength(1);
    setFrozenColumns("b", 2); // no change, no new step
    expect(st().history).toHaveLength(1);
    setFrozenColumns("b", 99);
    expect(ds().frozenCols).toBe(N);
    setFrozenColumns("b", 0);
    expect(ds().frozenCols).toBeUndefined();
    st().undo();
    expect(ds().frozenCols).toBe(N);
  });
});

describe("column insert / delete / move keep the view on the same columns", () => {
  it("insert shifts hidden columns and widens a prefix it lands inside", () => {
    hideColumns("b", [2]);
    setFrozenColumns("b", 2);
    insertColumn("b", 0);
    expect(ds().hiddenCols).toEqual([3]);
    expect(ds().frozenCols).toBe(3);
  });

  it("delete drops a hidden column that is deleted and narrows the prefix", () => {
    hideColumns("b", [1, 4]);
    setFrozenColumns("b", 3);
    deleteColumns("b", [1]);
    expect(ds().hiddenCols).toEqual([3]);
    expect(ds().frozenCols).toBe(2);
    st().undo();
    expect(ds().hiddenCols).toEqual([1, 4]);
    expect(ds().frozenCols).toBe(3);
  });

  it("move carries the hidden flag with the column", () => {
    hideColumns("b", [1]);
    moveColumn("b", 1, 4);
    expect(ds().hiddenCols).toEqual([4]);
  });
});

describe(".dwk round trip", () => {
  it("saves and reloads the hidden columns and the frozen prefix", () => {
    hideColumns("b", [1, 4]);
    setFrozenColumns("b", 2);
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds()] })) as { datasets: Record<string, unknown>[] };
    expect(doc.datasets[0].hiddenCols).toEqual([1, 4]);
    expect(doc.datasets[0].frozenCols).toBe(2);
    const back = parseWorkspaceDataset(doc.datasets[0], 0);
    expect(back.hiddenCols).toEqual([1, 4]);
    expect(back.frozenCols).toBe(2);
  });

  it("a plain sheet writes neither key", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds()] })) as { datasets: Record<string, unknown>[] };
    expect("hiddenCols" in doc.datasets[0]).toBe(false);
    expect("frozenCols" in doc.datasets[0]).toBe(false);
  });

  it("a hand-edited file cannot point past the columns", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds()] })) as { datasets: Record<string, unknown>[] };
    doc.datasets[0].hiddenCols = [2, 2, 99, -3, "x"];
    doc.datasets[0].frozenCols = 99;
    const back = parseWorkspaceDataset(doc.datasets[0], 0);
    expect(back.hiddenCols).toEqual([2]);
    expect(back.frozenCols).toBe(N);
    doc.datasets[0].frozenCols = -1;
    expect(parseWorkspaceDataset(doc.datasets[0], 0).frozenCols).toBeUndefined();
  });
});
