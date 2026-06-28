import { describe, expect, it } from "vitest";

import {
  applyFormulas,
  baseColumns,
  channelLetter,
  compileFormula,
  recomputeData,
} from "./formula";
import type { DataStruct } from "./types";

const ev = (src: string, ctx: Record<string, number> = {}) => compileFormula(src)(ctx);

const base: DataStruct = {
  time: [1, 2],
  values: [
    [10, 20],
    [30, 40],
  ],
  labels: ["A", "B"],
  units: ["u", "v"],
  metadata: {},
};

describe("compileFormula — arithmetic", () => {
  it("respects precedence and associativity", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("2 ^ 3 ^ 2")).toBe(512); // right-assoc -> 2^9
    expect(ev("10 - 3 - 2")).toBe(5); // left-assoc
    expect(ev("7 % 3")).toBe(1);
  });
  it("handles unary minus and signed numbers", () => {
    expect(ev("-3 + 5")).toBe(2);
    expect(ev("-(2 ^ 2)")).toBe(-4);
    expect(ev("2 * -3")).toBe(-6);
    expect(ev("1e3 + 2.5e-1")).toBe(1000.25);
  });
});

describe("compileFormula — variables + functions", () => {
  it("reads column variables from the context", () => {
    expect(ev("2*A + B", { A: 3, B: 4 })).toBe(10);
    expect(ev("x / 2", { x: 9 })).toBe(4.5);
  });
  it("evaluates functions and constants", () => {
    expect(ev("sqrt(B)", { B: 16 })).toBe(4);
    expect(ev("max(A, B)", { A: 2, B: 7 })).toBe(7);
    expect(ev("cos(pi)")).toBeCloseTo(-1, 12);
    expect(ev("ln(e)")).toBeCloseTo(1, 12);
  });
  it("compiles once and evaluates per row", () => {
    const f = compileFormula("A*A + 1");
    expect(f({ A: 2 })).toBe(5);
    expect(f({ A: 3 })).toBe(10);
  });
});

describe("compileFormula — errors", () => {
  it("throws on parse + name errors", () => {
    expect(() => compileFormula("1 +")).toThrow();
    expect(() => compileFormula("(1 + 2")).toThrow();
    expect(() => compileFormula("1 2")).toThrow(/trailing/);
    expect(() => compileFormula("nope(1)")).toThrow(/unknown function/);
    expect(() => compileFormula("@")).toThrow();
  });
  it("throws when a referenced variable is absent", () => {
    expect(() => compileFormula("Z + 1")({ A: 1 })).toThrow(/unknown variable/);
  });
});

describe("channelLetter", () => {
  it("maps indices to spreadsheet letters", () => {
    expect(channelLetter(0)).toBe("A");
    expect(channelLetter(25)).toBe("Z");
    expect(channelLetter(26)).toBe("AA");
    expect(channelLetter(27)).toBe("AB");
  });
});

describe("computed columns", () => {
  it("applies a formula over x + channel letters", () => {
    const out = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    expect(out.labels).toEqual(["A", "B", "S"]);
    expect(out.values).toEqual([
      [10, 20, 30],
      [30, 40, 70],
    ]);
    expect(base.values[0]).toHaveLength(2); // input untouched (immutable)
  });

  it("evaluates formulas in order so a later one can reference an earlier (by letter)", () => {
    const out = applyFormulas(base, [
      { name: "S", expr: "A + B" }, // → column C (index 2)
      { name: "T", expr: "C * 2" }, // references the computed S
    ]);
    expect(out.values).toEqual([
      [10, 20, 30, 60],
      [30, 40, 70, 140],
    ]);
  });

  it("yields an all-NaN column for a broken formula (keeps indices stable)", () => {
    const out = applyFormulas(base, [{ name: "bad", expr: "A +" }]);
    expect(out.labels).toEqual(["A", "B", "bad"]);
    expect(out.values[0][2]).toBeNaN();
    expect(out.values[1][2]).toBeNaN();
  });

  it("baseColumns strips the last n columns", () => {
    const out = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    expect(baseColumns(out, 1)).toEqual(base);
    expect(baseColumns(base, 0)).toBe(base); // no-op
  });

  it("recomputeData re-derives the computed column from an edited base", () => {
    const withS = applyFormulas(base, [{ name: "S", expr: "A + B" }]);
    // Simulate a base edit: A[0] 10 → 100.
    const edited: DataStruct = {
      ...withS,
      values: [
        [100, 20, 30],
        [30, 40, 70],
      ],
    };
    const out = recomputeData(edited, [{ name: "S", expr: "A + B" }]);
    expect(out.values[0][2]).toBe(120); // 100 + 20
    expect(out.values[1][2]).toBe(70); // unchanged row
  });
});
