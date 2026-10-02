// The x-axis title of a "Plot selected together" overlay. Loaded on demand by
// lib/plotSelectedTogether.ts (an eager module), so the code stays off the
// eager bundle.

import type { Dataset, DataStruct } from "./types";

/** Title `data`'s x axis from the overlaid datasets' own x names and units.
 *  `assembleOverlay` (lib/originOverlay.ts) stores the Origin column letter
 *  "A" and only an Origin book's long name, so a plain selection's x read
 *  "A (deg)". Every distinct x quantity is named, so a K and an Oe sweep never
 *  share the first one's title. Datasets with no x name are ignored; when none
 *  has one, `data` keeps what `assembleOverlay` wrote. */
export function withSelectionXTitle(data: DataStruct, sources: readonly Dataset[]): DataStruct {
  const xs = new Map<string, [string, string]>();
  for (const ds of sources) {
    const m = ds.data.metadata ?? {};
    const name = String(m.x_column_long || m.x_column_name || "");
    const unit = String(m.x_column_unit ?? "");
    if (name) xs.set(`${name}\0${unit}`, [name, unit]);
  }
  const pairs = [...xs.values()];
  if (pairs.length === 0) return data;
  const [x_column_long, x_column_unit] =
    pairs.length === 1 ? pairs[0] : [pairs.map(([n, u]) => (u ? `${n} (${u})` : n)).join(" / "), ""];
  return { ...data, metadata: { ...data.metadata, x_column_long, x_column_unit } };
}
