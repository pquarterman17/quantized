// P2.5 derived expressions — the analysis a new column goes through before
// anything is committed (lib/derivedColumn.ts): syntax with positions, real
// columns only, fitted values resolved against the dataset's own fit, the
// derived unit, and the propagated σ over the P1.6 error roles.

import { describe, expect, it } from "vitest";

import { deriveColumns } from "./derivedColumn";
import type { Dataset, FitSpec } from "./types";

// T (K) ± dT, R (Ω) ± dR, n (no unit, no error).
function ds(over: Partial<Dataset> = {}): Dataset {
  return {
    id: "d",
    name: "d",
    data: {
      time: [1, 2, 3],
      values: [
        [300, 1, 10, 0.1, 5],
        [310, 2, 20, 0.2, 6],
        [320, 3, 30, 0.3, 7],
      ],
      labels: ["T", "dT", "R", "dR", "n"],
      units: ["K", "K", "Ω", "Ω", ""],
      metadata: { xUnit: "s" },
    },
    errorRoles: [
      { channel: 1, target: 0, axis: "y", side: "both" },
      { channel: 3, target: 2, axis: "y", side: "both" },
    ],
    ...over,
  };
}
const gaussFit: FitSpec = { model: "Gaussian", params: [2, 1, 0.5], yKey: 2, exitFlag: 1 };

describe("expression and columns", () => {
  it("refuses a syntax error with the evaluator's message and its column", () => {
    expect(deriveColumns(ds(), { name: "", expr: "A + sqr(C)", propagate: false })).toEqual({
      ok: false,
      error: 'unknown function "sqr" (column 5)',
    });
    expect(deriveColumns(ds(), { name: "", expr: "A +", propagate: false })).toMatchObject({ error: /unexpected end of expression \(column 4\)/ });
  });
  it("refuses a column that does not exist (it would only ever be NaN)", () => {
    expect(deriveColumns(ds(), { name: "", expr: "A + Z", propagate: false })).toEqual({ ok: false, error: "there is no column Z" });
  });
  it("names the column by its formula when no name is given", () => {
    const r = deriveColumns(ds(), { name: " ", expr: "A * 2", propagate: false });
    expect(r.ok && r.columns[0].name).toBe("A * 2");
  });
});

describe("units", () => {
  it("derives the unit and marks it automatic", () => {
    const r = deriveColumns(ds(), { name: "P", expr: "C**2 / C * A", propagate: false });
    expect(r).toMatchObject({ ok: true, unit: "Ω·K", columns: [{ name: "P", unit: "Ω·K", derived: { unitAuto: true } }] });
  });
  it("uses the recorded x unit", () => {
    const r = deriveColumns(ds(), { name: "v", expr: "C / x", propagate: false });
    expect(r.ok && r.unit).toBe("Ω/s");
  });
  it("refuses mismatched units and keeps every assumption as a note", () => {
    expect(deriveColumns(ds(), { name: "", expr: "A + C", propagate: false })).toMatchObject({ ok: false, error: /units differ/ });
    const r = deriveColumns(ds(), { name: "q", expr: "A + E", propagate: false });
    expect(r.ok && r.notes).toEqual(['E (n) has no unit; "A + E" assumes it is in K']);
    expect(r.ok && r.columns[0].derived?.notes).toEqual(r.ok ? r.notes : []);
  });
  it("records nothing extra for a plain unitless formula", () => {
    const r = deriveColumns(ds(), { name: "q", expr: "E * 2", propagate: false });
    expect(r.ok && r.columns).toEqual([{ name: "q", expr: "E * 2", derived: { notes: ["the result's unit is unknown (E (n) has no recorded unit)"] } }]);
  });
});

describe("fitted values", () => {
  it("resolves a snapshot of the dataset's own saved fit, with the model's names and formula", () => {
    const r = deriveColumns(ds({ fitSpec: gaussFit }), { name: "res", expr: 'C - fitval("Gaussian", x)', propagate: false });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.columns[0].derived?.fits).toEqual([
      { model: "Gaussian", paramNames: ["A", "μ", "σ"], expr: "p0*exp(-((x - p1)**2)/(2*p2**2))", params: [2, 1, 0.5] },
    ]);
    expect(r.unit).toBe("Ω"); // fitval() is in the fit's Y column's unit (R)
  });
  it.each<[string, Partial<Dataset>, RegExp]>([
    ['fit("Gaussian", "A")', {}, /no saved fit/],
    ['fit("Lorentzian", "A")', { fitSpec: gaussFit }, /the saved fit is "Gaussian"/],
    ['fit("Gaussian", "A")', { fitSpec: { ...gaussFit, exitFlag: 0 } }, /did not converge/],
    ['fit("Gaussian", "B")', { fitSpec: gaussFit }, /has no parameter "B" \(it has A, μ, σ\)/],
    ['fit("Gaussian", "p3")', { fitSpec: gaussFit }, /has no parameter "p3"/],
    ['fitval("Langevin", x)', { fitSpec: { model: "Langevin", params: [1, 2] } }, /only evaluate a closed-form model/],
  ])("refuses %s when it cannot resolve", (expr, over, why) => {
    expect(deriveColumns(ds(over), { name: "", expr, propagate: false })).toMatchObject({ ok: false, error: why });
  });
  it("indexes a model without a formula by p-number", () => {
    const r = deriveColumns(ds({ fitSpec: { model: "Langevin", params: [1, 2] } }), { name: "", expr: 'fit("Langevin", "p1")', propagate: false });
    expect(r.ok && r.columns[0].derived?.fits?.[0]).toEqual({ model: "Langevin", paramNames: [], params: [1, 2] });
  });
});

