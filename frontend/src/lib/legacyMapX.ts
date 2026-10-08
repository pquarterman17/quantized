// Legacy 2-D map x on .dwk load. Before PR #532 every map importer (XRDML
// RSM/coupled maps, pole figures, Bruker .brml RSMs) set `.time` to the row
// index 0..N-1, so a saved map's Plot tab drew Intensity against the index
// under a "2-Theta" title. Since #532 the backend's `io/_map_schema.py`
// `map_datastruct` sets `.time` to the column `metadata.x_column_name` names
// and adds `default_value_channels = [Intensity]` and `default_trace =
// "Scatter"`. This applies the same result to an old save: only for a map
// (`is2D` / `mesh_kind` / `map_shape`) whose `.time` is EXACTLY the row index
// and whose x title names an existing column. A second load finds `.time`
// already set, so it is idempotent. Lazy-only (imported by the .dwk parse
// path), so none of this ships in the entry chunk.

import type { DataStruct, Dataset } from "./types";

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function isMap(meta: Record<string, unknown>): boolean {
  return meta.is2D === true || typeof meta.mesh_kind === "string" || Array.isArray(meta.map_shape);
}

/** The migrated struct, or null when `d` is not a legacy index-x map. */
function migrateStruct(d: DataStruct): DataStruct | null {
  const meta = d.metadata;
  const n = d.time.length;
  if (!n || !isMap(meta) || typeof meta.x_column_name !== "string") return null;
  const col = d.labels.findIndex((l) => norm(l) === norm(meta.x_column_name as string));
  if (col < 0 || !d.time.every((t, i) => t === i)) return null;
  const time = d.values.map((row) => row[col]);
  const intensity = d.labels.indexOf("Intensity");
  const hints: Record<string, unknown> = {};
  if (meta.default_value_channels === undefined && intensity >= 0) hints.default_value_channels = [intensity];
  if (meta.default_trace === undefined) hints.default_trace = "Scatter";
  return { ...d, time, metadata: { ...meta, ...hints } };
}

/** Migrate every legacy index-x map in `datasets` in place (`data`, and
 *  `raw` by the same rule). Returns the one-sentence warning, or null. */
export function migrateLegacyMapX(datasets: Dataset[]): string | null {
  let count = 0;
  for (const ds of datasets) {
    const data = migrateStruct(ds.data);
    if (!data) continue;
    ds.data = data;
    if (ds.raw) ds.raw = migrateStruct(ds.raw) ?? ds.raw;
    count++;
  }
  if (!count) return null;
  return count === 1
    ? "1 map saved by an older version now plots against its x column instead of the row index."
    : `${count} maps saved by an older version now plot against their x column instead of the row index.`;
}
