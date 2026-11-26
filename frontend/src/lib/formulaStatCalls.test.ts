// Moving-window, column-statistic and conditional-aggregate formula functions
// (lib/formulaStatCalls.ts, plan item 28 aggregate half). Expected values are
// worked by hand in the comments, or (skew/kurt/geomean/harmean/mad/percentile/
// cov/correl/linregress) computed once with scipy 1.x / numpy and pasted as
// constants (not re-derived by the code under test).

import { describe, expect, it } from "vitest";

import { parseExpr } from "./derivedExprAst";
import { deriveUnit } from "./derivedUnits";
import { applyFormulasWithErrors, compileFormula } from "./formula";
import { parseCondition } from "./formulaCondition";
import { headlessFormulaProblem } from "./formulaHeadless";
import { computeFormulasIncremental, isRowLocalFormula } from "./formulaIncremental";
import { recomputeFromBase, asAlreadyComputed } from "./formulaInputs";
import { STAT_ENTRIES } from "./formulaStatHelp";
import { STAT_CALL_NAMES } from "./formulaStatNames";
import { FUNCTION_ENTRIES } from "./setColumnValues";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

const NaN_ = Number.NaN;
const make = (cols: number[][], extra: Partial<DataStruct> = {}): DataStruct => ({
  time: cols[0].map((_, i) => i), // x = 0, 1, 2, ...
  values: cols[0].map((_, r) => cols.map((c) => c[r])),
  labels: cols.map((_, i) => `col${i}`),
  units: cols.map(() => ""),
  metadata: {},
  ...extra,
});
const run = (expr: string, d: DataStruct): number[] => {
  const out = applyFormulasWithErrors(d, [{ name: "f", expr }]);
  expect(out.errors, expr).toEqual({});
  return out.data.values.map((r) => r[r.length - 1]);
};
const err = (expr: string, d: DataStruct): string | undefined => applyFormulasWithErrors(d, [{ name: "f", expr }]).errors.f;
const close = (got: number[], want: number[], tol = 1e-12) => {
  expect(got).toHaveLength(want.length);
  want.forEach((w, i) => (Number.isNaN(w) ? expect(got[i], `row ${i}`).toBeNaN() : expect(got[i], `row ${i}`).toBeCloseTo(w, -Math.log10(tol) - 2)));
};

const Y = make([[1, 2, 3, 4, 10]]);

describe("moving windows", () => {
  it("movavg truncates the window at both ends", () => {
    // rows r-1..r+1 clamped: [1,2]=1.5, [1,2,3]=2, [2,3,4]=3, [3,4,10]=17/3, [4,10]=7
    close(run("movavg(A, 1, 1)", Y), [1.5, 2, 3, 17 / 3, 7]);
  });
  it("back and forward are independent", () => {
    close(run("movsum(A, 1, 0)", Y), [1, 3, 5, 7, 14]); // current + previous only
    close(run("movsum(A, 0, 0)", Y), [1, 2, 3, 4, 10]);
  });
  it("movmedian, movrms, movsd", () => {
    close(run("movmedian(A, 1, 1)", Y), [1.5, 2, 3, 4, 7]);
    close(run("movrms(A, 0, 1)", Y), [Math.sqrt(2.5), Math.sqrt(6.5), Math.sqrt(12.5), Math.sqrt(58), 10]); // (1+4)/2, (4+9)/2, (9+16)/2, (16+100)/2, 100/1
    // sample sd of [1,2]=sqrt(.5); [1,2,3]=1; [2,3,4]=1; [3,4,10]=sqrt(((3-17/3)^2+(4-17/3)^2+(10-17/3)^2)/2); [4,10]=sqrt(18)
    const mid = Math.sqrt(((3 - 17 / 3) ** 2 + (4 - 17 / 3) ** 2 + (10 - 17 / 3) ** 2) / 2);
    close(run("movsd(A, 1, 1)", Y), [Math.sqrt(0.5), 1, 1, mid, Math.sqrt(18)]);
  });
  it("movslope is the slope against x over the window", () => {
    // x = 0..4; row0 (0,1),(1,2) = 1; rows 1,2 slope 1; row3 (2,3),(3,4),(4,10): Sxy = 8/3+13/3 = 7, Sxx = 2 -> 3.5; row4 (3,4),(4,10) = 6
    close(run("movslope(A, 1, 1)", Y), [1, 1, 1, 3.5, 6]);
  });
  it("a blank cell is skipped inside a window, and a blank row stays blank", () => {
    const d = make([[1, NaN_, 3, 4, 5]]);
    close(run("movavg(A, 1, 1)", d), [1, NaN_, 3.5, 4, 4.5]);
    close(run("movsum(A, 5, 5)", d), [13, NaN_, 13, 13, 13]);
  });
  it("a single point window: sd is blank, slope is blank", () => {
    close(run("movsd(A, 0, 0)", Y), [NaN_, NaN_, NaN_, NaN_, NaN_]);
    close(run("movslope(A, 0, 0)", Y), [NaN_, NaN_, NaN_, NaN_, NaN_]);
  });
  it("emovavg: alpha = 2/(n+1), seeded with the first value; blanks hold the state", () => {
    close(run("emovavg(A, 3)", make([[1, 2, 3, 4]])), [1, 1.5, 2.25, 3.125]);
    close(run("emovavg(A, 3)", make([[1, NaN_, 3]])), [1, NaN_, 2]);
  });
  it("refuses a window that is not a whole number of rows", () => {
    expect(err("movavg(A, -1, 1)", Y)).toMatch(/whole number of rows/);
    expect(err("movavg(A, 1.5, 1)", Y)).toMatch(/whole number of rows/);
    expect(err("emovavg(A, 0)", Y)).toMatch(/1 or more/);
    expect(() => compileFormula("movavg(A, 1)")).toThrow();
    expect(() => compileFormula("movavg(A + 1, 1, 1)")).toThrow(/bare column/);
  });
});

