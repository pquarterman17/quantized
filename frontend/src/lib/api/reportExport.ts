// `/api/report/export` wrapper (P3.6) — split from ./report, which is eager
// (reportEmit's folder-actions caller), because its ONLY caller is the lazy
// report viewer (components/workshops/report/ReportPanel.tsx): the warnings-
// header decoding below would otherwise ride the eager bundle for nothing.
// NOT re-exported by lib/api.ts; import it from this path.

import { postDownloadHeaders } from "./http";
import type { ReportSheet } from "../report";

/** What a report export says about itself beyond the file (P3.6): the
 *  backend's per-figure render/embed warnings (`X-Report-Warnings`, the first
 *  few, each truncated) and their TRUE total (`X-Report-Warning-Count`). */
export interface ReportExportResult {
  warnings: string[];
  warningCount: number;
}

/** Decode the warning headers defensively: a malformed header degrades to "no
 *  readable text" but keeps the count, and never throws after the file was
 *  already saved. */
export function parseReportWarnings(h: Headers): ReportExportResult {
  let warnings: string[] = [];
  try {
    const raw: unknown = JSON.parse(h.get("X-Report-Warnings") ?? "[]");
    if (Array.isArray(raw)) warnings = raw.filter((w): w is string => typeof w === "string");
  } catch {
    /* unreadable header — the count below still says something went wrong */
  }
  const n = Number(h.get("X-Report-Warning-Count") ?? 0);
  return { warnings, warningCount: Math.max(warnings.length, Number.isFinite(n) ? n : 0) };
}

/** The formats `/api/report/export` renders (`routes.report_export._EXT`). */
export type ExportFormat = "html" | "latex" | "docx" | "pptx";

/** Render a report sheet server-side and download it (.html/.tex/.docx/.pptx);
 *  resolves with the export's warnings once the file is saved. `signal`: the
 *  report viewer's StatusBar Cancel (P3.4); a cancelled export saves nothing. */
export async function reportExport(
  report: ReportSheet,
  format: ExportFormat,
  filename: string,
  signal?: AbortSignal,
): Promise<ReportExportResult> {
  return parseReportWarnings(
    await postDownloadHeaders("/api/report/export", { report, format, filename }, filename, signal),
  );
}
