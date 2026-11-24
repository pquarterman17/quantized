// Text and date/time formula functions (lib/formulaText.ts, formulaDate.ts,
// formulaCalendar.ts; gap audit 9 G16) against the pandas / stdlib /
// dateutil reference values frozen by tools/freeze_text_date_fixture.py
// (pandas 2.3.3). Tolerance: the measured worst difference on this fixture
// is 0 for every integer-valued case and 0 for the date fields (all exact in
// binary); `str(A, "%.3g")` -> num() is compared exactly too. The asserts
// allow 1e-9 relative only as headroom for a platform's libm.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulasWithErrors, compileFormula } from "./formula";
import { parseExpr, printExpr, children } from "./derivedExprAst";
import { deriveUnit } from "./derivedUnits";
import { DATE_NAMES, TEXT_NAMES } from "./formulaMath";
import { DATE_FUNCS } from "./formulaDate";
import { TEXT_FUNCTION_NAMES } from "./formulaText";
import { headlessFormulaProblem } from "./formulaHeadless";
import { isRowLocalFormula } from "./formulaIncremental";
import "./formulaRefs"; // registers the lazy extension
import type { DataStruct } from "./types";

interface Fixture {
  text: string[];
  nums: string[];
  floats: number[];
  text_expected: Record<string, (number | null)[]>;
  date: {
    iso: string[];
    parse_date: (number | null)[];
    epochs: number[];
    fields: Record<string, number[]>;
    wide_epochs: number[];
    wide_fields: Record<string, number[]>;
    pair_a: number[];
    pair_b: number[];
    datediff: Record<string, number[]>;
    make: number[][];
    make_expected: number[];
    make_bad: number[][];
  };
}
const FX = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "formulaTextDate.json"), "utf8")) as Fixture;

/** A dataset of `cols` numeric columns (A, B, …) plus text columns. */
const data = (cols: number[][], text: Record<string, string[]> = {}, n = cols[0]?.length ?? Object.values(text)[0].length): DataStruct => ({
  time: Array.from({ length: n }, (_, i) => i),
  values: Array.from({ length: n }, (_, r) => cols.map((c) => c[r])),
  labels: cols.map((_, i) => `v${i}`),
  units: cols.map(() => ""),
  metadata: { text_columns: text },
});
const run = (expr: string, d: DataStruct): number[] => {
  const out = applyFormulasWithErrors(d, [{ name: "f", expr }]);
  expect(out.errors, expr).toEqual({});
  return out.data.values.map((r) => r[r.length - 1]);
};
const same = (got: number[], want: (number | null)[], what: string) => {
  expect(got.length, what).toBe(want.length);
  got.forEach((g, i) => {
    const w = want[i];
    if (w === null) return expect(g, `${what} row ${i + 1}`).toBeNaN();
    expect(Math.abs(g - w), `${what} row ${i + 1}: got ${g}, want ${w}`).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(w)));
  });
};

describe("text functions match pandas", () => {
  for (const [expr, want] of Object.entries(FX.text_expected)) {
    it(expr, () => {
      const d = expr.includes("str(A")
        ? data([FX.floats])
        : expr.includes('col("N")')
          ? data([FX.nums.map(() => 0)], { N: FX.nums })
          : data([FX.text.map(() => 0)], { S: FX.text });
      same(run(expr, d), want, expr);
    });
  }
});

describe("date functions match pandas / datetime / dateutil", () => {
  const D = FX.date;
  it("parse_date: ISO 8601 -> epoch seconds, bad dates missing", () => {
    same(run('parse_date(col("D"))', data([D.iso.map(() => 0)], { D: D.iso })), D.parse_date, "parse_date");
  });
  for (const fn of Object.keys(D.fields)) {
    it(`${fn}()`, () => {
      same(run(`${fn}(A)`, data([D.epochs])), D.fields[fn], fn);
      same(run(`${fn}(A)`, data([D.wide_epochs])), D.wide_fields[fn], `${fn} (years 1 and 9999)`);
    });
  }
  for (const unit of Object.keys(D.datediff)) {
    it(`datediff(A, B, "${unit}")`, () => {
      same(run(`datediff(A, B, "${unit}")`, data([D.pair_a, D.pair_b])), D.datediff[unit], unit);
    });
  }
  it("make_date builds exactly the datetime (round trip through the fields)", () => {
    const cols = [0, 1, 2, 3, 4, 5].map((k) => D.make.map((m) => m[k]));
    same(run("make_date(A, B, C, D, E, F)", data(cols)), D.make_expected, "make_date");
    same(run("make_date(A, B, C)", data(cols.slice(0, 3))), D.make.map((m) => D.make_expected[D.make.indexOf(m)] - m[3] * 3600 - m[4] * 60 - m[5]), "make_date date only");
    // fields of the made date are the inputs
    same(run("year(make_date(A, B, C, D, E, F))", data(cols)), D.make.map((m) => m[0]), "year(make_date)");
  });
  it("make_date of a date that does not exist is missing, never rolled over", () => {
    const cols = [0, 1, 2].map((k) => D.make_bad.map((m) => m[k]));
    expect(run("make_date(A, B, C)", data(cols)).every(Number.isNaN)).toBe(true);
  });
});

