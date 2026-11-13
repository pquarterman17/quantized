// Worksheet audit #17 — the Origin-like formula additions (lib/formulaRefs.ts):
// col(A) / col("Long Name"), `c ? a : b`, A[i] and agg(A[i:j]) (1-based),
// cumsum, sheet("Name", A), text comparison, and the derived-unit prefix rule.

import { afterEach, describe, expect, it } from "vitest";

import { parseExpr, printExpr } from "./derivedExprAst";
import { deriveUnit } from "./derivedUnits";
import { applyFormulas, applyFormulasWithErrors, channelLetter, compileFormula, referencedColumns } from "./formula";
import { resolveColumnNames, setFormulaSheetResolver, sheetNamesRead } from "./formulaRefs";
import { downstreamOf } from "./recalc";
import type { DataStruct, Dataset } from "./types";

const base: DataStruct = {
  time: [1, 2, 3, 4],
  values: [
    [10, 0],
    [20, 1],
    [Number.NaN, 0],
    [40, 1],
  ],
  labels: ["Moment", "Sample"],
  units: ["emu", ""],
  metadata: { text_columns: { Note: ["a", "b", "a", "c"] } },
  cat_levels: { 1: ["A", "B"] },
};

const col = (expr: string, data: DataStruct = base): number[] => {
  const out = applyFormulasWithErrors(data, [{ name: "f", expr }]);
  expect(out.errors).toEqual({});
  return out.data.values.map((row) => row[row.length - 1]);
};

afterEach(() => setFormulaSheetResolver(null));

describe("col() references", () => {
  it("col(A) is A, and col(\"Long Name\") resolves to the named column's letter", () => {
    expect(col("col(A) * 2")).toEqual(col("A * 2"));
    expect(referencedColumns("col(A) + 1").letters).toEqual(["A"]);
    expect(resolveColumnNames('col("Moment") / 2', base.labels, channelLetter)).toBe("A / 2");
    expect(resolveColumnNames('col("moment") / 2', base.labels, channelLetter)).toBe("A / 2"); // unique case-insensitive
    expect(col('col("Moment") / 2')).toEqual([5, 10, Number.NaN, 20]);
  });

  it("an unknown name is an error that names it", () => {
    const out = applyFormulasWithErrors(base, [{ name: "f", expr: 'col("Nope") + 1' }]);
    expect(out.errors.f).toMatch(/no column named "Nope"/);
  });
});

