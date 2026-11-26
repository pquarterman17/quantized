// Heatmap cell labels: how a cell's value is printed, which ink reads against
// the cell's colour, and when a cell is too small to label. Pure. The export
// (`src/quantized/calc/cell_labels.py`) applies the same three rules, pinned by
// `tests/fixtures/wire/annotation_measures.json`.

import { fmtFixed, fmtSig } from "./annotationMeasure";

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

function scientific(v: number, decimals: number): string {
  if (v === 0) return "0";
  const [mant, expS] = v.toExponential(decimals).split("e");
  const exp = Number(expS);
  return `${mant}e${exp >= 0 ? "+" : "-"}${Math.abs(exp)}`;
}

/** `v` as a cell label; a non-finite value has no label (`n/a`). */
export function formatCellValue(v: number, format: CellLabelFormat = "general", precision = 3): string {
  if (!Number.isFinite(v)) return "n/a";
  const p = Math.max(0, Math.min(MAX_CELL_PRECISION, Math.trunc(precision)));
  if (format === "fixed") return fmtFixed(v, p);
  if (format === "scientific") return scientific(v, p);
  return fmtSig(v, Math.max(1, p));
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** Black or white, whichever has the higher WCAG contrast against an sRGB
 *  colour (channels 0..255): white at a relative luminance of 0.179 or less. */
export function contrastTextColor(r: number, g: number, b: number): "#000000" | "#ffffff" {
  const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return lum <= 0.179 ? "#ffffff" : "#000000";
}

/** Whether `text` at `fontSize` fits a `cellW` x `cellH` cell (one unit). A
 *  label is as wide as its characters at 0.6 em plus 0.4 em of clear room and
 *  needs 1.2 em of height. */
export function cellLabelFits(cellW: number, cellH: number, text: string, fontSize: number): boolean {
  if (!text || fontSize <= 0) return false;
  return cellW >= text.length * fontSize * 0.6 + fontSize * 0.4 && cellH >= fontSize * 1.2;
}
