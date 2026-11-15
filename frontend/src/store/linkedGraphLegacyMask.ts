// Graph masks saved before masks moved to the source points (gap audit 3 N2
// review): a .dwk from the earlier build stores a live graph's mask as GRAPH
// row indices. On a graph's first sync after load each such row is written
// through to the source point it drew -- once, and only where the saved row
// provably still draws that point (same layout, same values). A row that
// cannot be matched is never dropped and never guessed: it stays masked on the
// graph ("held", by graph row as before) and the user is told so.

import { assembleLinkedCurves, linkedGraphMask, linkedRowSources } from "../lib/linkedCurves";
import { excludedSet } from "../lib/rowstate";
import type { Dataset, DataStruct } from "../lib/types";
import { toast } from "./toasts";

/** Per graph id: legacy masked rows that could not be matched to a source
 *  point, kept on the graph's own rows for this session (and saved again in its
 *  mask, so a later load meets them the same way). */
export const heldGraphMasks = new Map<string, Set<number>>();

const same = (a: number | undefined, b: number | undefined): boolean =>
  a === b || (a !== undefined && b !== undefined && Number.isNaN(a) && Number.isNaN(b));

/** Does saved row `r` of `saved` draw exactly what row `r` of `now` draws? */
function sameRow(saved: DataStruct, now: DataStruct, r: number): boolean {
  if (!same(saved.time[r], now.time[r])) return false;
  const a = saved.values[r] ?? [];
  const b = now.values[r] ?? [];
  return a.length === b.length && a.every((v, k) => same(v, b[k]));
}

/** Source rows to mask, by source id, for graph `d`'s saved mask; rows that
 *  could not be matched are held (and announced). Empty when nothing to do. */
export function migrateLegacyMask(d: Dataset, datasets: readonly Dataset[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const saved = excludedSet(d);
  if (saved.size === 0 || !d.linkedCurves) return out;
  const curves = d.linkedCurves;
  const projected = new Set(linkedGraphMask(curves, datasets) ?? []);
  const legacy = [...saved].filter((r) => !projected.has(r));
  if (legacy.length === 0) return out;
  const now = assembleLinkedCurves(curves, datasets, d.data);
  const points = linkedRowSources(curves, datasets);
  const layoutKept = d.data.time.length === points.length;
  const held = new Set<number>();
  for (const r of legacy) {
    const p = points[r];
    if (!layoutKept || !p || !sameRow(d.data, now, r)) {
      held.add(r);
      continue;
    }
    out.set(p.id, [...(out.get(p.id) ?? []), p.row]);
  }
  if (held.size > 0) {
    heldGraphMasks.set(d.id, held);
    toast(
      `“${d.name}”: ${held.size} masked point${held.size === 1 ? "" : "s"} saved by an earlier version could not be matched to ${held.size === 1 ? "its" : "their"} source row — still masked on the graph; check them`,
      "danger",
    );
  }
  return out;
}
