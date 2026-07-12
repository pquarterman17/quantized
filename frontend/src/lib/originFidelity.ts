import type { OriginFidelityManifest, OriginFidelityStatus } from "./types";

export interface OriginFidelityEntry {
  id: string;
  stem: string;
  siblingIds: string[];
  manifest: OriginFidelityManifest;
}

const LABELS: Record<string, string> = {
  advanced_axis_types: "advanced axis types",
  exact_curve_bindings: "exact curve bindings",
  figure_decode_error: "graph decode failed",
  filtered_internal_graph_records: "internal graph records filtered",
  graphic_objects: "drawn arrows and shapes",
  layer_geometry: "layer geometry",
  no_graph_records: "no graph records found",
  rich_text_run_formatting: "per-run rich-text formatting",
  saved_graph_preview: "saved Origin preview",
  some_curve_colors: "some curve colors",
  some_curve_styles: "some curve styles",
};

export function originFidelityLabel(code: string): string {
  return LABELS[code] ?? code.replaceAll("_", " ");
}

export function originFidelityStatusLabel(status: OriginFidelityStatus): string {
  if (status === "best_effort") return "Best effort";
  if (status === "reference_only") return "Reference only";
  return status === "exact" ? "Exact" : "Unresolved";
}
