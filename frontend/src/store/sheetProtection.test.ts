// Sheet protection through the REAL store: one test per refused edit path, each asserting the
// worksheet is untouched and the reason reaches the status line, plus what stays allowed (viewing,
// excluding rows for analysis, recalculation of a formula column from its source) and Unprotect.

import { beforeEach, describe, expect, it } from "vitest";

import { loadFormulaExtension } from "../lib/formulaExt";
import { PROTECTED_NOTICE } from "../lib/sheetProtection";
import type { Dataset } from "../lib/types";
import { setCellNote } from "./cellNotes";
import { addComputedError } from "./computedErrorRun";
import { addDerivedColumn } from "./derivedColumnRun";
import { createMirror } from "./mirrorColumn";
import { deleteRowsAt, insertRowsAbove, moveWorksheetRows } from "./moveRows";
import { useRecode } from "./recode";
import { applySetColumnValues } from "./setColumnValuesRun";
import { setSheetProtected } from "./sheetProtection";
import { sortWorksheetRows } from "./sortRows";
import { useApp } from "./useApp";
import { deleteColumns, insertColumn, moveColumn, setColumnHeader } from "./worksheetColumns";
import { fillColumns, setRowCount } from "./worksheetFill";
import { pasteGrowing } from "./worksheetGrow";

const st = () => useApp.getState();
const sheet = (): Dataset => st().datasets.find((d) => d.id === "w")!;

const mk = (id: string, name: string, over: Partial<Dataset> = {}): Dataset => ({
  id,
  name,
  data: { time: [0, 1, 2], values: [[3, 30], [1, 10], [2, 20]], labels: ["A", "B"], units: ["", ""], metadata: {} },
  ...over,
});

beforeEach(async () => {
  await loadFormulaExtension();
  useApp.setState({
    datasets: [mk("w", "Run 1"), mk("o", "Other")],
    activeId: "w",
    recalcMode: "auto",
    staleDatasets: [],
    staleFits: [],
    history: [],
    future: [],
    status: "",
    statusDanger: null,
    macroRecording: false,
    plotWindows: [],
    layoutMode: "classic",
  } as Partial<ReturnType<typeof useApp.getState>>);
  st().addFormula("w", "C", "A + B");
  useApp.setState({ history: [], future: [] });
  setSheetProtected("w", true);
  useApp.setState({ status: "" });
});

/** The worksheet and its undo stack are exactly as before, and the status says why. */
function expectRefused(before: Dataset): void {
  expect(sheet()).toEqual(before);
  expect(st().history).toHaveLength(1); // only the Protect step
  expect(st().status).toMatch(/protected/i);
  useApp.setState({ status: "" });
}