describe("column statistics", () => {
  const D = make([[2, 4, 4, 4, 5, 5, 7, 9]]);
  const all = (expr: string, d = D) => run(expr, d)[0];
  it("skew, kurt, geomean, harmean, mad, percentile match scipy/numpy", () => {
    expect(all("skew(A)")).toBeCloseTo(0.8184875533567996, 12);
    expect(all("kurt(A)")).toBeCloseTo(0.9406249999999998, 12);
    expect(all("geomean(A)")).toBeCloseTo(4.603215596046736, 12);
    expect(all("harmean(A)")).toBeCloseTo(4.201750729470613, 12);
    expect(all("mad(A)")).toBe(0.5);
    expect(all("percentile(A, 30)")).toBe(4);
    expect(all("percentile(A, 0)")).toBe(2);
    expect(all("percentile(A, 100)")).toBe(9);
    expect(all("percentile(A, 50)")).toBe(4.5);
  });
  it("mode is the smallest most-frequent value; blank when nothing repeats", () => {
    expect(all("mode(A)")).toBe(4);
    expect(all("mode(A)", make([[3, 3, 1, 1, 2]]))).toBe(1); // tie 1 vs 3 -> smallest
    expect(all("mode(A)", make([[1, 2, 3]]))).toBeNaN();
  });
  it("sample-size and domain limits give blanks, not numbers", () => {
    expect(all("skew(A)", make([[1, 2]]))).toBeNaN();
    expect(all("kurt(A)", make([[1, 2, 3]]))).toBeNaN();
    expect(all("geomean(A)", make([[1, 0, 3]]))).toBeNaN();
    expect(all("harmean(A)", make([[1, -2, 3]]))).toBeNaN();
    expect(all("percentile(A, 101)")).toBeNaN();
    expect(all("skew(A)", make([[5, 5, 5, 5]]))).toBeNaN(); // no spread
  });
  it("blank cells are ignored", () => {
    expect(all("geomean(A)", make([[2, NaN_, 8]]))).toBeCloseTo(4, 12);
  });
  it("correl, cov, slope, intercept: pairs with a blank are dropped; slope/intercept take X first", () => {
    // A = x column data, B = y: x=[1..5], y=[2,4,5,4,5] -> cov 1.5, r 0.7745966692414834, slope .6, intercept 2.2 (scipy)
    const d = make([[1, 2, 3, 4, 5], [2, 4, 5, 4, 5]]);
    expect(all("cov(A, B)", d)).toBeCloseTo(1.5, 12);
    expect(all("cov(B, A)", d)).toBeCloseTo(1.5, 12);
    expect(all("correl(A, B)", d)).toBeCloseTo(0.7745966692414834, 12);
    expect(all("slope(A, B)", d)).toBeCloseTo(0.6, 12);
    expect(all("intercept(A, B)", d)).toBeCloseTo(2.2, 12);
    const holed = make([[1, 2, 3, 4, 5, 6], [2, 4, 5, 4, 5, NaN_]]);
    expect(all("slope(A, B)", holed)).toBeCloseTo(0.6, 12);
    expect(all("slope(A, B)", make([[2, 2, 2], [1, 2, 3]]))).toBeNaN(); // no spread in X
    expect(all("correl(A, B)", make([[1], [1]]))).toBeNaN();
  });
});

