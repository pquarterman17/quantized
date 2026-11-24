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
      { book: "Book2", x: "A", y: "E", recorded: "Book2@4", reason: "x_not_imported" },
      { book: "Book1A", x: "A", y: "B", recorded: "Book1A@2", reason: "sheet_x_not_found" },
      { book: "Book2", x: "B", y: "B", recorded: "Book2@5", reason: "y_is_sheet_x" },
      { book: "Book31", x: "H", y: "H", recorded: "Book31", reason: "y_is_x_column" },
      { book: "Book4", x: "A", y: "I", recorded: "Book4", reason: "x_token_differs" },
      { book: "Book7", x: "A", y: "B", recorded: "Book7", reason: "worksheet_filter" },
      { book: "Book3", x: "H", y: "B", recorded: "Book3", reason: "plot_type_not_drawn" },
      { book: "Lockin", x: "AE", y: "E", recorded: "Lockin", reason: "hidden_in_origin" },
      { book: "Book9", x: "", y: "E", recorded: "", reason: "some_new_reason" },
    ]));
    expect(lines).toEqual([
      "Book1 column B (X A): the sheet it plots could not be proven",
      "Book1 column C (X A): the sheet of its X column could not be proven (Y is on Book1@3)",
      "Cu5 column B (X A): sheet Cu5@2 was not imported",
      "Book2 column D (X A): that column of Book2@4 was not imported",
      "Book2 column E (X A): its X column on Book2@4 was not imported (often a text column)",
      "Book1A column B (X A): no X column was found on Book1A@2; Origin may plot it by row or column position",
      "Book2 column B (X B): Book2@5 was imported with this column as its X",
      "Book31 column H (X H): it plots an X column, against an X stored in a form not decoded yet",
      "Book4 column I (X A): the graph stores another X for it, in a form not decoded yet",
      "Book7 column B (X A): its workbook has a data filter whose condition is not proven yet; Origin plots only the rows it keeps",
      "Book3 column B (X H): Origin draws it as a plot type not rebuilt here (e.g. a histogram)",
      "Lockin column E (X AE): hidden in the Origin graph (Origin does not draw it); its column is still imported",
      "Book9 column E: some new reason",
    ]);
  });

  it("words every reason the .opju reader emits for a plot type it does not rebuild", () => {
    const reasons = [
      "x_not_a_column", "x_column_unknown", "x_other_book", "plot_row_range", "error_bar_plot",
      "box_kind_not_decoded", "stat_layer_in_multi_layer_page", "stat_layer_of_several_books",
      "histogram_of_several_columns", "stat_plot_x_not_decoded", "map_plot_not_decoded",
    ];
    const lines = omittedCurveLines(fig(reasons.map((reason) => ({ book: "B", x: "A", y: "C", recorded: "B", reason }))));
    lines.forEach((line, i) => {
      expect(line.startsWith("B column C (X A): ")).toBe(true);
      expect(line).not.toBe(`B column C (X A): ${reasons[i].replaceAll("_", " ")}`); // worded, not the raw-code fallback
    });
  });

  it("words an .opj plot whose column or X could not be resolved", () => {
    const lines = omittedCurveLines(
      fig([
        { book: "", x: "", y: "", recorded: "", reason: "column_not_resolved" },
        { book: "Ghost", x: "", y: "Q", recorded: "Ghost", reason: "x_not_resolved" },
      ]),
    );
    expect(lines).toEqual([
      "A plot: the column it plots could not be identified in the project",
      "Ghost column Q: no X column could be inferred for its workbook",
    ]);
  });

  it("is empty for a figure with nothing left out", () => {
    expect(omittedCurveLines(fig())).toEqual([]);
  });
});
