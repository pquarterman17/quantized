// P2.5 box 4 — binding, preflight and the working copy of a recipe apply.

import { describe, expect, it } from "vitest";

import { makeStep } from "./pipeline";
import type { ExpectedColumn, RecipeExpectations } from "./recipeExpect";
import { conformData, conformFilter, defaultBindings, isIdentityBinding, needsWorkingCopy, preflightRecipe } from "./recipePreflight";
import type { DataStruct, Dataset } from "./types";

const COLS: ExpectedColumn[] = [
  { name: "T", unit: "K", required: false },
  { name: "M", unit: "emu", required: true },
];
const EXPECTS: RecipeExpectations = { columns: COLS, metadata: [["sample"]] };
const STACK = makeStep("transform", "Stack", "", { op: "stack", channels: [1], input: { id: "ex", name: "ex" }, inputIsTarget: true, outputs: [{ id: "o1", key: "" }] });
const RECIPE = { steps: [STACK], expects: EXPECTS };

const data = (labels: string[], units: string[], meta: Record<string, unknown> = { sample: "S" }): DataStruct => ({
  time: [0, 1],
  values: [labels.map((_, i) => i + 1), labels.map((_, i) => 10 * (i + 1))],
  labels,
  units,
  metadata: meta,
});
const ds = (d: DataStruct, extra: Partial<Dataset> = {}): Dataset => ({ id: "t", name: "t.dat", data: d, ...extra });
const IDS = new Set(["t"]);

describe("defaultBindings", () => {
  it("binds by name, trimmed and case-insensitively, whatever the order", () => {
    expect(defaultBindings(COLS, data(["moment", "m ", "t"], ["", "emu", "K"]))).toEqual([2, 1]);
  });

  it("an unrequired position with no name match takes the same position, else a blank; a required one stays unbound", () => {
    expect(defaultBindings(COLS, data(["Temp", "Moment"], ["K", "emu"]))).toEqual([0, null]);
    // Position 0 is claimed by the name match for M, so T gets a blank.
    expect(defaultBindings(COLS, data(["M"], ["emu"]))).toEqual(["blank", 0]);
  });
});

describe("preflightRecipe", () => {
  it("passes a dataset laid out like the recording", () => {
    const pf = preflightRecipe(RECIPE, ds(data(["T", "M"], ["K", "emu"])), [0, 1], IDS, false);
    expect(pf).toEqual({ issues: [], blocked: false, unitMismatch: false });
  });

  it("refuses a missing required column, naming it", () => {
    const pf = preflightRecipe(RECIPE, ds(data(["T", "Moment"], ["K", "emu"])), [0, null], IDS, false);
    expect(pf.blocked).toBe(true);
    expect(pf.issues).toEqual([expect.objectContaining({ kind: "missing-column", blocking: true, text: expect.stringContaining("“M” (emu)") })]);
  });

  it("refuses a unit mismatch until it is acknowledged", () => {
    const d = ds(data(["T", "M"], ["K", "A m2"]));
    const pf = preflightRecipe(RECIPE, d, [0, 1], IDS, false);
    expect(pf.unitMismatch).toBe(true);
    expect(pf.issues[0]).toMatchObject({ kind: "unit-mismatch", blocking: true });
    expect(preflightRecipe(RECIPE, d, [0, 1], IDS, true).blocked).toBe(false);
  });

  it("refuses a missing metadata field, a blank required column and a recipe with no steps", () => {
    expect(preflightRecipe(RECIPE, ds(data(["T", "M"], ["K", "emu"], {})), [0, 1], IDS, false).issues[0].kind).toBe("missing-metadata");
    expect(preflightRecipe(RECIPE, ds(data(["T", "M"], ["K", "emu"])), [0, "blank"], IDS, false).issues[0].kind).toBe("blank-required");
    expect(preflightRecipe({ steps: [], expects: EXPECTS }, ds(data(["T", "M"], ["K", "emu"])), [0, 1], IDS, false).issues[0].kind).toBe("no-steps");
  });

  it("refuses a recorded second input that is not loaded, but not one an earlier step creates", () => {
    const join = makeStep("transform", "Join", "", { op: "join", leftKey: 0, rightKey: 0, mode: "inner", with: { id: "gone", name: "right.csv" } });
    const own = makeStep("transform", "Math", "", { op: "algebra", operation: "A-B", interp: "pchip", with: { id: "o1", name: "stacked" } });
    const pf = preflightRecipe({ steps: [STACK, own, join], expects: EXPECTS }, ds(data(["T", "M"], ["K", "emu"])), [0, 1], IDS, false);
    expect(pf.issues.map((i) => [i.kind, i.blocking])).toEqual([["missing-reference", true]]);
    expect(pf.issues[0].text).toContain("right.csv");
  });

  it("notes, without refusing, a step on a recorded dataset, a blank filler and applied corrections", () => {
    const other = makeStep("transform", "Math on X", "", { op: "algebra", operation: "A-B", interp: "pchip", with: { id: "t", name: "t" }, input: { id: "t", name: "t.dat" }, inputIsTarget: false });
    const pf = preflightRecipe({ steps: [other], expects: EXPECTS }, ds(data(["M"], ["emu"]), { corrections: { xOff: 1 } }), ["blank", 0], IDS, false);
    expect(pf.blocked).toBe(false);
    expect(pf.issues.map((i) => i.kind)).toEqual(["blank-column", "recorded-input", "corrections"]);
  });

  it("a stale binding (the target lost columns) reads as unbound", () => {
    expect(preflightRecipe(RECIPE, ds(data(["T"], ["K"])), [0, 5], IDS, false).issues[0].kind).toBe("missing-column");
  });
});

