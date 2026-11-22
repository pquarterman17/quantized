// Conditional formatting commands: one undo step, view-only, per sheet, and the
// rules survive save and reopen (a workspace holding them is a v7 file).

import { beforeEach, describe, expect, it } from "vitest";

import "../lib/formulaRefs";
import type { Dataset } from "../lib/types";
import { parseWorkspace } from "../lib/workspace";
import { serializeWorkspace } from "../lib/workspaceSerialize";
import type { CellRule } from "../lib/worksheetRulesModel";
import { useApp } from "./useApp";
import { deleteColumns } from "./worksheetColumns";
import { setColumnRules } from "./worksheetRules";

const sheet = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [1, 2], values: [[10, 20, 30], [11, 21, 31]], labels: ["A", "B", "C"], units: ["", "", ""], metadata: {} },
});
const st = () => useApp.getState();
const ds = (id = "b") => st().datasets.find((d) => d.id === id)!;
const rule: CellRule = { kind: "value", op: ">", a: 15, tone: "danger" };
const scale: CellRule = { kind: "scale", low: "ok", mid: "warn", high: "danger" };

beforeEach(() => {
  useApp.setState({ datasets: [sheet("b"), sheet("other")], activeId: "b", history: [], future: [], status: "", macroRecording: false, macroSteps: [] });
});

describe("setColumnRules", () => {
  it("sets rules view-only on the chosen columns of one sheet", () => {
    const data = ds().data;
    expect(setColumnRules("b", [1, 2], [rule, scale])).toBe(2);
    expect(ds().cellRules).toEqual({ 1: [rule, scale], 2: [rule, scale] });
    expect(ds().data).toBe(data);
    expect(ds("other").cellRules).toBeUndefined();
    expect(st().status).toMatch(/formatted 2 columns/);
  });

  it("is ONE undo step", () => {
    setColumnRules("b", [0, 1], [rule]);
    st().undo();
    expect(ds().cellRules).toBeUndefined();
  });

  it("clears with null and drops the field when nothing is left", () => {
    setColumnRules("b", [0, 1], [rule]);
    setColumnRules("b", [0], null);
    expect(Object.keys(ds().cellRules!)).toEqual(["1"]);
    setColumnRules("b", [1], null);
    expect(ds().cellRules).toBeUndefined();
  });

  it("refuses: unknown sheet, out-of-range columns, invalid rules, and an unchanged result is no undo step", () => {
    expect(setColumnRules("nope", [0], [rule])).toBe(0);
    expect(setColumnRules("b", [-1, 3, 1.5], [rule])).toBe(0);
    expect(setColumnRules("b", [0], [{ kind: "value", op: "between", a: 5, b: 1, tone: "ok" }])).toBe(0);
    expect(setColumnRules("b", [0], null)).toBe(0);
    setColumnRules("b", [0], [rule]);
    const n = st().history.length;
    expect(setColumnRules("b", [0], [rule])).toBe(0);
    expect(st().history.length).toBe(n);
    expect(ds().cellRules).toEqual({ 0: [rule] });
  });

  it("does not alias the caller's rules", () => {
    const mine: CellRule[] = [{ ...rule }];
    setColumnRules("b", [0], mine);
    (mine[0] as { a: number }).a = 99;
    expect((ds().cellRules![0][0] as { a: number }).a).toBe(15);
  });

  it("follows column deletion", () => {
    setColumnRules("b", [1, 2], [rule]);
    deleteColumns("b", [0]);
    expect(Object.keys(ds().cellRules!)).toEqual(["0", "1"]);
  });
});

describe("save and reopen", () => {
  it("round-trips, and the file is v7 so an older build refuses it instead of dropping the rules", () => {
    setColumnRules("b", [1], [rule, scale]);
    const text = serializeWorkspace({ datasets: [ds()] });
    expect((JSON.parse(text) as { version: number }).version).toBe(7);
    expect(parseWorkspace(text).datasets[0].cellRules).toEqual({ 1: [rule, scale] });
  });

  it("a sheet without rules writes no field and keeps its old version", () => {
    const text = serializeWorkspace({ datasets: [ds()] });
    expect(text).not.toContain("cellRules");
    expect((JSON.parse(text) as { version: number }).version).toBeLessThan(6);
  });

  it("a hand-edited file loses only the invalid rules and out-of-range columns", () => {
    setColumnRules("b", [1], [rule]);
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds()] })) as { datasets: { cellRules: Record<string, unknown[]> }[] };
    doc.datasets[0].cellRules = { 1: [{ kind: "value", op: ">", a: 1, tone: "#f00" }, rule], 7: [rule] };
    expect(parseWorkspace(JSON.stringify(doc)).datasets[0].cellRules).toEqual({ 1: [rule] });
  });
});
