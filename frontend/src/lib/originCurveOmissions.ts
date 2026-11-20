// Wording for `.opju` graph curves LEFT OUT of their graph
// (`OriginFigure.curve_sheet_omitted`, from
// `io/origin_project/opju_curve_sheets.py`): the reader omits a curve rather
// than draw it from a sheet, X or rows it cannot prove. The fidelity codes
// (`curve_sheet_unresolved`, `curves_left_out`, `error_bar_plots`) only say
// "some curves"; these lines name each one and why. Only the lazy Recover window imports this module.

import type { OriginCurveSheetOmission, OriginFigure } from "./types";

const WHY: Record<string, (recorded: string) => string> = {
  sheet_unknown: () => "the sheet it plots could not be proven",
  x_sheet_unproven: (r) => `the sheet of its X column could not be proven${r ? ` (Y is on ${r})` : ""}`,
  book_not_imported: (r) => `sheet ${r} was not imported`,
  column_not_imported: (r) => `that column of ${r} was not imported`,
  x_not_imported: (r) => `its X column on ${r} was not imported (often a text column)`,
  sheet_x_not_found: (r) => `no X column was found on ${r}; Origin may plot it by row or column position`,
  error_bar_plot: () => "it is an error-bar plot; its bars draw only from a decoded error column",
  y_is_sheet_x: (r) => `${r} was imported with this column as its X`,
  y_is_x_column: () => "it plots an X column, against an X stored in a form not decoded yet",
  x_token_differs: () => "the graph stores another X for it, in a form not decoded yet",
  worksheet_filter: () => "its workbook has a data filter; Origin plots only the rows it keeps",
  plot_type_not_drawn: () => "Origin draws it as a plot type not rebuilt here (e.g. a histogram)",
  hidden_in_origin: () => "hidden in the Origin graph (Origin does not draw it); its column is still imported",
  x_not_a_column: () => "Origin plots it against row numbers or bins, not an X column",
  x_column_unknown: () => "its X column could not be found in the project",
  x_other_book: () => "its X column is in another workbook",
  plot_row_range: () => "Origin plots only part of its rows; that range is not rebuilt here",
  error_bar_plot: () => "it is an error-bar plot, not rebuilt as a curve here",
  box_kind_not_decoded: () => "its box-chart kind (box, violin, strip…) could not be read",
  stat_layer_in_multi_layer_page: () => "a statistics plot in a multi-panel graph is not rebuilt here",
  stat_layer_of_several_books: () => "a statistics plot drawn from several workbooks is not rebuilt here",
  histogram_of_several_columns: () => "a histogram of several columns is not rebuilt here (one column at a time is)",
  stat_plot_x_not_decoded: () => "Origin draws it as a box chart or histogram from an X not decoded yet",
  map_plot_not_decoded: () => "it is a heatmap or contour whose data could not be bound",
  data_not_saved: (r) => `${r} is linked to an external file (Origin Data Connector) and its data was not saved in the project`,
};

/** One line per omitted curve of `figure`, e.g. "Book1 column B (X A): the
 *  sheet it plots could not be proven". */
export function omittedCurveLines(figure: OriginFigure): string[] {
  return ((figure.curve_sheet_omitted ?? []) as OriginCurveSheetOmission[]).map((o) => {
    const why = WHY[o.reason]?.(o.recorded) ?? o.reason.replaceAll("_", " ");
    return `${o.book} column ${o.y}${o.x ? ` (X ${o.x})` : ""}: ${why}`;
  });
}
