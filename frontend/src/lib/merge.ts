// Merge (concatenate) several datasets row-wise into one (#19) — MATLAB
// "Data ▸ Merge Selected". Datasets are joined by column position, so they must
// share a column count; labels/units come from the first. Use the worksheet sort
// afterwards if the merged x needs ordering (concatenation preserves input order).

import type { DataStruct } from "./types";

/** Two level tables agree only if they're the SAME LENGTH and SAME ORDER —
 *  order encodes the code->string mapping (`levels[code]`), so a reordered
 *  table with identical strings is still a real mismatch (P1.4 review
 *  P2-1). */
function levelsEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

/** Per-channel merged `cat_levels` (P1.4 review P2-1, ruling): a channel's
 *  level table carries forward IFF every dataset has an IDENTICAL (same
 *  order) table for that channel -- codes are otherwise incoherent (code 0
 *  might mean "North" in one dataset and "East" in another). Any mismatch
 *  (differing strings/order, or one dataset missing the channel's table
 *  entirely) drops JUST that channel, not the whole merge. Real conflict
 *  resolution (remapping codes onto a union table) is booked under P1.5 --
 *  this is the safe, lossless-by-omission default until that lands.
 *  Returns `undefined` (never an empty object) when nothing survives. */
function mergedCatLevels(datasets: readonly DataStruct[], ncol: number): Record<number, string[]> | undefined {
  const out: Record<number, string[]> = {};
  for (let c = 0; c < ncol; c++) {
    const first = datasets[0].cat_levels?.[c];
    if (!first) continue;
    if (datasets.every((d) => { const t = d.cat_levels?.[c]; return t ? levelsEqual(t, first) : false; })) {
      out[c] = first;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** Concatenate ≥2 datasets row-wise. Throws on <2 inputs or a column-count
 *  mismatch. The result's labels/units are the first dataset's; metadata records
 *  the provenance. Arrays are copied (no aliasing of the source datasets).
 *  `cat_levels` merges per-channel -- see `mergedCatLevels`. */
export function mergeDatasets(datasets: DataStruct[], names: string[]): DataStruct {
  if (datasets.length < 2) {
    throw new Error("merge needs at least 2 datasets");
  }
  const ncol = datasets[0].labels.length;
  for (let i = 1; i < datasets.length; i++) {
    if (datasets[i].labels.length !== ncol) {
      throw new Error(
        `merge: column-count mismatch (${names[0]} has ${ncol}, ${names[i]} has ${datasets[i].labels.length})`,
      );
    }
  }
  const time: number[] = [];
  const values: number[][] = [];
  for (const d of datasets) {
    for (const t of d.time) time.push(t);
    for (const row of d.values) values.push([...row]);
  }
  const cat_levels = mergedCatLevels(datasets, ncol);
  return {
    time,
    values,
    labels: [...datasets[0].labels],
    units: [...datasets[0].units],
    metadata: {
      ...datasets[0].metadata,
      merged_from: names.join(" + "),
      merged_count: datasets.length,
    },
    ...(cat_levels ? { cat_levels } : {}),
  };
}
