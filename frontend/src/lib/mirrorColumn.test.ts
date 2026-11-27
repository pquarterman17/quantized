// The pure half of mirror columns: recognition by shape, the row-count note and
// the derived names (plans/ROW_RANGE_CONTRACT.md 6.1, 6.3).

import { describe, expect, it } from "vitest";

import { isMirror, mirrorEditReason, mirrorExpr, mirrorLink, mirrorName, mirrorRowNote, mirrorSourceText } from "./mirrorColumn";
import type { ComputedColumn, Dataset } from "./types";

const f = (expr: string, sheets: ComputedColumn["sheets"]): ComputedColumn => ({ name: "c", expr, sheets });

describe("isMirror", () => {
  it("is exactly one sheet() call with one binding, in either quoting, with spaces", () => {
    expect(isMirror(f('sheet("Run 2", C)', [{ name: "Run 2", id: "a" }]))).toBe(true);
    expect(isMirror(f("  sheet( 'Run 2' ,x )  ", [{ name: "Run 2", id: "a" }]))).toBe(true);
    expect(mirrorLink(f('sheet("Run 2", C)', [{ name: "Run 2", id: null }]))).toEqual({ sourceName: "Run 2", letter: "C", sourceId: null });
  });

  it("is not an expression around the call, two calls on one sheet, or an unlinked call", () => {
    const one = [{ name: "A", id: "a" }];
    expect(isMirror(f('sheet("A", C) * 2', one))).toBe(false);
    expect(isMirror(f('sheet("A", C) + sheet("A", D)', one))).toBe(false);
    expect(isMirror(f('sheet("A", C)', undefined))).toBe(false);
    expect(isMirror(f('sheet("A", C)', [...one, { name: "B", id: "b" }]))).toBe(false);
    expect(isMirror(f('sheet("A", C)', [{ name: "Other", id: "a" }]))).toBe(false); // binding must be the one named
    expect(isMirror(f("A + 1", undefined))).toBe(false);
  });
});

describe("mirrorRowNote", () => {
  it("says which rows are not mirrored, or which are blank, and nothing when equal", () => {
    expect(mirrorRowNote(120, 100)).toBe("source has 120 rows, this sheet 100: rows 101-120 are not mirrored");
    expect(mirrorRowNote(101, 100)).toBe("source has 101 rows, this sheet 100: row 101 is not mirrored");
    expect(mirrorRowNote(99, 100)).toBe("source has 99 rows, this sheet 100: row 100 is blank");
    expect(mirrorRowNote(5, 5)).toBeNull();
  });
});

describe("mirrorExpr and mirrorName", () => {
  it("quotes with whichever quote the name lacks, and refuses a name with both", () => {
    expect(mirrorExpr("Run 2", "C")).toBe('sheet("Run 2", C)');
    expect(mirrorExpr("Bob's run", "x")).toBe(`sheet("Bob's run", x)`);
    expect(mirrorExpr(`it's "both"`, "C")).toBeNull();
  });

  it("keeps the source's name when free, else numbers a (mirror) suffix", () => {
    expect(mirrorName("T", ["A"])).toBe("T");
    expect(mirrorName("T", ["T"])).toBe("T (mirror)");
    expect(mirrorName("T", ["T", "T (mirror)"])).toBe("T (mirror 2)");
  });
});

const sheetOf = (id: string, name: string, labels: string[], formulas?: ComputedColumn[]): Dataset => ({
  id,
  name,
  data: { time: [0, 1], values: [labels.map(() => 1), labels.map(() => 2)], labels, units: labels.map(() => ""), metadata: {} },
  ...(formulas ? { formulas } : {}),
});

describe("naming a mirror and its source in messages", () => {
  const src = sheetOf("s", "sheetA.csv", ["u", "v"]);
  const link = { sourceName: "sheetA.csv", letter: "B", sourceId: "s" };

  it("names the source column by its label when the worksheet is known, else by its letter", () => {
    expect(mirrorSourceText(link, [src])).toBe("sheetA.csv › v");
    expect(mirrorSourceText(link)).toBe("sheetA.csv › B");
    expect(mirrorSourceText({ ...link, sourceId: "gone" }, [src])).toBe("sheetA.csv › B");
    expect(mirrorSourceText({ ...link, letter: "x" }, [{ ...src, data: { ...src.data, metadata: { x_column_name: "t" } } }])).toBe("sheetA.csv › t");
  });

  it("says (mirror) once whether or not the column's own name already carries it", () => {
    const cases: [string, string][] = [
      ["v (mirror)", "v (mirror) follows sheetA.csv › v: edit it there"],
      ["v (mirror 2)", "v (mirror 2) follows sheetA.csv › v: edit it there"],
      ["v", "v (mirror) follows sheetA.csv › v: edit it there"],
    ];
    for (const [name, start] of cases) {
      const mir = sheetOf("m", "sheetB.csv", ["q", name], [{ name, expr: 'sheet("sheetA.csv", B)', sheets: [{ name: "sheetA.csv", id: "s" }] }]);
      expect(mirrorEditReason(mir, 1, [src, mir])!.startsWith(start)).toBe(true);
    }
  });
});
