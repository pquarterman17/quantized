// Sort-key math for the Library folder tree (project-organization plan). Items
// (datasets + folders) sharing a parent are ordered by a numeric `order` key.
// Appends are O(1) (last + 1); repositioning renumbers the destination siblings
// to dense integers (see lib/foldertree `move*`), which is precision-proof at a
// Library's scale — no fractional-key bookkeeping needed.

/**
 * A sort key strictly between `before` and `after`. Either bound may be
 * undefined to denote an open end:
 *   - both undefined → first item in an empty container (0)
 *   - only `before`  → append after the last item (before + 1)
 *   - only `after`   → prepend before the first item (after - 1)
 *   - both           → midpoint (before + after) / 2
 */
export function orderBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 0;
  if (after === undefined) return before! + 1;
  if (before === undefined) return after - 1;
  return (before + after) / 2;
}

/**
 * Comparator for siblings by `order` ascending. Items without a key keep their
 * incoming (insertion) order relative to each other — `Array.prototype.sort` is
 * stable — and sink after keyed items. Lets a partially-migrated set (some
 * items keyed, some not) render deterministically.
 */
export function byOrder<T extends { order?: number }>(a: T, b: T): number {
  const ao = a.order;
  const bo = b.order;
  if (ao === undefined && bo === undefined) return 0;
  if (ao === undefined) return 1;
  if (bo === undefined) return -1;
  return ao - bo;
}
