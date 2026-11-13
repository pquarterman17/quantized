// The EAGER, tokenizer-free half of cross-worksheet formula links (see
// lib/sheetRefs.ts for the model): what code on the store's synchronous paths
// needs without the lazy formula module — which worksheets a column is linked
// to (the recalc graph), cutting the links of removed worksheets, and
// remapping them through an Append Project id table.

import type { ComputedColumn, Dataset } from "./types";

/** The worksheet ids a computed column is linked to through `sheet(…)`. */
export function sheetIdsRead(f: ComputedColumn): string[] {
  return (f.sheets ?? []).flatMap((b) => (b.id === null ? [] : [b.id]));
}

function mapLinked(datasets: readonly Dataset[], fn: (f: ComputedColumn) => ComputedColumn): { datasets: Dataset[]; changed: string[] } {
  const changed: string[] = [];
  const out = datasets.map((d) => {
    if (!d.formulas?.some((f) => f.sheets?.length)) return d;
    const formulas = d.formulas.map((f) => (f.sheets?.length ? fn(f) : f));
    if (formulas.every((f, i) => f === d.formulas![i])) return d;
    changed.push(d.id);
    return { ...d, formulas };
  });
  return { datasets: changed.length ? out : (datasets as Dataset[]), changed };
}

/** Worksheets `ids` were removed: their links are cut (`id: null`), so the
 *  formulas error instead of freezing on their last values — and never
 *  re-attach to a later worksheet that happens to carry the same name. */
export function cutSheetRefs(datasets: readonly Dataset[], ids: ReadonlySet<string>): { datasets: Dataset[]; changed: string[] } {
  return mapLinked(datasets, (f) =>
    f.sheets!.some((b) => b.id !== null && ids.has(b.id))
      ? { ...f, sheets: f.sheets!.map((b) => (b.id !== null && ids.has(b.id) ? { ...b, id: null } : b)) }
      : f,
  );
}

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
