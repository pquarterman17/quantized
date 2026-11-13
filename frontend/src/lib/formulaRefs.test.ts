// Worksheet audit #17 — the Origin-like formula additions (lib/formulaRefs.ts):
// col(A) / col("Long Name"), `c ? a : b`, A[i] and agg(A[i:j]) (1-based),
// cumsum, sheet("Name", A), text comparison, and the derived-unit prefix rule.

import { afterEach, describe, expect, it } from "vitest";

import { parseExpr, printExpr } from "./derivedExprAst";
import { deriveUnit } from "./derivedUnits";
import { applyFormulas, applyFormulasWithErrors, compileFormula, referencedColumns } from "./formula";
import { isRowLocalFormula } from "./formulaIncremental";
import { resolveColumnNames, setFormulaSheetSource } from "./formulaRefs";
import { sheetNamesRead } from "./sheetRefs";
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

/** Links for a test formula: every listed name bound to the id of the same text. */
const linked = (...names: string[]) => names.map((name) => ({ name, id: name }));
const col = (expr: string, data: DataStruct = base, sheets = linked("Run 2")): number[] => {
  const out = applyFormulasWithErrors(data, [{ name: "f", expr, sheets }]);
  expect(out.errors).toEqual({});
  return out.data.values.map((row) => row[row.length - 1]);
};
const asSheet = (id: string, data: DataStruct, over: Partial<Dataset> = {}): Dataset => ({ id, name: id, data, ...over });

afterEach(() => setFormulaSheetSource(null));

describe("bare long names (re-audit #17)", () => {
  it("a unique bare long name is its column; letters, x, constants, calls and sheet() columns are left alone", () => {
    expect(resolveColumnNames("Moment * 2", base.labels)).toBe("A * 2");
    expect(col("Moment * 2")).toEqual(col("A * 2"));
    expect(resolveColumnNames("A + x + pi + mean(Moment)", base.labels)).toBe("A + x + pi + mean(A)");
    expect(resolveColumnNames('sheet("Run 2", Moment)', base.labels)).toBe('sheet("Run 2", Moment)');
    expect(resolveColumnNames("Momentum * 2", base.labels)).toBe("Momentum * 2"); // unknown: the evaluator says so
  });

  it("a bare name two columns share is refused, listing the letters", () => {
    expect(() => resolveColumnNames("T * 2", ["T", "T"])).not.toThrow(); // a letter, never a label
    expect(() => resolveColumnNames("Field + 1", ["Field", "Field"])).toThrow(/"Field" is ambiguous: columns A, B/);
  });
});

