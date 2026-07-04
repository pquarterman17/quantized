// Surface a DataStruct's free-form .metadata dict (instrument header fields —
// sample, temperature, comments, raw header keys…) for the Inspector card. Pure
// + testable; the card just renders these rows.

/** Format a metadata value for display: scalars as-is, objects/arrays as compact
 *  JSON, null/undefined as a dash. */
export function formatMetaValue(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Flatten a metadata record into sorted [key, formattedValue] rows. The
 *  internal plot-x hints (`x_column_name`/`x_column_unit`) are dropped — they're
 *  wiring, not instrument metadata, and already shown as the X column. The
 *  Origin provenance keys (`origin_results_log[_records]`, `origin_notes`) are
 *  also dropped — they have their own dedicated Inspector card
 *  (OriginProvenanceCard) that renders them readably instead of as raw
 *  text/JSON rows. */
export function metadataRows(metadata: Record<string, unknown>): [string, string][] {
  const hidden = new Set([
    "x_column_name",
    "x_column_unit",
    "origin_results_log",
    "origin_results_log_records",
    "origin_notes",
  ]);
  return Object.keys(metadata)
    .filter((k) => !hidden.has(k))
    .sort((a, b) => a.localeCompare(b))
    .map((k) => [k, formatMetaValue(metadata[k])]);
}

/** Tab-separated `key\tvalue` lines for the "Copy metadata" button. */
export function metadataToTSV(metadata: Record<string, unknown>): string {
  return metadataRows(metadata)
    .map(([k, v]) => `${k}\t${v}`)
    .join("\n");
}
