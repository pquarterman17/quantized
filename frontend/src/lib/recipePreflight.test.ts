// P2.5 box 4 — binding, preflight and the working copy of a recipe apply.

import { describe, expect, it } from "vitest";

import { makeStep } from "./pipeline";
import type { ExpectedColumn, RecipeExpectations } from "./recipeExpect";
import { conformData, conformErrorRoles, conformFilter, defaultBindings, isIdentityBinding, needsWorkingCopy, preflightRecipe } from "./recipePreflight";
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

  it("refuses a recipe that derives nothing (fit-only) and notes a fit that is not kept", () => {
    const fit = makeStep("fit", "Fit", "", { model: "Linear", yKey: 1, xKey: null });
    const d = ds(data(["T", "M"], ["K", "emu"]));
    expect(preflightRecipe({ steps: [fit], expects: EXPECTS }, d, [0, 1], IDS, false).issues).toEqual([
      expect.objectContaining({ kind: "no-output", blocking: true }),
    ]);
    const pf = preflightRecipe({ steps: [STACK, fit], expects: EXPECTS }, d, [0, 1], IDS, false);
    expect(pf.issues.map((i) => [i.kind, i.blocking])).toEqual([["fit-not-kept", false]]);
  });

  it("refuses a recipe that corrects a dataset that already has corrections (they would stack)", () => {
    const corr = makeStep("correction", "Corrections", "", { params: { yOff: 5 } });
    const d = ds(data(["T", "M"], ["K", "emu"]), { corrections: { yOff: 5 } });
    expect(preflightRecipe({ steps: [corr], expects: EXPECTS }, d, [0, 1], IDS, false).issues).toEqual([
      expect.objectContaining({ kind: "corrections-conflict", blocking: true }),
    ]);
  });

  it("refuses a correction whose recorded background dataset is not loaded", () => {
    const corr = makeStep("correction", "Corrections", "", { params: {}, bg: { datasetId: "bg", interp: "linear" } });
    const d = ds(data(["T", "M"], ["K", "emu"]));
    expect(preflightRecipe({ steps: [corr], expects: EXPECTS }, d, [0, 1], IDS, false).issues[0]).toMatchObject({ kind: "missing-reference", blocking: true });
    expect(preflightRecipe({ steps: [corr], expects: EXPECTS }, d, [0, 1], new Set(["t", "bg"]), false).blocked).toBe(false);
  });

  it("a stale binding (the target lost columns) reads as unbound", () => {
    expect(preflightRecipe(RECIPE, ds(data(["T"], ["K"])), [0, 5], IDS, false).issues[0].kind).toBe("missing-column");
  });

  it("catches a sims step's target missing its named reference column, instead of failing mid-replay (finding 6)", () => {
    const simsStep = makeStep("transform", "sims", "", { op: "sims", calibration: { method: "rate", timeUnit: "s" }, normalization: { reference: "Si" } });
    const expects: RecipeExpectations = {
      columns: [{ name: "B", unit: "c/s", required: false }, { name: "Si", unit: "c/s", required: true }],
      metadata: [],
    };
    const target = ds(data(["B"], ["c/s"])); // no "Si" column at all
    const bindings = defaultBindings(expects.columns, target.data);
    const pf = preflightRecipe({ steps: [simsStep], expects }, target, bindings, IDS, false);
    expect(pf.blocked).toBe(true);
    expect(pf.issues).toContainEqual(expect.objectContaining({ kind: "missing-column", blocking: true, text: expect.stringContaining("“Si”") }));
  });

  it("refuses a sims calibration (no stated override) onto a target whose x is not a time unit", () => {
    const simsStep = makeStep("transform", "sims", "", { op: "sims", calibration: { method: "rate" }, normalization: { reference: "Si" } });
    const expects: RecipeExpectations = {
      columns: [{ name: "B", unit: "c/s", required: false }, { name: "Si", unit: "c/s", required: true }],
      metadata: [],
      needsTimeUnitX: true,
    };
    const timeTarget = ds(data(["B", "Si"], ["c/s", "c/s"], { x_column_unit: "s" }));
    expect(preflightRecipe({ steps: [simsStep], expects }, timeTarget, [0, 1], IDS, false).issues.map((i) => i.kind)).not.toContain("not-time-unit");
    const depthTarget = ds(data(["B", "Si"], ["c/s", "c/s"], { x_column_unit: "nm" }));
    const pf = preflightRecipe({ steps: [simsStep], expects }, depthTarget, [0, 1], IDS, false);
    expect(pf.blocked).toBe(true);
    expect(pf.issues).toContainEqual(expect.objectContaining({ kind: "not-time-unit", blocking: true }));
  });

  it("refuses a direct SIMS scale on a different x unit even when unit mismatches are acknowledged", () => {
    const simsStep = makeStep("transform", "sims", "", { op: "sims", calibration: { method: "scale", scaleFactor: 0.001, inputUnit: "encoder counts" } });
    const expects: RecipeExpectations = { columns: [], metadata: [], scaleInputUnit: "encoder counts" };
    const matching = ds(data(["B"], ["c/s"], { x_column_unit: "encoder counts" }));
    expect(preflightRecipe({ steps: [simsStep], expects }, matching, [], IDS, false).blocked).toBe(false);
    const wrong = ds(data(["B"], ["c/s"], { x_column_unit: "nm" }));
    const pf = preflightRecipe({ steps: [simsStep], expects }, wrong, [], IDS, true);
    expect(pf.blocked).toBe(true);
    expect(pf.unitMismatch).toBe(false);
    expect(pf.issues).toContainEqual(expect.objectContaining({ kind: "x-unit-mismatch", blocking: true, text: expect.stringContaining("encoder counts") }));
  });

  it("refuses an X-sensitive Signal Processing recipe on a different or unknown X unit", () => {
    const expects: RecipeExpectations = { columns: [], metadata: [], signalInputUnit: "s" };
    const step = makeStep("transform", "Derivative", "", { op: "signal" });
    const matching = ds(data(["A"], ["V"], { xUnit: "s" }));
    expect(preflightRecipe({ steps: [step], expects }, matching, [], IDS, false).blocked).toBe(false);
    for (const metadata of [{ xUnit: "ms" }, {}]) {
      const result = preflightRecipe({ steps: [step], expects }, ds(data(["A"], ["V"], metadata)), [], IDS, true);
      expect(result.issues).toContainEqual(expect.objectContaining({ kind: "x-unit-mismatch", blocking: true }));
    }
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

  it("drops the target's extra columns when the recipe's own steps append a column (finding #1)", () => {
    const expr = makeStep("expression", "Add M2", "", { name: "M2", expr: "B*2" });
    const c = conformData(src, COLS, [1, 0], [expr, STACK]);
    // Only the recorded [T, M] columns survive — "Extra" is dropped so a
    // later step's recorded index (e.g. a stack of [1, 2]) still means what
    // it meant when M2 was appended right after them.
    expect(c.data.labels).toEqual(["Temp", "Moment"]);
    expect(c.data.values).toEqual([[2, 1], [5, 4]]);
  });

  it("keeps the target's extra columns when nothing recorded appends a column", () => {
    const c = conformData(src, COLS, [1, 0], [STACK]);
    expect(c.data.labels).toEqual(["Temp", "Moment", "Extra"]);
  });

  it("the identity keeps the layout (and the Origin name list)", () => {
    const c = conformData(src, [{ name: "Moment", unit: "emu", required: true }], [0]);
    expect(c.data.labels).toEqual(src.labels);
    expect(c.data.metadata.origin_column_names).toEqual(["A", "B", "C"]);
  });

  it("carries the error-column roles onto the moved columns (x axis stays -1)", () => {
    const c = conformData(src, COLS, [1, 0]);
    expect(
      conformErrorRoles(
        [
          { channel: 2, target: 0, axis: "y", side: "both" },
          { channel: 1, target: -1, axis: "x", side: "both" },
        ],
        c,
      ),
    ).toEqual([
      { channel: 2, target: 1, axis: "y", side: "both" },
      { channel: 0, target: -1, axis: "x", side: "both" },
    ]);
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
