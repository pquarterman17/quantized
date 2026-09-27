// The lazy expression-tree parser must agree with the evaluator's parser
// (lib/formula.ts) on EVERYTHING it accepts: print(parse(e)) is compiled by
// the real evaluator and must give exactly what e gives, across the grammar's
// precedence and associativity corners — that is what makes the unit and
// error-propagation passes (which read the tree) describe the formula the
// worksheet actually evaluates.

import { describe, expect, it } from "vitest";

import { columnsRead, isConstant, parseExpr, printExpr } from "./derivedExprAst";
import { compileFormula } from "./formula";
import type { FitRefSnapshot, FormulaRowContext } from "./formulaTypes";

const CORPUS = [
  "1 + 2 * 3",
  "(1 + 2) * 3",
  "2 ^ 3 ^ 2",
  "-2 ^ 2",
  "-A ^ 2",
  "2 ^ -A",
  "-2**2",
  "(-2)**2",
  "2**-1",
  "2**3**2",
  "-A**B",
  "A**-B**2",
  "A ** B ^ 2",
  "- - A",
  "10 - 3 - 2",
  "A - (B - C)",
  "A / B / C",
  "A / (B * C)",
  "A // B % 3",
  "7 % 3 * 2",
  "A * -B",
  "A - -B",
  "x / 2 + A",
  "sqrt(A) * exp(-B / C)",
  "np.log10(A) + math.log2(B) + ln(C)",
  "atan2(A, B) + hypot(A, B, C)",
  "min(A, B) + max(A, 2 * B)",
  "abs(A - B) ** 0.5",
  "pow(A, 2) + sign(B) * floor(C) + ceil(A)",
  "A > B",
  "A <= B and B != C or not A == 3",
  "not not (A > 0)",
  "(A > 0) * B",
  "if(A > B, A - B, B - A)",
  "where(A >= 0 and B < 5, sin(A), cos(B))",
  "row() + lag(A, 2) + diff(B)",
  "mean(A) + sd(B) + median(C) + count(A) + sum(B) + max(C) - min(A)",
  "A / mean(A) - 1",
  "pi * e + A",
  "1e-3 * A + 2.5e2",
  'fit("Gaussian", "A") * fitval("Gaussian", A - 1)',
  'fit("Gaussian").A - fit("Gaussian", "μ")',
  "fit('say \"hi\"', 'p0') + 1",
];

const cols: Record<string, number[]> = { x: [0.5, 1, 1.5], A: [2, -3, 0.25], B: [5, 4, -2], C: [3, 7, 11] };
const gauss: FitRefSnapshot = { model: "Gaussian", paramNames: ["A", "μ", "σ"], params: [2, 1, 0.5], expr: "p0*exp(-((x - p1)**2)/(2*p2**2))" };
const quoted: FitRefSnapshot = { model: 'say "hi"', paramNames: [], params: [4] };

function evalAt(src: string, row: number): number {
  const ctx: Record<string, number> = {};
  for (const [k, v] of Object.entries(cols)) ctx[k] = v[row];
  const ex: FormulaRowContext = { row, rowCount: 3, columns: cols, fits: [gauss, quoted] };
  return compileFormula(src)(ctx, ex);
}

describe("expression tree ↔ evaluator parity", () => {
  it.each(CORPUS)("%s", (src) => {
    const printed = printExpr(parseExpr(src));
    for (let r = 0; r < 3; r++) expect(Object.is(evalAt(printed, r), evalAt(src, r)) || evalAt(printed, r) === evalAt(src, r)).toBe(true);
    // printing is a fixed point: the printed text parses to the same tree
    expect(printExpr(parseExpr(printed))).toBe(printed);
  });
});

describe("expression tree ↔ evaluator parity, generated", () => {
  // Deterministic LCG: random operator/sign/paren mixes are where a printer
  // that parenthesizes by the wrong precedence would silently change meaning.
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  const atoms = ["A", "B", "C", "x", "2", "0.5", "pi"];
  const bins = [" + ", " - ", " * ", " / ", " ^ ", "**", " // ", " % "];
  function gen(depth: number): string {
    if (depth === 0 || rnd(4) === 0) return atoms[rnd(atoms.length)];
    const k = rnd(6);
    if (k === 0) return `-${gen(depth - 1)}`;
    if (k === 1) return `(${gen(depth - 1)})`;
    if (k === 2) return `sqrt(${gen(depth - 1)})`;
    return `${gen(depth - 1)}${bins[rnd(bins.length)]}${gen(depth - 1)}`;
  }
  it("300 random expressions evaluate identically after print(parse(·))", () => {
    for (let i = 0; i < 300; i++) {
      const src = gen(4);
      const printed = printExpr(parseExpr(src));
      for (let r = 0; r < 3; r++) {
        const a = evalAt(src, r);
        const b = evalAt(printed, r);
        expect(Object.is(a, b) || a === b, `${src}  →  ${printed}`).toBe(true);
      }
    }
  });
});

describe("tree helpers", () => {
  it("columnsRead covers plain references and the row-aware forms", () => {
    expect([...columnsRead(parseExpr("A + lag(B, 1) + mean(C) + fitval(\"M\", x)"))].sort()).toEqual(["A", "B", "C", "x"]);
  });
  it("isConstant is false for anything that reads a column, a row or a fit", () => {
    expect(isConstant(parseExpr("2 * pi / 3"))).toBe(true);
    for (const e of ["A", "row()", 'fit("M", "p0")', "mean(A)"]) expect(isConstant(parseExpr(e))).toBe(false);
  });
  it("names the column a syntax error sits at", () => {
    expect(() => parseExpr("A + sqr(B)")).toThrow('unknown function "sqr" (column 5)');
    expect(() => parseExpr("(A + B")).toThrow("(column 7)");
    expect(() => parseExpr("A B")).toThrow("trailing characters in expression (column 3)");
  });
});
