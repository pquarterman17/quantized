// R1 of ROW_RANGE_CONTRACT through the real stores: a row range set on the
// shared analysis selection follows insert and delete (positions, remapped like
// excludedRows), is left alone by sort and Move rows (the status line says so),
// and the resolver reads it live.
import { beforeEach, describe, expect, it } from "vitest";

import { resolveAnalysisInputs, ROW_POLICY } from "../lib/analysisInputs";
import type { AnalysisSelectionItem } from "../lib/analysisSelection";
import type { Dataset } from "../lib/types";
import { useAnalysisSelection } from "./analysisSelection";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";

const n = 10;
const sheet = (): Dataset => ({
  id: "d",
  name: "run.csv",
  data: {
    time: Array.from({ length: n }, (_v, i) => i),
    values: Array.from({ length: n }, (_v, i) => [(i * 7) % n]), // a permutation: sorting moves rows
    labels: ["v"], units: ["V"], metadata: {},
  },
});
const item = (rowRange: AnalysisSelectionItem["rowRange"]): AnalysisSelectionItem => ({
  datasetId: "d", xKey: null, yKeys: [0], errorBindings: [], errorKeys: {}, factorKeys: [],
  rowIds: null, range: null, rowRange, roi: null,
});
const held = () => useAnalysisSelection.getState().selection!.items[0].rowRange;
const rowsUsed = () => {
  const inputs = resolveAnalysisInputs({
    datasets: useApp.getState().datasets, activeId: "d", selection: useAnalysisSelection.getState().selection!.items[0], policy: ROW_POLICY.selection,
  });
  return inputs.ok ? inputs.rowIds : inputs.reason;
};

beforeEach(() => {
  useApp.setState({ datasets: [sheet()], activeId: "d", history: [], future: [], status: "" });
  useAnalysisSelection.setState({
    toolId: "curvefit",
    selection: { version: 1, source: "worksheet", createdAt: "t", items: [item({ from: 3, to: 6 })] },
  });
});

describe("row range under row operations (real store)", () => {
  it("insert above moves it, inside grows it, after leaves it; the resolver follows", async () => {
    useApp.getState().insertRows("d", 1, 2); // above rows 4-7
    await Promise.resolve();
    expect(held()).toEqual({ from: 5, to: 8 });
    expect(rowsUsed()).toEqual([5, 6, 7, 8]);
    useApp.getState().insertRows("d", 7, 1); // inside the window
    expect(held()).toEqual({ from: 5, to: 9 });
    useApp.getState().insertRows("d", 12, 4); // after: row 12 is past the window's end (9)
    expect(held()).toEqual({ from: 5, to: 9 });
  });

  it("delete the first row, a middle row, and all rows; an emptied range refuses, never all rows", () => {
    useApp.getState().deleteRows("d", [3]);
    expect(held()).toEqual({ from: 3, to: 5 });
    useApp.getState().deleteRows("d", [4]);
    expect(held()).toEqual({ from: 3, to: 4 });
    expect(rowsUsed()).toEqual([3, 4]);
    useApp.getState().deleteRows("d", [3, 4]);
    expect(held()?.was).toBe("rows 4-5");
    expect(rowsUsed()).toBe("rows 4-5 no longer exist");
  });

  it("deleting rows above moves it up by the deleted count", () => {
    useApp.getState().deleteRows("d", [0, 1]);
    expect(held()).toEqual({ from: 1, to: 4 });
  });

  it("sort leaves the positions and the status line says the range now covers different rows", () => {
    sortWorksheetRows("d", 0, 1);
    expect(held()).toEqual({ from: 3, to: 6 });
    expect(useApp.getState().status).toMatch(/1 row range is by position and now covers different rows/);
    expect(rowsUsed()).toEqual([3, 4, 5, 6]); // same positions, different measurements
  });

  it("another worksheet's edits leave the range alone", () => {
    useApp.setState({ datasets: [sheet(), { ...sheet(), id: "e" }] });
    useApp.getState().deleteRows("e", [0]);
    expect(held()).toEqual({ from: 3, to: 6 });
  });
});
