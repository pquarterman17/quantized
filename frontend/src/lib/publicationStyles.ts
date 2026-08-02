/** Publication wire styles plus their persistence sanitizer. Kept separate
 * from exportStyles so FigureDocument persistence never pulls screen colour code
 * into the eager store bundle. */
export interface ExportSeriesStyle {
  color?: string;
  width?: number;
  /** `none` is the publication-renderer representation of point-only scatter. */
  line?: "solid" | "dashed" | "dotted" | "none";
  marker?: boolean;
  marker_size?: number;
  /** `vs` and `color_by` remain dataset channel indices on the wire. */
  fill?: "under" | { vs: number };
  color_by?: number;
  colormap?: string;
}

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/** Safely restore exact publication-series wire styles from persisted input. */
export function sanitizeExportSeriesStyles(value: unknown): (ExportSeriesStyle | null)[] | null {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  return value.map((entry): ExportSeriesStyle | null => {
    if (entry === null) return null;
    const raw = object(entry);
    if (!raw) return null;
    const style: ExportSeriesStyle = {};
    if (typeof raw.color === "string") style.color = raw.color;
    if (typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width >= 0) style.width = raw.width;
    if (raw.line === "solid" || raw.line === "dashed" || raw.line === "dotted" || raw.line === "none") style.line = raw.line;
    if (typeof raw.marker === "boolean") style.marker = raw.marker;
    if (typeof raw.marker_size === "number" && Number.isFinite(raw.marker_size) && raw.marker_size >= 0) style.marker_size = raw.marker_size;
    if (raw.fill === "under") style.fill = raw.fill;
    else {
      const fill = object(raw.fill);
      if (fill && Number.isInteger(fill.vs) && (fill.vs as number) >= 0) style.fill = { vs: fill.vs as number };
    }
    if (Number.isInteger(raw.color_by) && (raw.color_by as number) >= 0) style.color_by = raw.color_by as number;
    if (typeof raw.colormap === "string") style.colormap = raw.colormap;
    return Object.keys(style).length ? style : null;
  });
}