describe("conditional, indexing, ranges, cumsum", () => {
  it("c ? a : b is if(c, a, b), NaN for a NaN condition, right-associative", () => {
    expect(col("A > 15 ? 1 : 0")).toEqual([0, 1, Number.NaN, 1]);
    expect(col("A > 30 ? 2 : A > 15 ? 1 : 0")).toEqual(col("if(A > 30, 2, if(A > 15, 1, 0))"));
  });

  it("A[i] is 1-based, accepts an expression, and is NaN out of range", () => {
    expect(col("A[1]")).toEqual([10, 10, 10, 10]);
    expect(col("A[row() - 1]")).toEqual([Number.NaN, 10, 20, Number.NaN]);
    expect(col("A[9] + A[0] + A[1.5]")).toEqual([Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
  });

  it("agg(A[i:j]) reduces rows i..j inclusive; a bare range is refused with what to write", () => {
    expect(col("sum(A[1:2])")).toEqual([30, 30, 30, 30]);
    expect(col("mean(A[2:4])")).toEqual([30, 30, 30, 30]); // the NaN row is skipped
    expect(col("count(A[1:4])")).toEqual([3, 3, 3, 3]);
    expect(() => compileFormula("A[1:2]")).toThrow(/use it inside an aggregate, e.g. sum\(A\[i:j\]\)/);
  });

  it("cumsum(A) is the running sum; a NaN row adds nothing but is itself NaN", () => {
    expect(col("cumsum(A)")).toEqual([10, 30, Number.NaN, 70]);
  });
});

describe("text comparison", () => {
  it("compares a categorical column's LABEL and a text column's cell", () => {
    expect(col('B == "B"')).toEqual([0, 1, 0, 1]);
    expect(col('"A" == B')).toEqual([1, 0, 1, 0]);
    expect(col('if(col("Note") != "a", A, 0)')).toEqual([0, 20, 0, 40]);
  });

  it("refuses text against a numeric column", () => {
    const out = applyFormulasWithErrors(base, [{ name: "f", expr: 'A == "x"' }]);
    expect(out.errors.f).toMatch(/numeric column; compare it with a number/);
  });
});

describe("sheet(\"Name\", A)", () => {
  it("reads another worksheet's column at the same row, NaN past its end", () => {
    const other: DataStruct = { time: [0, 0], values: [[5], [6]], labels: ["v"], units: [""], metadata: {} };
    setFormulaSheetResolver((name) => (name === "Run 2" ? other : undefined));
    expect(col('A + sheet("Run 2", A)')).toEqual([15, 26, Number.NaN, Number.NaN]);
    expect(referencedColumns('sheet("Run 2", B)').letters).toEqual([]); // not THIS sheet's column
    expect(sheetNamesRead('sheet("Run 2", A) * sheet("x", B)')).toEqual(["Run 2", "x"]);
    expect(applyFormulasWithErrors(base, [{ name: "f", expr: 'sheet("Missing", A)' }]).errors.f).toMatch(/no worksheet named "Missing"/);
  });

  it("puts the reading worksheet downstream of the one it reads (recalc)", () => {
    const run2: Dataset = { id: "r2", name: "Run 2", data: base };
    const reader: Dataset = {
      id: "rd",
      name: "reader",
      data: applyFormulas(base, [{ name: "f", expr: 'sheet("Run 2", A)' }]),
      formulas: [{ name: "f", expr: 'sheet("Run 2", A)' }],
    };
    expect(downstreamOf([run2, reader], "r2").datasets).toContain("rd");
  });
});

describe("the expression tree mirrors every new form", () => {
  const exprs = [
    "A > 15 ? 1 : 0",
    "A[row() - 1] + 1",
    "sum(A[1:2]) / 2",
    "cumsum(A)",
    'B == "B"',
    '"A" != B',
    'col("Note") == "a"',
    'sheet("Run 2", A) * 2',
  ];
  it.each(exprs)("print(parse(%s)) evaluates identically", (expr) => {
    const other: DataStruct = { time: [0, 0, 0, 0], values: [[1], [2], [3], [4]], labels: ["v"], units: [""], metadata: {} };
    setFormulaSheetResolver(() => other);
    expect(col(printExpr(parseExpr(expr)))).toEqual(col(expr));
  });
});

describe("unit inference for a power-of-1000 rescale", () => {
  const env = (unit: string) => ({ unitOf: () => unit, label: (l: string) => l, fitYUnit: () => "" });
  const unitOf = (expr: string, unit: string) => deriveUnit(parseExpr(expr), env(unit));
  it("gives the prefixed unit — never the wrong unprefixed one", () => {
    expect(unitOf("x / 1000", "K").unit).toBe("kK");
    expect(unitOf("A * 1000", "emu").unit).toBe("memu");
    expect(unitOf("A / 1e6", "Oe").unit).toBe("MOe");
    expect(unitOf("A / 1000", "mK").unit).toBe("K");
  });
  it("gives NO unit (and says why) when no prefixed symbol exists", () => {
    const r = unitOf("A / 1000", "emu/g");
    expect(r.unit).toBe("");
    expect(r.warnings.join(" ")).toMatch(/no prefixed unit expresses that; the result has no unit/);
  });
  it("keeps the unit for any other constant factor", () => {
    expect(unitOf("A * 2", "K").unit).toBe("K");
    expect(unitOf("A / 3", "K").unit).toBe("K");
  });
});
