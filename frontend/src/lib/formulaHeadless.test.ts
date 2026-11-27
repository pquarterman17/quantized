// The headless formula subset (lib/formulaHeadless.ts) and its Python twin
// (calc/column_formula.py) agree with the APP's evaluator. Every case below is
// computed here by `applyFormulas` — the app's own computed-column path — and
// pinned with the data in `__fixtures__/formulaHeadless.json`;
// tests/test_column_formula.py evaluates the same cases with
// `quantized.api.evaluate_formula` and requires the same numbers, and that every
// `refused` expression is refused there too.
// Rewrite with `QZ_WRITE_FIXTURES=1 npx vitest run src/lib/formulaHeadless.test.ts`.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyFormulas } from "./formula";
import { headlessFormulaProblem } from "./formulaHeadless";
import type { DataStruct } from "./types";

const FIXTURE = join(__dirname, "__fixtures__", "formulaHeadless.json");

const DATA: DataStruct = {
  time: [-2, -0.5, 0, 0.25, 1, 3, 10],
  values: [
    [4, -3, 1],
    [0, 2, -1],
    [-7, 0, 0.5],
    [1, -1, Number.NaN],
    [Number.NaN, 5, 2],
    [2.5, Number.POSITIVE_INFINITY, -2],
    [-1, 1e-300, 7],
  ],
  labels: ["Moment", "Field", "T"],
  units: ["emu", "Oe", "K"],
  metadata: {},
};

const CASES = [
  "A + B * C - x",
  "A / B",
  "x / 0",
  "-A^2 + A**2",
  "2^3^2 - 2**-1",
  "A // C",
  "A % C",
  "-7 % C",
  "A ** C",
  "1 ** C + pow(B, 0.5)",
  "pow(-1, B)",
  "sqrt(A) + log(B)",
  "ln(abs(x)) + log10(abs(C)) + log2(abs(A))",
  "sin(x) * cos(A) + tan(B) + atan2(A, B) + atan(C) + asin(C) + acos(x / 10)",
  "arcsin(C) + arccos(C) + arctan(A) + sinh(C) + cosh(C) + tanh(A)",
  "exp(C) + sign(A) + abs(B)",
  "floor(A) + ceil(B) + floor(x * 3.7, 1) + ceil(A / 3, 2) + floor(1234.5, -2)",
  "hypot(A, B) + hypot(A, B, C)",
  "min(A, B) + max(A, B, C) + min(pi)",
  "max() + min()",
  "min(A, nan) + max(x, B)",
  "np.sqrt(abs(A)) * numpy.pi + math.e",
  "nan + 1",
  "(A + B) * (C - x) / (1 + x^2)",
  // A row the app cannot evaluate (digits not a whole number, or infinite) is NaN.
  "floor(A, C)",
  "ceil(x, 1 / 0)",
  // JavaScript arity: extra arguments ignored, a missing one gives NaN.
  "sin(A, B) + cos(x, 1, 2)",
  "atan2(A) + pow(B) + floor() + sqrt()",
  // A long chain evaluates without deep recursion on either side.
  Array.from({ length: 1000 }, () => "A").join("+"),
  Array.from({ length: 600 }, () => "B").join("*") + " - " + Array.from({ length: 600 }, () => "x").join("-"),
];

const REFUSED = [
  "A > 0",
  "if(A > 0, A, 0)",
  "where(A > 0, 1, 2)",
  "A > 0 ? 1 : 2",
  "A[2]",
  'col("Moment") * 2',
  "Moment * 2",
  'sheet("Other", A)',
  'fit("Gaussian", "xc")',
  "mean(A)",
  "min(A)",
  "max(x)",
  "row()",
  "cumsum(A)",
  "col_mean(A, B)",
  "col_rank_dense(A)",
  "col_score(A, B)",
  "lag(A)",
  "diff(A)",
  "round(A)",
  "rnd()",
  "interp(x, A, B)",
  // text and date/time functions (gap audit 9 G16): app-only
  'len(col("Sample"))',
  'num(regex_extract(col("Sample"), "(\\d+)K", 1))',
  'contains(col("Sample"), "Fe")',
  'parse_date("2026-03-01")',
  "year(A)",
  "weekday(x)",
  "make_date(2026, 3, 1)",
  'datediff(A, B, "day")',
  "A and B",
  "not A",
  // complex numbers: evaluated only in the app (contract C8)
  "complex(A, B)",
  "abs(complex(B, C))",
  "degrees(arg(complex(B, C)))",
  "polar(A, B)",
  "2i",
  "A + 0.5j",
  "abs(1 / (1 + 2i * pi * x * 1e-3))",
  "re(A)",
  "im(A)",
  "conj(A)",
  "real(A) + imag(A)",
  "angle(A)",
  "np.angle(A)",
  // The app's tokenizer: ASCII only, space/tab between tokens, finite numbers.
  "A\n+ 1",
  "A +\r1",
  "1e400 + A",
  "\uff21 + 1",
  "\u0663 + A",
];

const wire = (v: number): number | string =>
  Number.isNaN(v) ? "NaN" : v === Infinity ? "Infinity" : v === -Infinity ? "-Infinity" : v;

// The app's outputs are pinned to 14 significant digits: V8's pow / libm results
// differ by an ulp across Node versions (22 vs 26+), so the full double is not a
// stable fixture. tests/test_column_formula.py compares at rtol=1e-13, which
// 14-digit rounding (relative error <= 5e-15) stays well inside.
const wireApp = (v: number): number | string =>
  Number.isFinite(v) ? Number(v.toPrecision(14)) : wire(v);

describe("headless formula subset", () => {
  it("accepts every element-wise case and refuses every app-only form", () => {
    for (const expr of CASES) expect(headlessFormulaProblem(expr), expr).toBeNull();
    for (const expr of REFUSED) expect(headlessFormulaProblem(expr), expr).not.toBeNull();
    // The Python side's length limit (calc/column_formula.py MAX_LEN), here too.
    expect(headlessFormulaProblem("1+".repeat(5000) + "1")).toMatch(/longer than 10000/);
    expect(headlessFormulaProblem("1+".repeat(4999) + "1")).toBeNull();
  });

  it("names the complex construct it refuses, with or without the lazy complex module", () => {
    expect(headlessFormulaProblem("abs(complex(A, B))")).toMatch(/complex numbers: complex\(\)/);
    expect(headlessFormulaProblem("np.angle(A)")).toMatch(/complex numbers: angle\(\)/);
    expect(headlessFormulaProblem("A + 2i")).toMatch(/imaginary literal such as 2i/);
    expect(headlessFormulaProblem("A + 2in")).not.toMatch(/imaginary/); // not a literal: an ordinary parse failure
    // the real functions of the same family are still plain
    expect(headlessFormulaProblem("abs(A) + exp(B) + sqrt(C)")).toBeNull();
  });

  it("pins the app's own numbers for tests/test_column_formula.py", () => {
    const cases = CASES.map((expr) => {
      const out = applyFormulas(DATA, [{ name: "out", expr }]);
      return { expr, app: out.values.map((row) => wireApp(row[row.length - 1])) };
    });
    const fixture = {
      data: { time: DATA.time, values: DATA.values.map((r) => r.map(wire)), labels: DATA.labels },
      cases,
      refused: REFUSED,
    };
    const text = JSON.stringify(fixture, null, 1) + "\n";
    if (process.env.QZ_WRITE_FIXTURES === "1") writeFileSync(FIXTURE, text);
    expect(text).toBe(readFileSync(FIXTURE, "utf8"));
  });
});
