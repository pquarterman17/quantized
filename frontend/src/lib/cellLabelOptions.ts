// The map's cell-label option and its sanitizer, apart from the formatting in
// cellLabels.ts so the eager map-view reader (lib/mapView.ts) reaches only this.

export type CellLabelFormat = "general" | "fixed" | "scientific";

/** The map's cell-label option (`MapViewState.cellLabels`). Absent = off. */
export interface CellLabelOptions {
  format: CellLabelFormat;
  /** Significant digits (general) or decimals (fixed / scientific). */
  precision: number;
}

export const MAX_CELL_PRECISION = 8;

/** `{ cellLabels }` for a spread into a map view, or nothing when the stored option is not an object. */
export const cellLabelsField = (raw: unknown): { cellLabels?: CellLabelOptions } => {
  if (typeof raw !== "object" || raw === null) return {};
  const { format, precision: p } = raw as Record<string, unknown>;
  return {
    cellLabels: {
      format: format === "fixed" || format === "scientific" ? format : "general",
      precision: Math.max(0, Math.min(MAX_CELL_PRECISION, Number.isFinite(p) ? Math.round(p as number) : 3)),
    },
  };
};
