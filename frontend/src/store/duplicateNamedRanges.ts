// A COPIED worksheet reads its OWN named ranges (ROW_RANGE_CONTRACT 5.2 is silent on a copy, so this fails closed).
// Duplicating a sheet copies its formulas, and a copied `rng("Baseline")` still holds the original's range id: left
// alone, the copy would silently read the ORIGINAL's block, so editing the copy's cells would not move its own results.
// Instead each named range of the original that a copied formula reads gets a copy of its own, aimed at the copy's block
// and scoped to the copy, and the copied formulas are re-bound to it. A range of ANOTHER sheet that the original read
// is left as it was (the copy reads it too, exactly as a copied `sheet()` link still reads its source sheet). A name the
// copy's group already holds gets "(copy)" appended; the copied formula's text follows. Lazy, with the Duplicate gesture.

import { nameClash, newNamedRangeId, type NamedRange } from "../lib/namedRanges";
import { rangeCalls } from "../lib/rangeRefs";
import type { ComputedColumn, Dataset } from "../lib/types";

export interface CopiedRanges {
  /** The clone's formulas, re-bound (or `undefined` when the clone has none). */
  formulas: ComputedColumn[] | undefined;
  /** The state to add to the duplicate's own update: the new ranges and the status line; empty when none were copied. */
  patch: { namedRanges?: NamedRange[]; status?: string };
}

export function copyRangesForClone(
  ranges: readonly NamedRange[],
  source: Pick<Dataset, "id">,
  clone: Pick<Dataset, "id" | "workbookId">,
  datasets: readonly Pick<Dataset, "id" | "workbookId">[],
  formulas: ComputedColumn[] | undefined,
): CopiedRanges {
  const out = [...ranges];
  const made = new Map<string, NamedRange>();
  const take = (id: string): NamedRange | undefined => {
    const own = made.get(id);
    if (own) return own;
    const original = ranges.find((r) => r.id === id);
    if (!original || original.target.datasetId !== source.id) return undefined;
    const scope: NamedRange["scope"] = { kind: "sheet", datasetId: clone.id };
    let name = original.name;
    for (let n = 1; nameClash(out, name, scope, datasets); n++) name = `${original.name} (copy${n > 1 ? ` ${n}` : ""})`;
    const copy: NamedRange = {
      id: newNamedRangeId(new Set(out.map((r) => r.id))),
      name,
      scope,
      target: { datasetId: clone.id, cols: [...original.target.cols], rows: original.target.rows ? { ...original.target.rows } : null },
      ...(original.rowsStale ? { rowsStale: true as const } : {}),
    };
    made.set(id, copy);
    out.push(copy);
    return copy;
  };
  const rebound = formulas?.map((f) => {
    if (!f.ranges?.length) return f;
    const links = f.ranges.map((b) => {
      const copy = b.id === null ? undefined : take(b.id);
      return { link: copy ? { name: copy.name, id: copy.id } : { ...b }, from: b.name };
    });
    let expr = f.expr;
    for (const call of rangeCalls(f.expr).reverse()) {
      const hit = links.find((l) => l.from === call.name);
      if (hit && hit.link.name !== call.name) expr = expr.slice(0, call.nameAt) + `"${hit.link.name}"` + expr.slice(call.nameEnd);
    }
    return { ...f, expr, ranges: links.map((l) => l.link) };
  });
  const copied = [...made.entries()].map(([id, copy]) => {
    const was = ranges.find((r) => r.id === id)!.name;
    return was === copy.name ? was : `${was} -> ${copy.name}`;
  });
  return {
    formulas: rebound,
    patch: copied.length ? { namedRanges: out, status: `copied named range${copied.length === 1 ? "" : "s"} ${copied.join(", ")} for the copy: its rng() formulas read its own block` } : {},
  };
}
