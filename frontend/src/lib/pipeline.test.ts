// lib/pipeline — typed step contract, script export, expression validation (#6/#7).

import { describe, expect, it } from "vitest";

import {
  makeStep,
  moveStep,
  pipelineToScript,
  regenerateStep,
  validateExpression,
} from "./pipeline";

describe("makeStep / regenerateStep", () => {
  it("regenerates an expression step's label + code from edited params", () => {
    const s = makeStep("expression", "Add column old", "qz.addColumn(\"old\", \"A\")", {
      name: "old",
      expr: "A",
    });
    const edited = regenerateStep({ ...s, params: { name: "ratio", expr: "A / B" } });
    expect(edited.label).toBe("Add column ratio");
    expect(edited.code).toBe('qz.addColumn("ratio", "A / B")');
  });

  it("keeps a ui step's recorded code verbatim", () => {
    const s = makeStep("ui", "Y axis log", "qz.setYLog(true)");
    expect(regenerateStep({ ...s, params: { anything: 1 } }).code).toBe("qz.setYLog(true)");
  });

  it("keeps the { errors: true } propagate flag on a regenerate (review finding 5)", () => {
    const s = makeStep("expression", "Add column P", 'qz.addColumn("P", "A * C", { errors: true })', {
      name: "P",
      expr: "A * C",
      propagate: true,
      sigmaName: "σ(P)",
    });
    const edited = regenerateStep({ ...s, params: { ...s.params, expr: "A * C * 2" } });
    expect(edited.code).toBe('qz.addColumn("P", "A * C * 2", { errors: true })');
  });
});

describe("pipelineToScript", () => {
  it("emits enabled steps and comments out disabled ones", () => {
    const a = makeStep("expression", "Add column r", 'qz.addColumn("r", "A")');
    const b = { ...makeStep("ui", "Y log", "qz.setYLog(true)"), enabled: false };
    const script = pipelineToScript([a, b]);
    expect(script).toContain('qz.addColumn("r", "A")');
    expect(script).toContain("// off: qz.setYLog(true)");
    expect(script).toContain("2 steps");
  });
});

describe("validateExpression (#7 author-time validation)", () => {
  it("accepts valid expressions over x and channel letters", () => {
    expect(validateExpression("A / B + x", 2)).toBeNull();
    expect(validateExpression("sqrt(abs(A))", 1)).toBeNull();
  });

  it("rejects parse errors with the parser's message", () => {
    expect(validateExpression("A +", 1)).toBeTruthy();
    expect(validateExpression("A $ B", 2)).toMatch(/unexpected/);
  });

  it("rejects references to channels the dataset does not have", () => {
    expect(validateExpression("C + 1", 2)).toBeTruthy(); // only A, B exist
  });

  it("accepts fit()/fitval() and aggregate expressions — never evaluated (review finding 5)", () => {
    // The old version probed by EVALUATING against a fabricated {x:1,A:1,…}
    // row context with no fit snapshot / column window, so every one of
    // these was rejected regardless of whether the dataset has a usable
    // fit — a syntax + reference check can't be fooled that way because it
    // never runs the formula.
    expect(validateExpression('fit("Gaussian", "A")', 1)).toBeNull();
    expect(validateExpression('fitval("Gaussian", x)', 1)).toBeNull();
    expect(validateExpression("mean(A)", 1)).toBeNull();
    expect(validateExpression("A - mean(A)", 1)).toBeNull();
  });
});

describe("moveStep", () => {
  const steps = ["a", "b", "c"].map((n) => makeStep("ui", n, n));

  it("moves within bounds and clamps at the edges", () => {
    expect(moveStep(steps, 0, 1).map((s) => s.label)).toEqual(["b", "a", "c"]);
    expect(moveStep(steps, 2, 1).map((s) => s.label)).toEqual(["a", "b", "c"]);
    expect(moveStep(steps, 0, -1).map((s) => s.label)).toEqual(["a", "b", "c"]);
  });
});
