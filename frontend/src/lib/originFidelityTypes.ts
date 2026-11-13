// Origin import-fidelity wire types (`io/origin_project/fidelity.py`):
// the per-figure and per-project decode report. Split out of `./types`
// (module-size ceiling); `./types` re-exports every name, so importers are
// unchanged.

export type OriginFidelityStatus = "exact" | "best_effort" | "reference_only" | "unresolved";

export interface OriginFigureFidelity {
  status: OriginFidelityStatus;
  recovered: string[];
  omissions: string[];
  /** One sentence per curve to check (`fidelity._sheet_notes`), e.g. a curve
   *  whose column the file records on another sheet than it is plotted from. */
  notes?: string[];
}

/** A curve whose column the `.opj` records on sheet `recorded` (`Book@N`),
 *  while its binding names `book` (`opj_curve_sheets`). The binding is kept;
 *  `plotted_from` is `book` when that is an imported sheet, else `""`. */
export interface OriginCurveSheetNote {
  book: string;
  x: string;
  y: string;
  recorded: string;
  plotted_from: string;
}

export interface OriginFilteredFigure {
  index: number;
  name: string;
  layer: number | null;
  reason: string;
}

export interface OriginSavedPreview {
  format: "png";
  mime: "image/png";
  width: number;
  height: number;
  sha256: string;
  data: string;
  confidence: "exact_page" | "ambiguous_page";
  page_name: string;
}

export interface OriginPreviewDiagnostic {
  page_name: string;
  status: "no_preview" | "ambiguous" | "workbook_thumbnail";
  asset_count: number;
  assets?: OriginSavedPreview[];
}

export interface OriginFidelityManifest {
  version: 1;
  container: "opj" | "opju";
  status: OriginFidelityStatus;
  graph_records_total: number;
  graph_records_actionable: number;
  graph_records_filtered: number;
  omissions: string[];
  filtered_figures: OriginFilteredFigure[];
  /** Optional for backward compatibility with #49 workspaces. */
  preview_diagnostics?: OriginPreviewDiagnostic[];
}