describe("conditional aggregates", () => {
  // A = key, B = value
  const D = make([[1, 3, 5, 7], [10, 20, 30, 40]]);
  it("sumif / countif / averageif / maxifs / minifs", () => {
    expect(run('sumif(A, ">=3", B)', D)[0]).toBe(90);
    expect(run('sumif(A, ">=3")', D)[0]).toBe(15); // sums the tested range itself
    expect(run('countif(A, "<>3")', D)[0]).toBe(3);
    expect(run('countif(A, "=3")', D)[0]).toBe(1);
    expect(run("countif(A, 3)", D)[0]).toBe(1); // a number means equals
    expect(run('averageif(A, ">5", B)', D)[0]).toBe(40);
    expect(run('maxifs(B, A, ">1", A, "<7")', D)[0]).toBe(30);
    expect(run('minifs(B, A, ">1")', D)[0]).toBe(20);
  });
  it("the same value on every row", () => {
    expect(run('countif(A, ">2")', D)).toEqual([3, 3, 3, 3]);
  });
  it("no match: 0 for sum/count, blank for average/max/min", () => {
    expect(run('sumif(A, ">99", B)', D)[0]).toBe(0);
    expect(run('countif(A, ">99")', D)[0]).toBe(0);
    expect(run('averageif(A, ">99", B)', D)[0]).toBeNaN();
    expect(run('maxifs(B, A, ">99")', D)[0]).toBeNaN();
  });
  it("a blank cell matches nothing, even <>; blank values are not summed", () => {
    const d = make([[1, NaN_, 5], [10, 20, NaN_]]);
    expect(run('countif(A, "<>1")', d)[0]).toBe(1);
    expect(run('sumif(A, ">0", B)', d)[0]).toBe(10);
  });
  it("text conditions on a categorical column and a text column compare labels, ignoring case", () => {
    const d = make([[1, 2, 3, 4], [0, 1, 0, 1]], { cat_levels: { 1: ["Fe", "Co"] } });
    expect(run('countif(B, "fe")', d)[0]).toBe(2);
    expect(run('sumif(B, "<>Fe", A)', d)[0]).toBe(6);
    expect(() => compileFormula('countif(B, ">Fe")')).toThrow(/not a number/);
    expect(err('countif(B, "Fe")', make([[1, 2], [3, 4]]))).toMatch(/numeric column/);
    const t = make([[1, 2, 3]]);
    expect(err('countif(col("Nope"), "x")', t)).toMatch(/no column named "Nope"/);
  });
  it("condition grammar", () => {
    expect(parseCondition(">=2")).toEqual({ op: ">=", operand: "2", num: 2 });
    expect(parseCondition(" <> 0 ")).toEqual({ op: "<>", operand: "0", num: 0 });
    expect(parseCondition("<=-1.5e2")).toEqual({ op: "<=", operand: "-1.5e2", num: -150 });
    expect(parseCondition("5")).toEqual({ op: "=", operand: "5", num: 5 });
    expect(parseCondition("=Fe")).toEqual({ op: "=", operand: "Fe", num: null });
    expect(parseCondition("<>Fe")).toEqual({ op: "<>", operand: "Fe", num: null });
    expect(parseCondition("Fe")).toEqual({ op: "=", operand: "Fe", num: null });
  });
  it("bad conditions are rejected with a message, at formula entry", () => {
    expect(() => parseCondition("")).toThrow(/no value after the operator/);
    expect(() => parseCondition(">")).toThrow(/no value after the operator/);
    expect(() => parseCondition("==3")).toThrow(/write "=" or "<>"/);
    expect(() => parseCondition("!=3")).toThrow(/write "=" or "<>"/);
    expect(() => parseCondition(">abc")).toThrow(/not a number/);
    expect(() => parseCondition("0x10")).not.toThrow(); // text "0x10", never evaluated as a number
    expect(parseCondition("0x10").num).toBeNull();
    expect(parseCondition("Infinity").num).toBeNull();
    expect(() => compileFormula('countif(A, ">")')).toThrow(/no value/);
    expect(() => compileFormula("countif(A, >5)")).toThrow();
    expect(err('countif(A, ">")', D)).toMatch(/no value/);
  });
});

