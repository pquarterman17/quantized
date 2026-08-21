// Sol audit P1-3, DEFECT A closure — pure unit coverage for the column-
// letter rewrite `store/computedColumns.ts`'s `removeFormula` relies on.
// The concrete corruption case (F1/F2/F3 chain) is covered end-to-end in
// store/computedColumns.test.ts; these tests isolate the rewrite/shift
// primitives themselves.

import { describe, expect, it } from "vitest";

import { channelIndexOf, remapSurvivingFormulas, rewriteFormulaExpr, shiftLetter } from "./formulaRename";
import type { ComputedColumn } from "./types";

describe("channelIndexOf (inverse of formula.ts's channelLetter)", () => {
  it("round-trips the bijective-base-26 alphabet", () => {
    expect(channelIndexOf("A")).toBe(0);
    expect(channelIndexOf("Z")).toBe(25);
    expect(channelIndexOf("AA")).toBe(26);
    expect(channelIndexOf("AZ")).toBe(51);
    expect(channelIndexOf("BA")).toBe(52);
  });

  it("returns null for anything outside the uppercase-letter alphabet", () => {
    expect(channelIndexOf("x")).toBeNull(); // the time column, lowercase by convention
    expect(channelIndexOf("a")).toBeNull();
    expect(channelIndexOf("A1")).toBeNull();
    expect(channelIndexOf("")).toBeNull();
  });
});

describe("shiftLetter", () => {
  it("leaves a letter before the removed column unchanged", () => {
    expect(shiftLetter("A", 2)).toEqual({ letter: "A", removed: false });
  });
  it("decrements a letter after the removed column", () => {
    expect(shiftLetter("D", 1)).toEqual({ letter: "C", removed: false }); // index3 -> index2
  });
  it("flags the removed column itself", () => {
    expect(shiftLetter("B", 1)).toEqual({ letter: "B", removed: true }); // index1 === removedCol
  });
  it("passes a non-letter name through untouched (never a live case in practice)", () => {
    expect(shiftLetter("x", 0)).toEqual({ letter: "x", removed: false });
  });
});

describe("rewriteFormulaExpr", () => {
  it("shifts every reference past removedCol, leaves earlier ones alone", () => {
    // removedCol=1 (letter B removed): C->B, D->C. A is untouched.
    const r = rewriteFormulaExpr("A + C * D", 1);
    expect(r).toEqual({ ok: true, expr: "A + B * C" });
  });

  it("is a true no-op (same text) when nothing references past removedCol", () => {
    const r = rewriteFormulaExpr("A * 2", 3);
    expect(r).toEqual({ ok: true, expr: "A * 2" });
  });

  it("errors with the removed column named when the expr references it directly", () => {
    const r = rewriteFormulaExpr("B + C", 1); // B === removedCol
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("references removed column B");
  });

  it("names the FIRST offending letter deterministically for a multi-reference hit", () => {
    const r = rewriteFormulaExpr("B + B", 1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("references removed column B");
  });

  it("leaves an ALREADY-unparseable expr untouched (not this removal's concern)", () => {
    const r = rewriteFormulaExpr("A +", 5); // unrelated removal, expr was already broken
    expect(r).toEqual({ ok: true, expr: "A +" });
  });

  it("rewrites references inside row-aware functions (lag/diff/aggregates) too", () => {
    const r = rewriteFormulaExpr("lag(C, 1) + mean(D)", 1); // C->B, D->C
    expect(r).toEqual({ ok: true, expr: "lag ( B , 1 ) + mean ( C )" });
  });

  it("never renames a function name or a constant, only bare column references", () => {
    // "log" and "pi" must survive verbatim even though shifting is in play.
    const r = rewriteFormulaExpr("log(C) + pi * D", 1);
    expect(r).toEqual({ ok: true, expr: "log ( B ) + pi * C" });
  });

  it("leaves x (the time column) untouched", () => {
    const r = rewriteFormulaExpr("x + C", 1);
    expect(r).toEqual({ ok: true, expr: "x + B" });
  });
});

describe("remapSurvivingFormulas", () => {
  it("rewrites a shiftable formula's expr AND recomputes its deps from the rewritten expr", () => {
    const formulas: ComputedColumn[] = [{ name: "F", expr: "A + C", deps: ["A", "C"] }];
    const { formulas: out, forcedErrors } = remapSurvivingFormulas(formulas, 1); // C -> B
    expect(out).toEqual([{ name: "F", expr: "A + B", deps: ["A", "B"] }]);
    expect(forcedErrors).toEqual({});
  });

  it("forces an error (placeholder expr, empty deps) for a formula referencing the removed column", () => {
    const formulas: ComputedColumn[] = [{ name: "F", expr: "B + 1", deps: ["B"] }];
    const { formulas: out, forcedErrors } = remapSurvivingFormulas(formulas, 1); // B === removedCol
    expect(out).toEqual([{ name: "F", expr: "__removed__", deps: [] }]);
    expect(forcedErrors).toEqual({ F: "references removed column B" });
  });

  it("shifts a recode column's sourceLetter/expr/deps together", () => {
    const formulas: ComputedColumn[] = [
      { name: "R", expr: "recode(C)", deps: ["C"], recode: { sourceLetter: "C", mapping: { groups: [] } } },
    ];
    const { formulas: out, forcedErrors } = remapSurvivingFormulas(formulas, 1); // C -> B
    expect(out).toEqual([
      { name: "R", expr: "recode(B)", deps: ["B"], recode: { sourceLetter: "B", mapping: { groups: [] } } },
    ]);
    expect(forcedErrors).toEqual({});
  });

  it("forces an error for a recode column sourced from the removed column, never a silent rebind", () => {
    const formulas: ComputedColumn[] = [
      { name: "R", expr: "recode(B)", deps: ["B"], recode: { sourceLetter: "B", mapping: { groups: [] } } },
    ];
    const { formulas: out, forcedErrors } = remapSurvivingFormulas(formulas, 1); // B === removedCol
    expect(out[0].recode?.sourceLetter).not.toBe("B");
    expect(out[0].deps).toEqual([]);
    expect(forcedErrors).toEqual({ R: "references removed column B" });
  });
});
