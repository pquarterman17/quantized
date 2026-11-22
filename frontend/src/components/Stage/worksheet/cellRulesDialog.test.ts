// The Conditional Format form: it reads back into rules, seeds from a column's
// current rules, and refuses (applies nothing) a form it cannot read.

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import type { CellRule } from "../../../lib/worksheetRulesModel";
import { useApp } from "../../../store/useApp";
import { cellRulesItems, conditionalFormatDialog, ruleFields, rulesFromParams } from "./cellRulesDialog";

const ask = vi.hoisted(() => vi.fn());
vi.mock("../../overlays/ParamDialog", () => ({ askParams: ask }));

const blank = { op0: "(none)", a0: 0, b0: 0, tone0: "Red", op1: "(none)", a1: 0, b1: 0, tone1: "Amber", scale: "(none)", low: "Series 6", mid: "Amber", high: "Red" };
const sheet: Dataset = { id: "d", name: "d", data: { time: [1], values: [[1, 2]], labels: ["A", "B"], units: ["", ""], metadata: {} } };

beforeEach(() => {
  ask.mockReset();
  useApp.setState({ datasets: [{ ...sheet }], activeId: "d", history: [], future: [], status: "" });
});

describe("rulesFromParams", () => {
  it("reads each condition, the scale kinds, and an empty form as no rules", () => {
    expect(rulesFromParams(blank)).toEqual({ rules: [] });
    const out = rulesFromParams({ ...blank, op0: "greater than", a0: 5, op1: "between", a1: 1, b1: 2, tone1: "Green", scale: "3-colour" });
    expect(out).toEqual({
      rules: [
        { kind: "value", op: ">", a: 5, tone: "danger" },
        { kind: "value", op: "between", a: 1, b: 2, tone: "ok" },
        { kind: "scale", low: "series-6", mid: "warn", high: "danger" },
      ],
    });
    expect(rulesFromParams({ ...blank, op0: "is NaN or empty", scale: "2-colour" })).toEqual({
      rules: [{ kind: "value", op: "nan", tone: "danger" }, { kind: "scale", low: "series-6", high: "danger" }],
    });
  });

  it("refuses a reversed between and a non-number", () => {
    expect(rulesFromParams({ ...blank, op1: "between", a1: 5, b1: 1 })).toMatchObject({ error: expect.stringContaining("Rule 2") });
    expect(rulesFromParams({ ...blank, op0: "less than", a0: Number.NaN })).toMatchObject({ error: expect.stringContaining("Rule 1") });
  });
});

describe("ruleFields", () => {
  it("seeds the form from the column's current rules", () => {
    const current: CellRule[] = [{ kind: "value", op: "<", a: 3, tone: "ok" }, { kind: "scale", low: "ok", high: "danger" }];
    const f = Object.fromEntries(ruleFields(current).map((x) => [x.key, x.default]));
    expect(f).toMatchObject({ op0: "less than", a0: 3, tone0: "Green", op1: "(none)", scale: "2-colour", low: "Green", high: "Red" });
  });
});

describe("conditionalFormatDialog", () => {
  it("applies the form as one undo step, and (none) everywhere clears", async () => {
    ask.mockResolvedValueOnce({ ...blank, op0: "greater than", a0: 1 });
    await conditionalFormatDialog(useApp.getState().datasets[0], [1]);
    expect(useApp.getState().datasets[0].cellRules).toEqual({ 1: [{ kind: "value", op: ">", a: 1, tone: "danger" }] });
    ask.mockResolvedValueOnce({ ...blank });
    await conditionalFormatDialog(useApp.getState().datasets[0], [1]);
    expect(useApp.getState().datasets[0].cellRules).toBeUndefined();
  });

  it("cancel and an unreadable form change nothing", async () => {
    ask.mockResolvedValueOnce(null);
    await conditionalFormatDialog(useApp.getState().datasets[0], [0]);
    ask.mockResolvedValueOnce({ ...blank, op0: "between", a0: 9, b0: 1 });
    await conditionalFormatDialog(useApp.getState().datasets[0], [0]);
    expect(useApp.getState().datasets[0].cellRules).toBeUndefined();
    expect(useApp.getState().status).toMatch(/not applied/);
  });
});

describe("cellRulesItems", () => {
  it("offers the items for value columns only, Clear disabled until a rule exists", () => {
    expect(cellRulesItems(sheet, [-1])).toEqual([]);
    const items = cellRulesItems(sheet, [-1, 0]).filter((i) => "label" in i);
    expect(items.map((i) => ("label" in i ? i.label : ""))).toEqual(["Conditional format…", "Clear conditional format"]);
    expect(items[1]).toMatchObject({ disabled: true });
    const ruled = { ...sheet, cellRules: { 0: [{ kind: "scale", low: "ok", high: "danger" } as CellRule] } };
    expect(cellRulesItems(ruled, [0]).filter((i) => "label" in i)[1]).toMatchObject({ disabled: false });
  });
});