describe("whole-column contract", () => {
  const EXPRS = [
    "movavg(A, 1, 1)", "movmedian(A, 1, 1)", "movrms(A, 1, 1)", "movsum(A, 1, 1)", "movsd(A, 1, 1)", "movslope(A, 1, 1)", "emovavg(A, 3)",
    "correl(A, B)", "cov(A, B)", "slope(A, B)", "intercept(A, B)", "percentile(A, 50)", "skew(A)", "kurt(A)", "geomean(A)", "harmean(A)", "mad(A)", "mode(A)",
    'sumif(A, ">1", B)', 'countif(A, ">1")', 'averageif(A, ">1", B)', 'maxifs(B, A, ">1")', 'minifs(B, A, ">1")',
  ];

  it("every function is in the name set, which is exactly the set tested here", () => {
    const names = new Set(EXPRS.map((e) => /^[a-z]+/.exec(e)![0]));
    expect(names).toEqual(new Set(STAT_CALL_NAMES));
  });

  it("formulaIncremental treats every one as not row-local", () => {
    for (const expr of EXPRS) expect(isRowLocalFormula({ name: "F", expr }), expr).toBe(false);
  });

  it("a one-cell edit recomputes the whole column: the incremental path declines and the full path is right", () => {
    const base = make([[1, 2, 3, 4, 5], [5, 4, 3, 2, 1]], { labels: ["A", "B"] });
    for (const expr of EXPRS) {
      const formulas = [{ name: "F", expr }];
      const before = recomputeFromBase(base, formulas).data;
      const edited = { ...before, values: before.values.map((r, i) => (i === 2 ? r.map((v, c) => (c === 0 ? 100 : v)) : r)) };
      expect(computeFormulasIncremental(asAlreadyComputed(edited), formulas, [2], undefined), expr).toBeNull();
    }
    // The edit really does move other rows' values (so a one-row patch would have been wrong).
    const f = [{ name: "F", expr: "movavg(A, 1, 1)" }];
    const before = recomputeFromBase(make([[1, 2, 3, 4, 5]], { labels: ["A"] }), f).data;
    const after = recomputeFromBase(make([[1, 2, 100, 4, 5]], { labels: ["A"] }), f).data;
    const col = (d: DataStruct) => d.values.map((r) => r[1]);
    expect(col(before)[1]).not.toBe(col(after)[1]); // row 1, neighbour of the edited row 2
  });

  it("the exported-script check refuses each, with a message", () => {
    for (const expr of EXPRS) {
      const why = headlessFormulaProblem(expr);
      expect(why, expr).toBeTruthy();
      expect(why, expr).toMatch(/\w/);
    }
  });

  it("derived units: same-unit statistics keep the column's unit; others say unknown or none", () => {
    const env = { unitOf: (n: string) => (n === "A" ? "K" : n === "B" ? "s" : ""), label: (n: string) => n, fitYUnit: () => "" };
    expect(deriveUnit(parseExpr("movavg(A, 1, 1)"), env).unit).toBe("K");
    expect(deriveUnit(parseExpr("percentile(A, 50)"), env).unit).toBe("K");
    expect(deriveUnit(parseExpr('sumif(A, ">1", A)'), env).unit).toBe("K");
    expect(deriveUnit(parseExpr("correl(A, B)"), env).dimensionless).toBe(true);
    expect(deriveUnit(parseExpr("slope(B, A)"), env).unit).toBe("");
  });

  it("every function is in the Insert function picker", () => {
    const text = [...FUNCTION_ENTRIES, ...STAT_ENTRIES].map((e) => e.label).join("\n");
    for (const name of STAT_CALL_NAMES) expect(text, name).toContain(name);
  });
});