describe("conformData — the working copy", () => {
  const src: DataStruct = {
    time: [0, 1],
    values: [[1, 2, 3], [4, 5, 6]],
    labels: ["Moment", "Temp", "Extra"],
    units: ["emu", "K", "V"],
    metadata: { origin_column_names: ["A", "B", "C"], sample: "S" },
    cat_levels: { 2: ["lo", "hi"] },
  };

  it("puts the bound columns at the recorded positions, then every other column in order", () => {
    const c = conformData(src, COLS, [1, 0]);
    expect(c.data.labels).toEqual(["Temp", "Moment", "Extra"]);
    expect(c.data.units).toEqual(["K", "emu", "V"]);
    expect(c.data.values).toEqual([[2, 1, 3], [5, 4, 6]]);
    expect(c.data.cat_levels).toEqual({ 2: ["lo", "hi"] });
    expect(c.data.metadata.origin_column_names).toBeUndefined(); // positional, and the order moved
    expect(c.data.metadata.sample).toBe("S");
    expect(src.values[0]).toEqual([1, 2, 3]); // the source is untouched
  });

  it("a blank binding is a NaN column named after the expected column", () => {
    const c = conformData(src, COLS, ["blank", 0]);
    expect(c.data.labels).toEqual(["T", "Moment", "Temp", "Extra"]);
    expect(c.data.units[0]).toBe("K");
    expect(c.data.values[0][0]).toBeNaN();
    expect(c.data.cat_levels).toEqual({ 3: ["lo", "hi"] });
  });

  it("the identity keeps the layout (and the Origin name list)", () => {
    const c = conformData(src, [{ name: "Moment", unit: "emu", required: true }], [0]);
    expect(c.data.labels).toEqual(src.labels);
    expect(c.data.metadata.origin_column_names).toEqual(["A", "B", "C"]);
  });

  it("carries the row filter onto the moved columns", () => {
    const c = conformData(src, COLS, [1, 0]);
    expect(conformFilter([{ col: 0, kind: "range", min: 0, max: 2 }, { col: 2, kind: "set", values: [1] }], c)).toEqual([
      { col: 1, kind: "range", min: 0, max: 2 },
      { col: 2, kind: "set", values: [1] },
    ]);
  });
});

describe("needsWorkingCopy", () => {
  it("only for a rebinding or a step that would edit the input in place", () => {
    expect(isIdentityBinding([0, 1])).toBe(true);
    expect(needsWorkingCopy([STACK], [0, 1])).toBe(false);
    expect(needsWorkingCopy([STACK], [1, 0])).toBe(true);
    expect(needsWorkingCopy([makeStep("expression", "d", "", { name: "d", expr: "A" }), STACK], [0, 1])).toBe(true);
  });
});
