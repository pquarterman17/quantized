import type { OriginFidelityManifest, OriginFidelityStatus } from "./types";

export interface OriginFidelityEntry {
  id: string;
  stem: string;
  siblingIds: string[];
  manifest: OriginFidelityManifest;
}

const LABELS: Record<string, string> = {
  advanced_axis_types: "advanced axis types",
  curve_sheet_mismatch: "curves to check: recorded on another sheet",
  exact_curve_bindings: "exact curve bindings",
  figure_decode_error: "graph decode failed",
  graph_content_unattributed: "graph content found but its window not identified",
  graphs_not_recovered: "graphs present but not recovered",
  file_truncated: "file appears incomplete or truncated — books and columns past the cut are missing",
  filtered_internal_graph_records: "internal graph records filtered",
  graphic_objects: "drawn arrows and shapes",
  layer_geometry: "layer geometry",
  line_symbol_mode: "line + symbol mode",
  line_width: "line widths",
  no_graph_records: "no graph records found",
  rich_text_run_formatting: "per-run rich-text formatting",
  saved_graph_preview: "saved Origin preview",
  some_curve_colors: "some curve colors",
  some_curve_styles: "some curve styles",
  symbol_size: "symbol sizes",
};

export function originFidelityLabel(code: string): string {
  return LABELS[code] ?? code.replaceAll("_", " ");
}

export function originFidelityStatusLabel(status: OriginFidelityStatus): string {
  if (status === "best_effort") return "Best effort";
  if (status === "reference_only") return "Reference only";
  return status === "exact" ? "Exact" : "Unresolved";
}

/** The import toast for one Origin project. Worksheet data that was NOT
 *  imported leads (it is data the user may be missing, so the toast is a
 *  warning); the per-kind detail lives in the Library's Origin fidelity
 *  entry and each book's Origin provenance card. */
export function originImportToast(
  stem: string,
  m: OriginFidelityManifest,
): { msg: string; kind: "info" | "danger" } {
  const graphs = `${m.graph_records_actionable}/${m.graph_records_total} Origin graph records are editable`;
  const lost = (m.worksheet?.losses ?? []).reduce((n, loss) => n + loss.count, 0);
  const missedGraphs = m.unrecovered_graph_count ?? 0;
  const parts: string[] = [];
  if (lost > 0) parts.push(lost === 1 ? "1 worksheet item" : `${lost} worksheet items`);
  if (missedGraphs > 0) parts.push(missedGraphs === 1 ? "1 graph" : `${missedGraphs} graphs`);
  else if (m.omissions.includes("graph_content_unattributed")) parts.push("graph content");
  if (parts.length > 0) {
    return { msg: `${stem}: ${parts.join(" and ")} could not be imported. ${graphs}`, kind: "danger" };
  }
  return { msg: `${stem}: ${graphs}; fidelity details saved`, kind: "info" };
}
