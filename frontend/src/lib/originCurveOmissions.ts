// Wording for `.opju` graph curves LEFT OUT of their graph
// (`OriginFigure.curve_sheet_omitted`, from
// `io/origin_project/opju_curve_sheets.py`): the reader omits a curve rather
// than draw it from a sheet it cannot prove. The fidelity code
// `curve_sheet_unresolved` only says "some curves"; these lines name each one
// and why. Only the lazy Recover window imports this module.

import type { OriginCurveSheetOmission, OriginFigure } from "./types";

const WHY: Record<string, (recorded: string) => string> = {
  sheet_unknown: () => "the sheet it plots could not be proven",
  x_sheet_unproven: (r) => `the sheet of its X column could not be proven${r ? ` (Y is on ${r})` : ""}`,
  book_not_imported: (r) => `sheet ${r} was not imported`,
  column_not_imported: (r) => `that column of ${r} was not imported`,
  y_is_sheet_x: (r) => `${r} was imported with this column as its X`,
  y_is_x_column: () => "it plots an X column, against an X stored in a form not decoded yet",
  x_token_differs: () => "the graph stores another X for it, in a form not decoded yet",
  worksheet_filter: () => "its workbook has a data filter; Origin plots only the rows it keeps",
  plot_type_not_drawn: () => "Origin draws it as a plot type not rebuilt here (e.g. a histogram)",
};

/** One line per omitted curve of `figure`, e.g. "Book1 column B (X A): the
 *  sheet it plots could not be proven". */
export function omittedCurveLines(figure: OriginFigure): string[] {
  return ((figure.curve_sheet_omitted ?? []) as OriginCurveSheetOmission[]).map((o) => {
    const why = WHY[o.reason]?.(o.recorded) ?? o.reason.replaceAll("_", " ");
    return `${o.book} column ${o.y}${o.x ? ` (X ${o.x})` : ""}: ${why}`;
  });
}
