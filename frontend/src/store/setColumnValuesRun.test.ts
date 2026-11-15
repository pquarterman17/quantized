// Gap audit 4: Set Column Values (G3) writing into an existing data column, an
// existing computed column or a new one, over a row range, each ONE undo step;
// and the worksheet-from-scratch commands (G12) Fill Column With and Set Row
// Count. Before this, a formula could only ever append a NEW computed column
// (no row range, no overwrite of e.g. an imported Oe column into T), and a
// blank book could not be filled with a sequence or resized.

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs"; // registers the lazy formula extension
import { randomSeries } from "../lib/formulaMath";
import type { Dataset } from "../lib/types";
import {
  evaluateFormula,
  parseRange,
  unwrapRange,
  wrapRange,
} from "../lib/setColumnValues";
import { applySetColumnValues } from "./setColumnValuesRun";
import { useApp } from "./useApp";
import { fillColumns, setRowCount } from "./worksheetFill";

const book = (): Dataset => ({
  id: "b",
  name: "Book1",
  data: {
    time: [1, 2, 3, 4],
    // A (field, Oe), B, then the computed C = A + B
    values: [
      [10, 1, 11],
      [20, 2, 22],
      [30, 3, 33],
      [40, 4, 44],
    ],
    labels: ["Field", "B", "Sum"],
    units: ["Oe", "", ""],
    metadata: {},
  },
  formulas: [{ name: "Sum", expr: "A + B", deps: ["A", "B"] }],
});

const st = () => useApp.getState();
const ds = () => st().datasets.find((d) => d.id === "b")!;
const col = (c: number) => ds().data.values.map((r) => r[c]);
const all = { from: 1, to: 4 };

beforeEach(() => {
  useApp.setState({ datasets: [book()], activeId: "b", history: [], future: [], status: "" });
});

describe("Set Column Values into an existing data column", () => {
  it("overwrites it in place (Oe → T), recalculates its dependents, one undo step", async () => {
    const r = await applySetColumnValues("b", { target: { kind: "column", col: 0 }, name: "", expr: "A * 1e-4", range: all });
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/values only/) });
    expect(col(0)).toEqual([0.001, 0.002, 0.003, 0.004]);
    expect(col(2)).toEqual([1.001, 2.002, 3.003, 4.004]); // C = A + B followed
    expect(ds().formulas).toHaveLength(1); // no formula invented on a data column
    st().undo();
    expect(col(0)).toEqual([10, 20, 30, 40]);
  });

  it("writes only the rows of the range", async () => {
    await applySetColumnValues("b", { target: { kind: "column", col: 1 }, name: "", expr: "row() * 100", range: { from: 2, to: 3 } });
    expect(col(1)).toEqual([1, 200, 300, 4]);
  });

  it("fails closed on a missing column: nothing is written", async () => {
    const r = await applySetColumnValues("b", { target: { kind: "column", col: 1 }, name: "", expr: "Q * 2", range: all });
    expect(r).toEqual({ ok: false, error: 'unknown variable "Q"' });
    expect(col(1)).toEqual([1, 2, 3, 4]);
    expect(st().history).toHaveLength(0);
  });

  it("writes X too", async () => {
    await applySetColumnValues("b", { target: { kind: "column", col: -1 }, name: "", expr: "x * 2", range: all });
    expect(ds().data.time).toEqual([2, 4, 6, 8]);
  });
});

