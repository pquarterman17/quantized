// Origin's worksheet column commands (worksheet audit #12): Insert, Add New
// Column, Delete and Move had no UI or store action at all, and the Long Name
// / Units / Comments header rows could not be edited. Each is ONE undo step
// that keeps every by-index reference on the same column — this sheet's
// formulas and Set As designations, and another sheet's sheet() read through
// the shared column-shift guard (columnRemovalRefsPatch).

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs"; // registers sheet() & co. (lib/formulaExt.ts)
import type { Dataset } from "../lib/types";
import { useApp } from "./useApp";
import {
  deleteColumns,
  editColumnFormula,
  insertColumn,
  moveColumn,
  setColumnFormat,
  setColumnHeader,
} from "./worksheetColumns";

const book = (): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [1, 2, 3],
    // A, B, then the computed C = A + B
    values: [
      [10, 100, 110],
      [20, 200, 220],
      [30, 300, 330],
    ],
    labels: ["Volt", "Amp", "Sum"],
    units: ["V", "A", ""],
    metadata: {
      label_rows: [{ index: 0, role: "label", x: "", cells: ["v-note", "a-note"] }],
      default_value_channels: [1],
    },
  },
  formulas: [{ name: "Sum", expr: "A + B", deps: ["A", "B"] }],
  columnDesignations: { 1: "Y-error" },
});

const st = () => useApp.getState();
const ds = (id = "b") => st().datasets.find((d) => d.id === id)!;
const col = (label: string, id = "b") => ds(id).data.values.map((r) => r[ds(id).data.labels.indexOf(label)]);

beforeEach(() => {
  useApp.setState({
    datasets: [book()],
    activeId: "b",
    history: [],
    future: [],
    status: "",
    macroRecording: false,
    macroSteps: [],
  });
});

describe("Insert / Add New Column", () => {
  it("inserts a blank base column; the formula's letters follow, values and designations stay put", () => {
    expect(insertColumn("b", 0)).toBe(0);
    expect(ds().data.labels).toEqual(["A", "Volt", "Amp", "Sum"]);
    expect(col("A")).toEqual([NaN, NaN, NaN]);
    expect(ds().formulas?.[0].expr).toBe("B + C");
    expect(col("Sum")).toEqual([110, 220, 330]);
    expect(ds().columnDesignations).toEqual({ 2: "Y-error" });
    const meta = ds().data.metadata as { label_rows: { cells: string[] }[]; default_value_channels: number[] };
    expect(meta.label_rows[0].cells).toEqual(["", "v-note", "a-note"]);
    expect(meta.default_value_channels).toEqual([2]);
    expect(st().history.map((h) => h.label)).toEqual(["insert column"]);
    st().undo();
    expect(ds().data.labels).toEqual(["Volt", "Amp", "Sum"]);
    expect(ds().formulas?.[0].expr).toBe("A + B");
  });

  it("Add New Column lands after the base columns, never among the computed ones", () => {
    insertColumn("b", 99);
    expect(ds().data.labels).toEqual(["Volt", "Amp", "C", "Sum"]);
    expect(ds().formulas?.[0].expr).toBe("A + B");
  });

  it("records a macro step, like the sibling row commands do (worksheet audit follow-up)", () => {
    useApp.setState({ macroRecording: true });
    insertColumn("b", 0);
    const codes = st().macroSteps.map((s) => s.code);
    expect(codes).toEqual(["qz.insertColumn(\"Book1\", 0)"]);
  });
});