describe("propagated σ", () => {
  it("adds a σ column over the bound symmetric errors, linked both ways", () => {
    const r = deriveColumns(ds(), { name: "P", expr: "A * C", propagate: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bindSigma).toBe(true);
    const [value, sigma] = r.columns;
    expect(value.derived?.sigma).toBe("σ(P)");
    expect(sigma).toMatchObject({
      name: "σ(P)",
      expr: "sqrt((C * B)**2 + (A * D)**2)",
      unit: "K·Ω",
      derived: { sigmaOf: { name: "P", method: "first-order, uncorrelated" } },
    });
    expect(r.notes).toContain("σ by first-order, uncorrelated propagation from A (T) ± B, C (R) ± D");
  });
  it("uses the label-inferred roles when none were set, and says which inputs are exact", () => {
    const r = deriveColumns(ds({ errorRoles: undefined }), { name: "P", expr: "A * E", propagate: true });
    expect(r.ok && r.columns[1].expr).toBe("abs(E * B)");
    expect(r.ok && r.notes).toContain("treated as exact (no bound error column): E (n)");
  });
  it("an x error binds to target -1", () => {
    const d = ds({ errorRoles: [{ channel: 1, target: -1, axis: "x", side: "both" }] });
    const r = deriveColumns(d, { name: "v", expr: "C / x", propagate: true });
    expect(r.ok && r.columns[1].expr).toBe("abs(-(C / x**2) * B)");
  });
  it.each<[string, Partial<Dataset>, RegExp]>([
    ["A * C", { errorRoles: [{ channel: 1, target: 0, axis: "y", side: "+" }, { channel: 3, target: 0, axis: "y", side: "-" }] }, /asymmetric/],
    ["A * C", { errorRoles: [{ channel: 1, target: 0, axis: "y", side: "both" }, { channel: 3, target: 0, axis: "x", side: "both" }] }, /more than one bound error column/],
    ["E * 2", {}, /none of the columns .* has a bound error column/],
    ["A - mean(A)", {}, /couples rows/],
  ])("refuses %s", (expr, over, why) => {
    expect(deriveColumns(ds(over), { name: "", expr, propagate: true })).toMatchObject({ ok: false, error: why });
  });
  it("refuses a value name already taken by a computed column (the σ links by name)", () => {
    const d = ds();
    d.data = { ...d.data, labels: [...d.data.labels, "P"], units: [...d.data.units, ""], values: d.data.values.map((r) => [...r, 0]) };
    d.formulas = [{ name: "P", expr: "A" }];
    expect(deriveColumns(d, { name: "P", expr: "A * 2", propagate: true })).toMatchObject({ ok: false, error: /already exists/ });
  });
  it("notes inputs that share an upstream column — they are correlated", () => {
    const d = ds();
    d.data = { ...d.data, labels: [...d.data.labels, "F", "dF"], units: [...d.data.units, "K", "K"], values: d.data.values.map((r) => [...r, 0, 0]) };
    d.formulas = [
      { name: "F", expr: "A * 2", deps: ["A"] },
      { name: "dF", expr: "abs(2 * B)", deps: ["B"] },
    ];
    d.errorRoles = [...d.errorRoles!, { channel: 6, target: 5, axis: "y", side: "both" }];
    const r = deriveColumns(d, { name: "Q", expr: "A + F", propagate: true });
    expect(r.ok && r.notes.join(" ")).toMatch(/A \(T\) and F share A, so they are correlated; this σ ignores that/);
  });
  it("carries the fit snapshot onto a σ that reads a fitted value", () => {
    const r = deriveColumns(ds({ fitSpec: gaussFit }), { name: "g", expr: 'fitval("Gaussian", A / 300)', propagate: true });
    expect(r.ok && r.columns[1].derived?.fits?.[0].model).toBe("Gaussian");
    expect(r.ok && r.notes).toContain("fitted parameters are treated as exact (their standard errors are not stored with the fit)");
  });
  it("a unique σ name when σ(name) is already a column", () => {
    const d = ds();
    d.data = { ...d.data, labels: [...d.data.labels.slice(0, 4), "σ(P)"] };
    const r = deriveColumns(d, { name: "P", expr: "A * 2", propagate: true });
    expect(r.ok && r.columns[1].name).toBe("σ(P) 2");
  });
});
