// The metadata-key gate of the `.dwk` version ladder (ROW_RANGE_CONTRACT 9.1), split out of
// `workspaceForwardCompat.ts` to keep that module under its size ceiling. Pure and self-contained.

/** Private sidecar keys in a dataset's `data.metadata` that an older release would carry but not maintain,
 *  so a file holding one is written as the top rung (ROW_RANGE_CONTRACT 9.1). A key listed here is gated
 *  whether or not code writes it yet. Cell notes (`__quantized_cell_notes`, slice R6): older releases do not
 *  slice them on a row operation, so a note would reattach to the wrong row. The input row range
 *  (`__quantized_input_row_range`, OG20): an output worksheet committed from a tool that read a row range; an older
 *  release would show the output as if it had read every row, and the key is user-visible provenance. DELIBERATELY NOT LISTED:
 *  `__quantized_source_rows` (slice R3, an Extract's link back to its source rows): the contract's review
 *  amendment classifies it as a field older releases may drop, because they lose only the link, never data,
 *  and gating it would refuse every project holding an Extract. Gate it by adding it here. Each entry
 *  becomes the feature `Dataset.metadata.<key>` in NEW_SINCE_V045 (the top rung; see the ladder rule below). */
export const GATED_METADATA_KEYS: readonly string[] = ["__quantized_cell_notes", "__quantized_input_row_range"];
export const metadataFeature = (k: string): string => `Dataset.metadata.${k}`;

/** The gated features (`Dataset.metadata.<key>`) one serialized dataset holds, in its `data` or `raw` metadata. */
export function metadataFeaturesOf(d: unknown): string[] {
  if (typeof d !== "object" || d === null) return [];
  const out: string[] = [];
  for (const part of [(d as { data?: unknown }).data, (d as { raw?: unknown }).raw]) {
    const md = typeof part === "object" && part !== null ? (part as { metadata?: unknown }).metadata : undefined;
    if (typeof md !== "object" || md === null) continue;
    for (const k of GATED_METADATA_KEYS) {
      const v = (md as Record<string, unknown>)[k];
      // Empty is absent: a sheet whose last note was deleted needs no gate.
      if (v !== undefined && v !== null && v !== false && !(typeof v === "object" && Object.keys(v).length === 0)) out.push(metadataFeature(k));
    }
  }
  return out;
}
