// Append Project's remap of sheet() links.
// Bundle diet (origin gap audit 3 #15's funding): moved verbatim out of
// lib/sheetBindings.ts, whose other exports run at startup; only lazy modules
// call this half, so it no longer ships in the startup chunk. Imported by
// path; lib/sheetBindings.ts does not re-export it.

import { mapLinked } from "./sheetBindings";
import type { Dataset } from "./types";

/** An appended project's datasets: links are remapped through `idMap` (old
 *  id -> new id), like `bgRef`; one whose target was not part of the append
 *  is cut. Returns how many links were cut. */
export function remapSheetRefIds(incoming: readonly Dataset[], idMap: ReadonlyMap<string, string>): { datasets: Dataset[]; dropped: number } {
  let dropped = 0;
  const { datasets } = mapLinked(incoming, (f) => ({
    ...f,
    sheets: f.sheets!.map((b) => {
      if (b.id === null) return b;
      const id = idMap.get(b.id) ?? null;
      if (id === null) dropped++;
      return { ...b, id };
    }),
  }));
  return { datasets, dropped };
}

/** An appended project's formulas' `rng("Name")` links: followed through the append's range id table (a range whose id
 *  was taken here has a new one); a link to a range that did not come along is cut. Returns how many were cut. */
export function remapRangeRefIds(incoming: readonly Dataset[], rangeIds: ReadonlyMap<string, string>): { datasets: Dataset[]; dropped: number } {
  let dropped = 0;
  const datasets = incoming.map((d) => {
    if (!d.formulas?.some((f) => f.ranges?.length)) return d;
    return {
      ...d,
      formulas: d.formulas.map((f) =>
        f.ranges?.length
          ? {
              ...f,
              ranges: f.ranges.map((b) => {
                const id = b.id === null ? null : (rangeIds.get(b.id) ?? null);
                if (b.id !== null && id === null) dropped++;
                return { ...b, id };
              }),
            }
          : f,
      ),
    };
  });
  return { datasets, dropped };
}