describe("a protected sheet refuses every edit path, with the reason in the status line", () => {
  it("cell edit, block write and a categorical cell", () => {
    const before = sheet();
    st().setCellValue("w", 0, 0, 99);
    expectRefused(before);
    st().setCellBlock("w", [{ row: 0, col: 0, value: 5 }], "paste");
    expectRefused(before);
    st().setCategoricalCell("w", 0, 0, "x");
    expectRefused(before);
  });

  it("paste, including one that would grow rows and columns", () => {
    const before = sheet();
    pasteGrowing("w", "1\t2\n3\t4\n5\t6\n7\t8\n", 0, 0, [0, 1, 2], true);
    expectRefused(before);
  });

  it("fill and Set Row Count", () => {
    const before = sheet();
    fillColumns("w", [0], { kind: "linear", start: 1, step: 1 });
    expectRefused(before);
    setRowCount("w", 10);
    expectRefused(before);
  });

  it("sort and move rows", () => {
    const before = sheet();
    sortWorksheetRows("w", 0, 1);
    expectRefused(before);
    expect(moveWorksheetRows("w", [0], "down")).toBeNull();
    expectRefused(before);
  });

  it("insert and delete rows", () => {
    const before = sheet();
    insertRowsAbove("w", [1]);
    expect(sheet()).toEqual(before);
    deleteRowsAt("w", [1]);
    expect(sheet()).toEqual(before);
    expect(st().history).toHaveLength(1);
  });

  it("insert, delete and move columns, and a header edit", () => {
    const before = sheet();
    expect(insertColumn("w", 1)).toBeNull();
    expectRefused(before);
    deleteColumns("w", [0]);
    expectRefused(before);
    moveColumn("w", 0, 1);
    expectRefused(before);
    setColumnHeader("w", 0, { label: "Renamed", unit: "K" });
    expectRefused(before);
  });

  it("add, edit and remove a formula column", async () => {
    const before = sheet();
    expect(st().addFormula("w", "D", "A * 2")).toBe(false);
    expectRefused(before);
    expect(st().updateFormula("w", 0, { expr: "A - B" })).toBe(false);
    expectRefused(before);
    st().removeFormula("w", 0);
    expectRefused(before);
    const r = await addDerivedColumn("w", { name: "E", expr: "A / 2", propagate: false });
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/protected/i);
    expect(sheet()).toEqual(before);
    const e = await addComputedError("w", 0, "percent", 5);
    expect(e.ok).toBe(false);
    expect(e.ok === false && e.error).toMatch(/protected/i);
    expect(sheet()).toEqual(before);
  });

  it("Set Column Values, to a new column and to an existing one", async () => {
    const before = sheet();
    const r = await applySetColumnValues("w", { target: { kind: "new" }, name: "F", expr: "A + 1", range: { from: 1, to: 3 } });
    expect(r.ok === false && r.error).toMatch(/protected/i);
    const r2 = await applySetColumnValues("w", { target: { kind: "column", col: 0 }, name: "", expr: "A + 1", range: { from: 1, to: 3 } });
    expect(r2.ok === false && r2.error).toMatch(/protected/i);
    expect(sheet()).toEqual(before);
  });

  it("recode", () => {
    const cat = mk("c", "Cat", {
      data: { time: [0, 1], values: [[0], [1]], labels: ["G"], units: [""], metadata: {}, cat_levels: { 0: ["a", "b"] } },
      protectedSheet: true,
    });
    useApp.setState({ datasets: [sheet(), mk("o", "Other"), cat] });
    useRecode.getState().openRecode("c", 0);
    useRecode.getState().setGroup("ab", ["a", "b"]);
    expect(useRecode.getState().commitRecode()).toBeNull();
    expect(st().datasets.find((d) => d.id === "c")!.formulas).toBeUndefined();
    expect(st().status).toMatch(/protected/i);
  });

  it("mirror creation, a cell note and corrections", async () => {
    const before = sheet();
    createMirror("w", "o", 0);
    expectRefused(before);
    expect(setCellNote("w", 0, 0, "note")).toBe(false);
    expect(sheet()).toEqual(before);
    expect(await st().applyCorrections("w", { yOff: 1 })).toBe(false);
    expect(sheet()).toEqual(before);
  });

  it("re-import", async () => {
    useApp.setState({ datasets: [{ ...sheet(), source: { path: "C:/data/run1.dat" } as never }, mk("o", "Other")] });
    const before = sheet();
    await st().reimportDataset("w");
    expect(sheet()).toEqual(before);
    expect(st().history).toHaveLength(1);
  });
});

describe("what stays allowed", () => {
  it("a formula column of a protected sheet still recalculates when its source changes", async () => {
    useApp.setState({ datasets: [mk("w", "Run 1", { protectedSheet: true }), mk("o", "Other")] });
    // Linked before protecting: createMirror refuses a protected sheet, so build the link unprotected.
    setSheetProtected("w", false);
    createMirror("w", "o", 0);
    setSheetProtected("w", true);
    st().setRecalcMode("manual");
    st().setCellValue("o", 0, 0, 42);
    await st().recalcNow();
    const w = sheet();
    expect(w.data.values[0][w.data.labels.length - 1]).toBe(42);
  });

  it("excluding rows for analysis is not an edit of the sheet", () => {
    st().toggleRowExcluded("w", 0);
    expect(sheet().excludedRows).toEqual([0]);
    expect(sheet().data.values[0].slice(0, 2)).toEqual([3, 30]);
  });
});

describe("Unprotect is one click and one undo step", () => {
  it("unprotect makes the sheet editable again; Undo restores the lock", () => {
    setSheetProtected("w", false);
    expect(sheet().protectedSheet).toBeUndefined();
    st().setCellValue("w", 0, 0, 99);
    expect(sheet().data.values[0][0]).toBe(99);
    st().undo();
    st().undo();
    expect(sheet().protectedSheet).toBe(true);
    expect(sheet().data.values[0][0]).toBe(3);
  });

  it("the reason names the way out", () => {
    expect(PROTECTED_NOTICE).toMatch(/Unprotect sheet/);
  });
});