describe("Set Column Values into a computed or new column keeps the formula", () => {
  it("edits a computed column's formula, range included, readable back", async () => {
    const r = await applySetColumnValues("b", { target: { kind: "column", col: 2 }, name: "Sum", expr: "A - B", range: { from: 2, to: 4 } });
    expect(r.ok).toBe(true);
    expect(ds().formulas?.[0].expr).toBe("if(row() >= 2 and row() <= 4, A - B, nan)");
    expect(col(2)).toEqual([NaN, 18, 27, 36]);
    expect(unwrapRange(ds().formulas![0].expr)).toEqual({ expr: "A - B", from: "2", to: "4" });
    // ...and it recalculates when an input changes.
    st().setCellValue("b", 3, 0, 100);
    expect(col(2)[3]).toBe(96);
  });

  it("adds a new computed column with the formula (and its unit)", async () => {
    const r = await applySetColumnValues("b", { target: { kind: "new" }, name: "T", expr: "round(A * 1e-4, 4)", range: all });
    expect(r.ok).toBe(true);
    expect(ds().formulas?.[1]).toMatchObject({ name: "T", expr: "round(A * 1e-4, 4)" });
    expect(col(3)).toEqual([0.001, 0.002, 0.003, 0.004]);
    expect(ds().data.units[3]).toBe("Oe");
  });

  it("refuses a categorical target", async () => {
    useApp.setState({ datasets: [{ ...book(), data: { ...book().data, cat_levels: { 1: ["a", "b", "c", "d"] } } }] });
    const r = await applySetColumnValues("b", { target: { kind: "column", col: 1 }, name: "", expr: "1", range: all });
    expect(r).toMatchObject({ ok: false, error: expect.stringMatching(/categorical/) });
  });
});

describe("the dialog model", () => {
  it("row range: blank is the whole sheet; out of range or backwards is an error", () => {
    expect(parseRange("", "", 4)).toEqual({ from: 1, to: 4 });
    expect(parseRange("0", "", 4)).toEqual({ error: "From row must be between 1 and 4" });
    expect(parseRange("3", "2", 4)).toEqual({ error: "To must not be before From" });
    expect(parseRange("1.5", "", 4)).toEqual({ error: "From row must be a whole number" });
    expect(wrapRange("A", { from: 1, to: 4 }, 4)).toBe("A");
  });

  it("the preview evaluates exactly what the apply writes", () => {
    expect(evaluateFormula(ds(), st().datasets, "A / 10")).toEqual({ values: [1, 2, 3, 4] });
    expect(evaluateFormula(ds(), st().datasets, "Field * 2")).toEqual({ values: [20, 40, 60, 80] }); // long name
    expect(evaluateFormula(ds(), st().datasets, "erf(")).toMatchObject({ error: expect.any(String) });
  });
});

describe("Fill column with / Set row count", () => {
  it("fills row numbers, a linear sequence, and seeded random numbers — one undo step each", () => {
    fillColumns("b", [-1], { kind: "rownum" });
    expect(ds().data.time).toEqual([1, 2, 3, 4]);
    fillColumns("b", [1], { kind: "linear", start: 0.5, step: 0.25 });
    expect(col(1)).toEqual([0.5, 0.75, 1, 1.25]);
    fillColumns("b", [1], { kind: "uniform", seed: 3, low: 0, high: 10 });
    expect(col(1)).toEqual(randomSeries("uniform", 3, 4).map((u) => 10 * u));
    fillColumns("b", [1], { kind: "normal", seed: 3, mean: 1, sd: 2 });
    expect(col(1)).toEqual(randomSeries("normal", 3, 4).map((g) => 1 + 2 * g));
    st().undo();
    expect(col(1)).toEqual(randomSeries("uniform", 3, 4).map((u) => 10 * u));
  });

  it("refuses a computed column and says why", () => {
    fillColumns("b", [2], { kind: "rownum" });
    expect(col(2)).toEqual([11, 22, 33, 44]);
    expect(st().status).toMatch(/only data columns/);
  });

  it("set row count grows with blank rows and cuts back, one undo step each", () => {
    setRowCount("b", 6);
    expect(ds().data.time).toEqual([1, 2, 3, 4, NaN, NaN]);
    expect(col(2)).toHaveLength(6);
    setRowCount("b", 2);
    expect(ds().data.time).toEqual([1, 2]);
    expect(col(2)).toEqual([11, 22]);
    st().undo();
    expect(ds().data.time).toHaveLength(6);
    st().undo();
    expect(ds().data.time).toEqual([1, 2, 3, 4]);
    setRowCount("b", 2.5);
    expect(st().status).toMatch(/whole number/);
  });
});
