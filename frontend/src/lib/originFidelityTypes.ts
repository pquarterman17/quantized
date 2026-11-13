// Origin import-fidelity wire types (backend io/origin_project/fidelity.py
// + integrity.py): the per-figure and per-project decode report and the
// saved-preview diagnostics it carries. Split out of lib/types.ts under its
// module-size ceiling; types.ts re-exports every name, so importers are
// unchanged.

import type { OriginWorksheetFidelity } from "./originWorksheetTypes";

export type OriginFidelityStatus = "exact" | "best_effort" | "reference_only" | "unresolved";

export interface OriginFigureFidelity {
  status: OriginFidelityStatus;
  recovered: string[];
  omissions: string[];
}

/** A curve whose column the `.opj` records on sheet `recorded` (`Book@N`),
 *  while its binding names `book` (`opj_curve_sheets`). The binding is kept;
 *  `lib/originCurveSheets.ts` words it against the books actually imported. */
export interface OriginCurveSheetNote {
  book: string;
  x: string;
  y: string;
  recorded: string;
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

export interface OriginFilteredFigure {
  index: number;
  name: string;
  layer: number | null;
  reason: string;
}

/** File length vs the size the project's own header records. */
export interface OriginContainerIntegrity {
  checked: boolean;
  /** null: not checkable, or longer than recorded (unverified). */
  complete: boolean | null;
  file_bytes: number;
  declared_bytes: number | null;
  detail: string;
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
  /** File length vs the size its header records (backend
   *  io/origin_project/integrity.py). A truncated file also lists the
   *  `file_truncated` omission. Optional: older workspaces lack it. */
  container_integrity?: OriginContainerIntegrity;
  /** `.opju` only (see ./originWorksheetTypes); absent for `.opj`. */
  worksheet?: OriginWorksheetFidelity;
  /** `.opj` graph windows present in the file but not recovered (backend
   *  io/origin_project/opj_graph_windows.py), by window name; with the
   *  `graph_windows_not_recovered` omission. */
  unrecovered_graphs?: string[];
}
