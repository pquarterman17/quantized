import { describe, expect, it } from "vitest";

import { channelLetter, compileFormula } from "./formula";

const ev = (src: string, ctx: Record<string, number> = {}) => compileFormula(src)(ctx);

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
