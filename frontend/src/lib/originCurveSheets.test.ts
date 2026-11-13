import { describe, expect, it } from "vitest";

import { curveSheetGroups, curveSheetLine, recordedSheetOf } from "./originCurveSheets";
import type { OriginFigure } from "./types";

const fig = (name: string, notes: [string, string][], layer = 1): OriginFigure => ({
  name, layer, x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
  n_curves: notes.length, annotations: [],
  curves: notes.map(([, y]) => ({ book: "Book1", x: "A", y })),
  curve_sheet_notes: notes.map(([recorded, y]) => ({ book: "Book1", x: "A", y, recorded })),
});

describe("curveSheetGroups / curveSheetLine", () => {
  it("groups one graph's curves of one book on one sheet into ONE line (DO.opj)", () => {
    const g1 = fig("Graph1", ["B", "D", "F", "C", "E", "G"].map((y) => ["Book1@6", y] as [string, string]));
    const lines = curveSheetGroups([g1], new Set(["Book1@6", "Book1@7"])).map(curveSheetLine);
    expect(lines).toEqual([
      "6 curves of Graph1 (Book1 columns B, D, F, C, E, G) are recorded on Book1@6; "
        + "the sheet the graph would otherwise use (Book1) is not in this import; use Recover to choose the sheet",
    ]);
  });

  it("keeps different sheets and layers apart, lists a column once, and words an imported book as 'plotted from'", () => {
    const a = fig("Graph2", [["Book1@2", "B"], ["Book1@2", "B"], ["Book1@3", "C"]]);
    const b = fig("Graph2", [["Book1@2", "D"]], 2);
    const lines = curveSheetGroups([a, b], new Set(["Book1", "Book1@2"])).map(curveSheetLine);
    expect(lines).toEqual([
      "1 curve of Graph2 (Book1 column B) is recorded on Book1@2 but plotted from Book1; check it, or use Recover to choose the sheet",
      "1 curve of Graph2 (Book1 column C) is recorded on Book1@3 but plotted from Book1; check it, or use Recover to choose the sheet",
      "1 curve of Graph2 layer 2 (Book1 column D) is recorded on Book1@2 but plotted from Book1; check it, or use Recover to choose the sheet",
    ]);
  });

  it("says nothing for a figure without notes", () => {
    const plain: OriginFigure = { ...fig("Graph1", []), curve_sheet_notes: undefined };
    expect(curveSheetGroups([plain], new Set())).toEqual([]);
    expect(recordedSheetOf(plain, "Book1", "B")).toBeUndefined();
  });
});
