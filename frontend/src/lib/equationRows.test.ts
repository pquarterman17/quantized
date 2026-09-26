// Custom-equation parameter table (audit P2.7): the hold flag and the
// refusals made BEFORE a request is sent.

import { describe, expect, it } from "vitest";

import {
  equationFitStep,
  equationRunProblem,
  newEquationRow,
  parseEquationRows,
  type EquationParamRow,
} from "./equationRows";

const row = (name: string, patch: Partial<EquationParamRow> = {}): EquationParamRow => ({
  ...newEquationRow(name),
  ...patch,
});

describe("parseEquationRows", () => {
  it("parses guesses, open bounds as null, and hold flags", () => {
    expect(
      parseEquationRows([row("a", { guess: "2", min: "0" }), row("b", { guess: "-1", max: "5", fixed: true })]),
    ).toEqual({ guesses: [2, -1], lower: [0, null], upper: [null, 5], fixed: [false, true] });
  });

  it("refuses when every parameter is held", () => {
    expect(parseEquationRows([row("a", { fixed: true }), row("b", { fixed: true })])).toEqual({
      error: "every parameter is held — nothing left to fit",
    });
  });

  it("refuses min above max, naming the parameter", () => {
    expect(parseEquationRows([row("a"), row("b", { min: "3", max: "1" })])).toEqual({
      error: "b: min is above max",
    });
  });

  it("refuses a held value outside its own bounds (curve_fit would clip it)", () => {
    expect(parseEquationRows([row("a", { guess: "5", max: "1", fixed: true }), row("b")])).toEqual({
      error: "a: held at 5, outside its bounds",
    });
  });

  it("lets a FREE guess sit outside its bounds (the solver clips a start)", () => {
    expect("error" in parseEquationRows([row("a", { guess: "5", max: "1" })])).toBe(false);
  });

  it("refuses a non-numeric guess or bound", () => {
    expect(parseEquationRows([row("a", { guess: "x" })])).toEqual({ error: "a: guess is not a number" });
    expect(parseEquationRows([row("a", { min: "lo" })])).toEqual({ error: "a: min is not a number" });
  });
});

describe("equationRunProblem", () => {
  it("is null for a runnable table and for an empty one", () => {
    expect(equationRunProblem([row("a"), row("b", { fixed: true })])).toBeNull();
    expect(equationRunProblem([])).toBeNull();
  });

  it("names the problem otherwise", () => {
    expect(equationRunProblem([row("a", { fixed: true })])).toContain("every parameter is held");
  });
});

describe("equationFitStep (P2.7 review: the macro step carries the setup)", () => {
  it("records guesses, bounds and hold flags in the line and the params", () => {
    const step = equationFitStep("a*x + b", {
      guesses: [2, 0],
      lower: [0, null],
      upper: [null, null],
      fixed: [false, true],
    });
    expect(step.code).toBe(
      'qz.fitEquation("a*x + b", { guesses: [2, 0], lower: [0, null], upper: [null, null], fixed: [false, true] })',
    );
    expect(step.params).toEqual({
      equation: "a*x + b",
      guesses: [2, 0],
      lower: [0, null],
      upper: [null, null],
      fixed: [false, true],
    });
  });
});
