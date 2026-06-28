// Merge (concatenate) several datasets row-wise into one (#19) — MATLAB
// "Data ▸ Merge Selected". Datasets are joined by column position, so they must
// share a column count; labels/units come from the first. Use the worksheet sort
// afterwards if the merged x needs ordering (concatenation preserves input order).

import type { DataStruct } from "./types";

/** Concatenate ≥2 datasets row-wise. Throws on <2 inputs or a column-count
 *  mismatch. The result's labels/units are the first dataset's; metadata records
 *  the provenance. Arrays are copied (no aliasing of the source datasets). */
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
  };
}
