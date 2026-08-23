// /api/report/* wrappers — split out of lib/api.ts (R8 bundle-diet pass,
// 2026-08-23) purely to shrink that pinned file (JMP_GAP #14); UNLIKE most
// of that pass's other extractions, this one IS re-exported by lib/api.ts
// (`export * from "./api/report"`, no consumer update needed): workshops/
// pipeline/runTemplate.ts calls `reportEmit` from the always-eager Library
// folder-actions path (folderOps.ts -> runTemplateOnDataset), so this file
// is genuinely, unavoidably eager — but since it holds only these two tiny
// wrappers (nothing else to drag along), co-locating them costs nothing
// extra, unlike lib/api.ts's old calculator/stats sprawl.

import { postDownload, postJSON } from "./http";
import type { ReportSheet } from "../report";

/** Shape an analysis result into a #36 report sheet via the backend emitters
 *  (one emission source of truth — the frontend never re-shapes results). */
export function reportEmit(body: {
  kind: "curve_fit" | "multipeak_fit" | "integrate" | "batch_integrate" | "anova" | "stats_table";
  result?: Record<string, unknown>;
  records?: Record<string, unknown>[];
  title?: string;
  model_name?: string;
  param_names?: string[];
  param_units?: string[];
  columns?: string[];
  caption?: string;
  source_refs?: { kind: string; id: string; name?: string }[];
}): Promise<{ report: ReportSheet }> {
  return postJSON("/api/report/emit", body);
}

/** Render a report sheet server-side and download it (.html/.tex/.docx/.pptx). */
export function reportExport(
  report: ReportSheet,
  format: "html" | "latex" | "docx" | "pptx",
  filename: string,
): Promise<void> {
  return postDownload("/api/report/export", { report, format, filename }, filename);
}
