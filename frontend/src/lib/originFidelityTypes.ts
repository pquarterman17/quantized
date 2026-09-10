// Origin project-level graph-decode FIDELITY types (ORIGIN_FILE_DECODE_PLAN
// #38/#49): the versioned manifest an .opj/.opju import carries alongside its
// books, plus the saved page previews and the diagnostics for the pages that
// could not be decoded.
//
// Extracted out of lib/types.ts (which sits on a pinned module-size ratchet)
// as the same cohesive-sibling move already made for lib/importTypes.ts,
// lib/reductionTypes.ts and lib/errorRoles.ts — see the re-export notes at the
// bottom of types.ts. Every name here is re-exported from lib/types.ts, so
// existing import paths are unchanged and this file is a pure re-home.
//
// These live OUTSIDE `DataStruct.metadata` deliberately: decode fidelity is a
// statement about the reader, not about the specimen, and must never be able
// to masquerade as scientific dataset metadata. `store/originFidelity.ts`
// consumes the manifest on import.

/** How completely a graph (or a whole project) was recovered. `unresolved` is
 *  the fail-closed default — see docs/origin_re/curve_axis_fidelity.md. */
export type OriginFidelityStatus = "exact" | "best_effort" | "reference_only" | "unresolved";

export interface OriginFigureFidelity {
  status: OriginFidelityStatus;
  recovered: string[];
  omissions: string[];
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