describe("behaviour beyond the oracle", () => {
  const S = (cells: string[]) => data([cells.map(() => 0)], { S: cells });
  it("counts Unicode code points (Python len), not UTF-16 units", () => {
    expect(run('len(col("S"))', S(["😀", "é", "é", "样品"]))).toEqual([1, 1, 2, 2]);
  });
  it("an empty string is a value; a missing categorical level is missing", () => {
    expect(run('len(col("S"))', S([""]))).toEqual([0]);
    const d: DataStruct = { ...data([[0, 1, Number.NaN]]), metadata: {} };
    const out = applyFormulasWithErrors(d, [{ name: "f", expr: "len(A)" }]); // A is numeric
    expect(out.errors.f).toMatch(/numeric column, not text/);
  });
  it("reads a categorical column's level label", () => {
    const out = applyFormulasWithErrors({ ...data([[0, 1, 1, 7, Number.NaN]]), cat_levels: { 0: ["a", "bb"] } }, [{ name: "f", expr: 'len(A) * 10 + contains(A, "b")' }]);
    expect(out.errors).toEqual({});
    expect(out.data.values.map((r) => r[1])).toEqual([10, 21, 21, Number.NaN, Number.NaN]);
  });
  it("num() is strict: no inf/nan/hex/thousands, spaces ignored", () => {
    const cells = ["inf", "nan", "0x10", "1,000", " 12 ", "1e3", "-.5", "1_0", "", "٣"];
    expect(run('num(col("S"))', S(cells))).toEqual([NaN, NaN, NaN, NaN, 12, 1000, -0.5, NaN, NaN, NaN]);
  });
  it("str() ties and formats (documented: halves round away from zero, unlike Python's half-even)", () => {
    const d = data([[0.125, -2.5, 3.14159, 1e21, Number.NaN]]);
    expect(run('len(str(A, "%.2f"))', d)).toEqual([4, 5, 4, 25, NaN]);
    expect(run('num(str(A, "%.2f"))', d).slice(0, 3)).toEqual([0.13, -2.5, 3.14]);
    expect(run("len(str(A))", data([[300, 1.5]]))).toEqual([3, 3]);
  });
  it("left/right/mid refuse negative or fractional counts (missing, not Python wrap-around)", () => {
    const d = data([[-1, 0, 1.5, 2]], { S: ["abcd", "abcd", "abcd", "abcd"] });
    expect(run('len(left(col("S"), A))', d)).toEqual([NaN, 0, NaN, 2]);
    expect(run('len(mid(col("S"), A, 2))', d)).toEqual([NaN, NaN, NaN, 2]);
  });
  it("regex_extract: group default, no match missing", () => {
    expect(run('len(regex_extract(col("S"), "a(b)c"))', S(["abc", "xyz"]))).toEqual([1, NaN]);
    expect(run('len(regex_extract(col("S"), "a(b)c", 0))', S(["abc"]))).toEqual([3]);
  });
  it("a text-producing function at the top of a column is refused with a pointer", () => {
    const out = applyFormulasWithErrors(S(["a"]), [{ name: "f", expr: 'upper(col("S"))' }]);
    expect(out.errors.f).toMatch(/upper\(\) returns text, but a formula column holds numbers/);
  });
  it("refuses a bad pattern, a bad format, a bad unit and non-text arguments when entered", () => {
    for (const [expr, why] of [
      ['regex_match(col("S"), "(")', /bad pattern/],
      ['len(str(A, "%q"))', /unsupported format/],
      ['datediff(A, A, "fortnight")', /unknown unit/],
      ["datediff(A, A, 3)", /unit in quotes/],
      ["len(1 + 2)", /expects text here/],
      ['len(regex_extract(col("S"), "(a)", 3))', /1 group/],
    ] as const) {
      expect(() => compileFormula(expr), expr).toThrow(why);
    }
  });
  it("week day numbering is JMP's: Sunday = 1", () => {
    expect(run("weekday(A)", data([[0, 3 * 86400, -86400]]))).toEqual([5, 1, 4]); // Thu 1970-01-01, Sun 01-04, Wed 1969-12-31
  });
  it("non-instants are missing, not errors", () => {
    const d = data([[Number.NaN, Infinity, 3e11, -7e10]]);
    for (const fn of ["year", "month", "weekday", "hour"]) expect(run(`${fn}(A)`, d).every(Number.isNaN), fn).toBe(true);
  });
  it("text reads are not row-local (incremental recompute falls back); pure date math is", () => {
    expect(isRowLocalFormula({ name: "f", expr: 'len(col("S"))' })).toBe(false);
    expect(isRowLocalFormula({ name: "f", expr: "year(A)" })).toBe(true);
  });
  it("is outside the headless subset with a clear message (never evaluated differently)", () => {
    for (const expr of ['len(col("S"))', "year(A)", 'datediff(A, B, "day")', "make_date(A, 3, 1)", 'num("12")', 'parse_date("2026-03-01")']) {
      expect(headlessFormulaProblem(expr), expr).toMatch(/quoted text|calls|not x or a column/);
    }
  });
});

describe("the derived-column analysis (Add column) accepts them", () => {
  it("name lists agree with the evaluators", () => {
    expect([...TEXT_NAMES].sort()).toEqual([...TEXT_FUNCTION_NAMES, "datediff"].sort());
    expect([...DATE_NAMES].sort()).toEqual(Object.keys(DATE_FUNCS).sort());
  });
  it("parses, prints back and has no unit", () => {
    const env = { unitOf: (n: string) => (n === "A" ? "s" : ""), label: (n: string) => n, fitYUnit: () => "" };
    for (const e of ['num(regex_extract(col("Sample"), "(\\d+)K", 1))', 'len(col("S"))', 'datediff(parse_date("2026-01-01"), A, "day")', "weekday(A)", 'len(str(A, "%.2f"))']) {
      const n = parseExpr(e);
      expect(parseExpr(printExpr(n))).toEqual(n);
      expect(children(n).length).toBeGreaterThanOrEqual(0);
      expect(deriveUnit(n, env).unit, e).toBe("");
    }
  });
});