describe("col() references", () => {
  it("col(A) is A, and col(\"Long Name\") resolves to the named column's letter", () => {
    expect(col("col(A) * 2")).toEqual(col("A * 2"));
    expect(referencedColumns("col(A) + 1").letters).toEqual(["A"]);
    expect(resolveColumnNames('col("Moment") / 2', base.labels)).toBe("A / 2");
    expect(resolveColumnNames('col("moment") / 2', base.labels)).toBe("A / 2"); // unique case-insensitive
    expect(col('col("Moment") / 2')).toEqual([5, 10, Number.NaN, 20]);
  });

  it("a name two columns share is refused, listing the candidates — never the first one silently", () => {
    const dup: DataStruct = { ...base, labels: ["Moment", "Moment"], cat_levels: undefined };
    const out = applyFormulasWithErrors(dup, [{ name: "f", expr: 'col("Moment") * 2' }]);
    expect(out.errors.f).toBe('col("Moment") is ambiguous: columns A, B are all named "Moment" — use the letter, e.g. col(A)');
    expect(() => resolveColumnNames('col("moment")', ["Moment", "moment "])).toThrow(/ambiguous: columns A, B/);
  });

  it("an unknown name is an error that names it", () => {
    const out = applyFormulasWithErrors(base, [{ name: "f", expr: 'col("Nope") + 1' }]);
    expect(out.errors.f).toMatch(/no column named "Nope"/);
    // The row-function table is looked up by OWN key only.
    expect(() => compileFormula("constructor(1)")).toThrow(/unknown function "constructor"/);
    expect(() => compileFormula("toString(1)")).toThrow(/unknown function "toString"/);
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

  it("a range outside rows 1..N is an error about 1-based rows, never silently clamped", () => {
    const err = (expr: string) => applyFormulasWithErrors(base, [{ name: "f", expr }]);
    expect(err("sum(A[0:2])").errors.f).toBe("A[0:2] is outside rows 1..4 — rows are numbered from 1, and a range is inclusive at both ends");
    expect(err("sum(A[0:2])").data.values.map((r) => r[2])).toEqual([Number.NaN, Number.NaN, Number.NaN, Number.NaN]);
    expect(err("sum(A[-1:2])").errors.f).toMatch(/outside rows 1\.\.4/);
    expect(err("sum(A[2:9])").errors.f).toMatch(/outside rows 1\.\.4/);
    expect(err("sum(A[3:2])").errors.f).toMatch(/A\[3:2\] is empty: the range must run from a lower row to a higher one/);
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

  it("text comparison and sheet() are never evaluated by the single-row incremental path (it has no level/text/sheet context)", () => {
    expect(isRowLocalFormula({ name: "f", expr: 'B == "B"' })).toBe(false);
    expect(isRowLocalFormula({ name: "f", expr: 'sheet("Run 2", A)' })).toBe(false);
    expect(isRowLocalFormula({ name: "f", expr: "A > 1 ? A : 0" })).toBe(true); // the conditional is row-local
  });

  it("refuses text against a numeric column", () => {
    const out = applyFormulasWithErrors(base, [{ name: "f", expr: 'A == "x"' }]);
    expect(out.errors.f).toMatch(/numeric column; compare it with a number/);
  });
});

describe("sheet(\"Name\", A)", () => {
  it("reads another worksheet's column at the same row, NaN past its end", () => {
    const other: DataStruct = { time: [0, 0], values: [[5], [6]], labels: ["v"], units: [""], metadata: {} };
    setFormulaSheetSource(() => [asSheet("Run 2", other)]);
    expect(col('A + sheet("Run 2", A)')).toEqual([15, 26, Number.NaN, Number.NaN]);
    expect(referencedColumns('sheet("Run 2", B)').letters).toEqual([]); // not THIS sheet's column
    expect(sheetNamesRead('sheet("Run 2", A) * sheet("x", B)')).toEqual(["Run 2", "x"]);
  });

  it("reads through the column's LINK, never by name: unlinked, cut and unloaded references are errors", () => {
    const other: DataStruct = { time: [0, 0], values: [[5], [6]], labels: ["v"], units: [""], metadata: {} };
    // A worksheet NAMED "Run 2" exists, but the column is not linked to it.
    setFormulaSheetSource(() => [asSheet("other-id", other, { name: "Run 2" })]);
    const err = (sheets?: { name: string; id: string | null }[]) =>
      applyFormulasWithErrors(base, [{ name: "f", expr: 'sheet("Run 2", A)', sheets }]).errors.f;
    expect(err(undefined)).toMatch(/sheet\("Run 2", …\) is not linked to a worksheet/);
    expect(err([{ name: "Run 2", id: null }])).toMatch(/worksheet "Run 2" was removed/);
    expect(err([{ name: "Run 2", id: "gone" }])).toMatch(/worksheet "Run 2" was removed/);
    expect(err([{ name: "Run 2", id: "other-id" }])).toBeUndefined();
    setFormulaSheetSource(() => [asSheet("other-id", other, { name: "Run 2", pending: { kind: "path", path: "/b.opj", bookId: "B", rows: 300, cols: 1 } })]);
    expect(err([{ name: "Run 2", id: "other-id" }])).toMatch(/has not loaded its full data yet/);
  });

  it("puts the reading worksheet downstream of the one it reads (recalc)", () => {
    const run2: Dataset = { id: "r2", name: "Run 2", data: base };
    const reader: Dataset = {
      id: "rd",
      name: "reader",
      data: applyFormulas(base, [{ name: "f", expr: 'sheet("Run 2", A)' }]),
      formulas: [{ name: "f", expr: 'sheet("Run 2", A)', sheets: [{ name: "Run 2", id: "r2" }] }],
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
    setFormulaSheetSource(() => [asSheet("Run 2", other)]);
    expect(col(printExpr(parseExpr(expr)))).toEqual(col(expr));
  });
});

describe("unit inference for a power-of-1000 rescale", () => {
  const env = (unit: string) => ({ unitOf: () => unit, label: (l: string) => l, fitYUnit: () => "" });
  const unitOf = (expr: string, unit: string) => deriveUnit(parseExpr(expr), env(unit));
  it("never guesses: no unit, and the note says why (a unit change and a gain correction look the same)", () => {
    for (const [expr, unit] of [["x / 1000", "K"], ["A * 1000", "emu"], ["A / 1e6", "V"], ["A / 1000", "emu/g"]] as const) {
      const r = unitOf(expr, unit);
      expect(r.unit).toBe("");
      expect(r.dimensionless).toBe(false);
      expect(r.warnings.join(" ")).toMatch(/could be a unit conversion or a plain scale factor.*left without a unit — set one by hand/);
    }
  });
  it("keeps the unit for any other constant factor", () => {
    expect(unitOf("A * 2", "K").unit).toBe("K");
    expect(unitOf("A / 3", "K").unit).toBe("K");
  });
});
