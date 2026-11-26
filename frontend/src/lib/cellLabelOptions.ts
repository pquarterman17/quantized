// The map's cell-label option and its sanitizer, apart from the formatting in
// cellLabels.ts so the eager map-view reader (lib/mapView.ts) reaches only this.

export type CellLabelFormat = "general" | "fixed" | "scientific";

/** The map's cell-label option (`MapViewState.cellLabels`). Absent = off. */
export interface CellLabelOptions {
  format: CellLabelFormat;
  /** Significant digits (general) or decimals (fixed / scientific). */
  precision: number;
}

export const CELL_FORMATS: readonly CellLabelFormat[] = ["general", "fixed", "scientific"];
export const DEFAULT_CELL_LABELS: CellLabelOptions = { format: "general", precision: 3 };
export const MAX_CELL_PRECISION = 8;

/** A stored option, or undefined for anything that is not a valid one. */
export function sanitizeCellLabels(raw: unknown): CellLabelOptions | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const format = CELL_FORMATS.find((f) => f === o.format) ?? "general";
  const p = typeof o.precision === "number" && Number.isFinite(o.precision) ? Math.round(o.precision) : 3;
  return { format, precision: Math.max(0, Math.min(MAX_CELL_PRECISION, p)) };
}
