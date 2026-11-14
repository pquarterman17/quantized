// Gap audit 2 #1: a live graph's sheet is READ-ONLY for data -- every edit
// the rebuild from its sources would silently drop is refused with the graph
// notice (review finding 3) -- while edits on a SOURCE carry through to the
// graph's curves: a column insert/delete/move remaps them, a deleted column
// draws empty, and a re-import re-finds them by label (review finding 4).

import { beforeEach, describe, expect, it } from "vitest";

import { confirmErrorBindings } from "../lib/errorRoleConfirm";
import { LINKED_GRAPH_EDIT_NOTICE } from "../lib/rederived";
import { promoteFactor } from "../lib/metadataRun";
import type { Dataset } from "../lib/types";
import { addComputedError } from "./computedErrorRun";
import { addDerivedColumn } from "./derivedColumnRun";
import { moveWorksheetRows } from "./moveRows";
import { installLinkedCurvesSync } from "./linkedCurvesSync";
import { applyReimportMerge } from "./reimport";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { deleteColumns, insertColumn, moveColumn } from "./worksheetColumns";

const source = (): Dataset => ({
  id: "a",
  name: "A",
  data: { time: [0, 1], values: [[1, 10, 100], [2, 20, 200]], labels: ["P", "Q", "R"], units: ["", "", ""], metadata: {} },
});
const graph = (): Dataset => ({
  id: "g",
  name: "Graph1",
  data: { time: [0, 1], values: [[10], [20]], labels: ["Q"], units: [""], metadata: { linked_curve_legends: ["A"] } },
  linkedCurves: [{ datasetId: "a", xKey: null, yKey: 1 }, { datasetId: "a", xKey: 2, yKey: 0 }],
});
const g = () => useApp.getState().datasets.find((d) => d.id === "g")!;
const status = () => useApp.getState().status;

beforeEach(() => {
  useApp.setState({ datasets: [source(), graph()], activeId: "g", status: "", history: [] });
  installLinkedCurvesSync(); // what a created or loaded graph does (registers the column-shift seam)
});

describe("a graph refuses every data edit (review finding 3)", () => {
  it("cells, paste/fill, rows, columns, sort and move rows", () => {
    const before = g();
    useApp.getState().setCellValue("g", 0, 0, 5);
    expect(status()).toBe(LINKED_GRAPH_EDIT_NOTICE);
    useApp.getState().setCellBlock("g", [{ row: 0, col: 0, value: 5 }], "paste");
    useApp.getState().insertRows("g", 0, 1);
    useApp.getState().deleteRows("g", [0]);
    insertColumn("g", 0);
    deleteColumns("g", [0]);
    moveColumn("g", 0, 0);
    sortWorksheetRows("g", 0, 1);
    moveWorksheetRows("g", [1], "up");
    expect(g()).toBe(before);
  });

  it("formulas, the fx-bar column, computed errors, and Set Column Values", async () => {
    const before = g();
    useApp.setState({ status: "" });
    expect(useApp.getState().addFormula("g", "k", "B*2")).toBe(false);
    expect(status()).toBe(LINKED_GRAPH_EDIT_NOTICE);
    expect(await addDerivedColumn("g", { name: "k", expr: "B*2", propagate: false })).toMatchObject({ ok: false, error: LINKED_GRAPH_EDIT_NOTICE });
    expect(await addComputedError("g", 0, "sqrt")).toMatchObject({ ok: false, error: LINKED_GRAPH_EDIT_NOTICE });
    expect(useApp.getState().updateFormula("g", 0, { expr: "1" })).toBe(false);
    expect(g()).toBe(before);
  });

  it("corrections (apply, reset) — the rebuild would drop them", async () => {
    const before = g();
    expect(await useApp.getState().applyCorrections("g", { xOff: 1 } as never)).toBe(false);
    expect(status()).toBe(LINKED_GRAPH_EDIT_NOTICE);
    useApp.getState().resetCorrections("g");
    expect(g()).toBe(before);
  });

  it("error-role confirmations and metadata factors are not written to a graph", async () => {
    const before = g();
    confirmErrorBindings("g", [{ channel: 0, target: 0, axis: "y", side: "both" }]);
    expect(g()).toBe(before);
    await expect(promoteFactor(useApp.getState, ["g"], ["sample"], "auto", "Sample")).rejects.toThrow(LINKED_GRAPH_EDIT_NOTICE);
  });

  it("plot styling still works on a graph", () => {
    useApp.getState().setSeriesLabel(0, "renamed");
    expect(useApp.getState().seriesLabels[0]).toBe("renamed");
  });
});

describe("source column edits carry through to the graph", () => {
  it("insert and move remap the curves", () => {
    insertColumn("a", 0);
    expect(g().linkedCurves).toEqual([{ datasetId: "a", xKey: null, yKey: 2 }, { datasetId: "a", xKey: 3, yKey: 1 }]);
    moveColumn("a", 3, 1); // R (now 3) to position 1
    expect(g().linkedCurves).toEqual([{ datasetId: "a", xKey: null, yKey: 3 }, { datasetId: "a", xKey: 1, yKey: 2 }]);
  });

  it("deleting a curve's Y or X column leaves that curve empty, never another column", () => {
    deleteColumns("a", [2]); // R: the second curve's X
    expect(g().linkedCurves).toEqual([{ datasetId: "a", xKey: null, yKey: 1 }, { datasetId: "a", xKey: null, yKey: -1 }]);
    deleteColumns("a", [1]); // Q: the first curve's Y
    expect(g().linkedCurves![0].yKey).toBe(-1);
  });

  it("a re-import that changed the columns re-finds the curves by label (review finding 4)", async () => {
    const ds = useApp.getState().datasets.find((d) => d.id === "a")!;
    const newData = { ...ds.data, labels: ["R", "New", "Q"], values: [[100, 0, 10], [200, 0, 20]] };
    applyReimportMerge(useApp.setState, useApp.getState, ds, {
      newData, freshRaw: newData, shapeChanged: true, columnsChanged: true, viewReset: null,
      reshape: await import("../lib/figureDocumentReimport"),
    });
    // Q (1) -> 2; the X R (2) -> 0, its Y P (0) is gone -> empty.
    expect(g().linkedCurves).toEqual([{ datasetId: "a", xKey: null, yKey: 2 }, { datasetId: "a", xKey: 0, yKey: -1 }]);
  });
});
