// Origin project-level fidelity manifest types (backend
// io/origin_project/fidelity.py + integrity.py), split out of lib/types.ts
// under its module-size ceiling and re-exported from there.

import type { OriginFidelityStatus, OriginPreviewDiagnostic } from "./types";

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
}