describe("Delete Column", () => {
  it("a deleted input turns the formula into an explicit error, never a silent re-point", () => {
    deleteColumns("b", [0]);
    expect(ds().data.labels).toEqual(["Amp", "Sum"]);
    expect(ds().formulaErrors?.Sum).toMatch(/references removed column A/);
    expect(ds().columnDesignations).toEqual({ 0: "Y-error" });
    st().undo();
    expect(col("Sum")).toEqual([110, 220, 330]);
  });

  it("deletes several columns (base and computed) as one undo step; X is refused", () => {
    deleteColumns("b", [2, 1]);
    expect(ds().data.labels).toEqual(["Volt"]);
    expect(ds().formulas).toBeUndefined();
    expect(st().history).toHaveLength(1);
    deleteColumns("b", [-1]);
    expect(st().status).toMatch(/X column can't be deleted/);
    expect(st().history).toHaveLength(1);
  });

  it("records a macro step for the deleted columns (worksheet audit follow-up)", () => {
    useApp.setState({ macroRecording: true });
    deleteColumns("b", [2, 1]);
    const codes = st().macroSteps.map((s) => s.code);
    expect(codes).toEqual(["qz.deleteColumns(\"Book1\", [2, 1])"]);
  });

  it("another worksheet's sheet() read follows the shift, and reading the deleted column is an error", () => {
    const reader: Dataset = {
      id: "r",
      name: "Reader",
      data: { time: [1, 2, 3], values: [[0], [0], [0]], labels: ["Amps"], units: [""], metadata: {} },
    };
    useApp.setState({ datasets: [book(), reader] });
    expect(st().addFormula("r", "AmpCopy", 'sheet("Book1", B)')).toBe(true);
    expect(col("AmpCopy", "r")).toEqual([100, 200, 300]);
    deleteColumns("b", [0]); // Amp moves from B to A
    expect(ds("r").formulas?.[0].expr).toMatch(/sheet\("Book1", A\)/);
    expect(col("AmpCopy", "r")).toEqual([100, 200, 300]);
  });
});

describe("Move Column", () => {
  it("moves a base column; formulas and designations follow it, one undo step", () => {
    moveColumn("b", 0, 1);
    expect(ds().data.labels).toEqual(["Amp", "Volt", "Sum"]);
    expect(ds().data.units).toEqual(["A", "V", ""]);
    expect(ds().formulas?.[0].expr).toBe("B + A");
    expect(col("Sum")).toEqual([110, 220, 330]);
    expect(ds().columnDesignations).toEqual({ 0: "Y-error" });
    st().undo();
    expect(ds().data.labels).toEqual(["Volt", "Amp", "Sum"]);
  });

  it("refuses X and computed columns, and a no-op move records nothing", () => {
    moveColumn("b", 2, 0);
    expect(st().status).toMatch(/computed column/);
    moveColumn("b", 0, 0);
    expect(st().history).toEqual([]);
  });

  it("records a macro step, like the sibling row commands do (worksheet audit follow-up)", () => {
    useApp.setState({ macroRecording: true });
    moveColumn("b", 0, 1);
    const codes = st().macroSteps.map((s) => s.code);
    expect(codes).toEqual(["qz.moveColumn(\"Book1\", 0, 1)"]);
  });

  it("a refused or no-op move records no macro step", () => {
    useApp.setState({ macroRecording: true });
    moveColumn("b", 2, 0); // refused: computed column
    moveColumn("b", 0, 0); // no-op
    expect(st().macroSteps).toEqual([]);
  });
});

describe("header rows and display format", () => {
  it("edits Long Name, Units and Comments in place (X too), one undo step each", () => {
    setColumnHeader("b", 0, { label: "Voltage", unit: "mV", comment: "probe 1" });
    expect(ds().data.labels[0]).toBe("Voltage");
    expect(ds().data.units[0]).toBe("mV");
    expect(ds().columnProps).toEqual({ 0: { comment: "probe 1" } });
    setColumnHeader("b", -1, { label: "Time", unit: "s" });
    expect(ds().data.metadata.x_column_name).toBe("Time");
    expect(ds().data.metadata.x_column_unit).toBe("s");
    st().undo();
    st().undo();
    expect(ds().data.labels[0]).toBe("Volt");
    expect(ds().columnProps).toBeUndefined();
  });

  it("a computed column's name and unit go to its formula; Set Column Values edits the formula", () => {
    setColumnHeader("b", 2, { label: "Total", unit: "W" });
    expect(ds().formulas?.[0]).toMatchObject({ name: "Total", unit: "W" });
    editColumnFormula("b", 2, "Total", "A * 2");
    expect(col("Total")).toEqual([20, 40, 60]);
    expect(st().status).toMatch(/updated the formula/);
  });

  it("a display format is stored per column and follows the column when it moves", () => {
    setColumnFormat("b", [1], { kind: "sci", digits: 2 });
    expect(ds().columnProps).toEqual({ 1: { format: { kind: "sci", digits: 2 } } });
    moveColumn("b", 1, 0);
    expect(ds().columnProps).toEqual({ 0: { format: { kind: "sci", digits: 2 } } });
    setColumnFormat("b", [0], null);
    expect(ds().columnProps).toBeUndefined();
  });
});
