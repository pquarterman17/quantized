import { describe, expect, it } from "vitest";

import { lit, macroStep, macroToScript } from "./macro";

describe("lit", () => {
  it("quotes strings as JSON literals", () => {
    expect(lit("sample.dat")).toBe('"sample.dat"');
    expect(lit('a "quoted" name')).toBe('"a \\"quoted\\" name"');
  });

  it("renders numbers and booleans bare", () => {
    expect(lit(3.5)).toBe("3.5");
    expect(lit(true)).toBe("true");
    expect(lit(0)).toBe("0");
  });

  it("renders null and undefined as null", () => {
    expect(lit(null)).toBe("null");
    expect(lit(undefined)).toBe("null");
  });

  it("renders arrays compactly", () => {
    expect(lit([1, 2, 3])).toBe("[1, 2, 3]");
    expect(lit(["a", "b"])).toBe('["a", "b"]');
  });

  it("renders objects, dropping undefined fields", () => {
    expect(lit({ diamag: -1.2e-6, bg: undefined })).toBe("{ diamag: -0.0000012 }");
    expect(lit({ a: 1, b: "x" })).toBe('{ a: 1, b: "x" }');
  });
});

describe("macroStep", () => {
  it("assigns unique ids", () => {
    const a = macroStep("Import", 'qz.import("a")');
    const b = macroStep("Import", 'qz.import("b")');
    expect(a.id).not.toBe(b.id);
    expect(a.label).toBe("Import");
    expect(a.code).toBe('qz.import("a")');
  });
});

describe("macroToScript", () => {
  it("emits a header and one line per step", () => {
    const steps = [
      macroStep("Import a.dat", 'qz.import("a.dat")'),
      macroStep("Y axis log", "qz.setYLog(true)"),
    ];
    const script = macroToScript(steps);
    expect(script).toContain("// Quantized macro");
    expect(script).toContain("// 2 steps");
    expect(script).toContain('qz.import("a.dat")');
    expect(script).toContain("qz.setYLog(true)");
    expect(script.endsWith("\n")).toBe(true);
  });

  it("notes the empty case and singular count", () => {
    expect(macroToScript([])).toContain("// (no steps recorded)");
    expect(macroToScript([macroStep("x", "y")])).toContain("// 1 step");
  });
});
