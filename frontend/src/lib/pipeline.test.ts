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
});

describe("moveStep", () => {
  const steps = ["a", "b", "c"].map((n) => makeStep("ui", n, n));

  it("moves within bounds and clamps at the edges", () => {
    expect(moveStep(steps, 0, 1).map((s) => s.label)).toEqual(["b", "a", "c"]);
    expect(moveStep(steps, 2, 1).map((s) => s.label)).toEqual(["a", "b", "c"]);
    expect(moveStep(steps, 0, -1).map((s) => s.label)).toEqual(["a", "b", "c"]);
  });
});
