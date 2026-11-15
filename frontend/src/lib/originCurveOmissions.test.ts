import { describe, expect, it } from "vitest";

import { omittedCurveLines } from "./originCurveOmissions";
import type { OriginCurveSheetOmission, OriginFigure } from "./types";

const fig = (omitted?: OriginCurveSheetOmission[]): OriginFigure => ({
  name: "Graph1", layer: 1, x_from: 0, x_to: 1, x_log: false, y_from: 0, y_to: 1, y_log: false,
  n_curves: 0, annotations: [], curves: [], curve_sheet_omitted: omitted,
});

describe("omittedCurveLines", () => {
  it("names every left-out curve and words each reason against its recorded sheet", () => {
    const lines = omittedCurveLines(fig([
      { book: "Book1", x: "A", y: "B", recorded: "", reason: "sheet_unknown" },
      { book: "Book1", x: "A", y: "C", recorded: "Book1@3", reason: "x_sheet_unproven" },
      { book: "Cu5", x: "A", y: "B", recorded: "Cu5@2", reason: "book_not_imported" },
      { book: "Book2", x: "A", y: "D", recorded: "Book2@4", reason: "column_not_imported" },
      { book: "Book2", x: "B", y: "B", recorded: "Book2@5", reason: "y_is_sheet_x" },
      { book: "Book31", x: "H", y: "H", recorded: "Book31", reason: "y_is_x_column" },
      { book: "Book4", x: "A", y: "I", recorded: "Book4", reason: "x_token_differs" },
      { book: "Book7", x: "A", y: "B", recorded: "Book7", reason: "worksheet_filter" },
      { book: "Book3", x: "H", y: "B", recorded: "Book3", reason: "plot_type_not_drawn" },
      { book: "Book9", x: "", y: "E", recorded: "", reason: "some_new_reason" },
    ]));
    expect(lines).toEqual([
      "Book1 column B (X A): the sheet it plots could not be proven",
      "Book1 column C (X A): the sheet of its X column could not be proven (Y is on Book1@3)",
      "Cu5 column B (X A): sheet Cu5@2 was not imported",
      "Book2 column D (X A): that column of Book2@4 was not imported",
      "Book2 column B (X B): Book2@5 was imported with this column as its X",
      "Book31 column H (X H): it plots an X column, against an X stored in a form not decoded yet",
      "Book4 column I (X A): the graph stores another X for it, in a form not decoded yet",
      "Book7 column B (X A): its workbook has a data filter; Origin plots only the rows it keeps",
      "Book3 column B (X H): Origin draws it as a plot type not rebuilt here (e.g. a histogram)",
      "Book9 column E: some new reason",
    ]);
  });

  it("is empty for a figure with nothing left out", () => {
    expect(omittedCurveLines(fig())).toEqual([]);
  });
});
