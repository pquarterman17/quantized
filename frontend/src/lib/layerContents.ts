// Origin's Layer Contents for a LIVE multi-dataset graph (origin gap audit 3
// N1): the graph's curves as an editable list -- remove, reorder, re-bind a
// curve to another source/X/Y, and add curves from any dataset -- committed as
// ONE edit. Pure: the dialog keeps a draft of `LayerRow`s, and the store
// applies it (store/layerContentsApply.ts) as a sequence of column shifts on
// the graph dataset, so every channel-indexed reference (styles, labels,
// hidden curves, Y2, error keys, bound windows, saved figures, graphs drawing
// from this graph) follows its curve through lib/channelRemap.ts -- the same
// machinery a worksheet's Move/Delete/Insert Column uses.
//
// Fail closed: a re-bound row whose Y (or X) is not a real column of its
// source is a problem the dialog names, never silently bound to a neighbour.

import type { ColumnShift } from "./channelRemap";
import type { Dataset, LinkedCurve } from "./types";

/** One curve of the draft: `from` is the graph column it was (null = added). */
export interface LayerRow {
  curve: LinkedCurve;
  from: number | null;
}

/** The draft for a graph with `curves`: every curve, in order. */
export function layerRowsOf(curves: readonly LinkedCurve[]): LayerRow[] {
  return curves.map((curve, from) => ({ curve, from }));
}

/** A new curve's label: "dataset: column", following later renames. */
export function newCurve(ds: Dataset, xKey: number | null, yKey: number): LinkedCurve {
  return { datasetId: ds.id, xKey, yKey, label: `${ds.name}: ${ds.data.labels[yKey] ?? ""}`, labelFrom: "nameCol" };
}

/** Do two curves draw the same source X/Y? */
export const sameBinding = (a: LinkedCurve, b: LinkedCurve): boolean =>
  a.datasetId === b.datasetId && a.xKey === b.xKey && a.yKey === b.yKey;

/** Has the draft changed anything (order, membership or a binding)? */
export function layerRowsChanged(old: readonly LinkedCurve[], rows: readonly LayerRow[]): boolean {
  return rows.length !== old.length || rows.some((r, i) => r.from !== i || !sameBinding(r.curve, old[i]));
}

/** The column shifts that turn the graph's `n` columns into `rows`' order:
 *  removals first (highest index first, so each later index is still the
 *  user's), then, position by position, an insert for an added row or a move
 *  bringing the kept column into place. Applied in order, each shift's
 *  channel-indexed state follows its column (lib/channelRemap.ts). */
export function layerShifts(n: number, rows: readonly LayerRow[]): ColumnShift[] {
  const kept = new Set(rows.flatMap((r) => (r.from === null ? [] : [r.from])));
  const shifts: ColumnShift[] = [];
  const cur: (number | null)[] = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i >= 0; i--) {
    if (kept.has(i)) continue;
    shifts.push(i);
    cur.splice(i, 1);
  }
  rows.forEach((r, t) => {
    if (r.from === null) {
      shifts.push({ inserted: t });
      cur.splice(t, 0, null);
      return;
    }
    const at = cur.indexOf(r.from);
    if (at === t) return;
    shifts.push({ from: at, to: t });
    cur.splice(at, 1);
    cur.splice(t, 0, r.from);
  });
  return shifts;
}

/** Why the draft can't be applied: one line per problem, empty when it can.
 *  A kept, untouched curve whose source is gone stays as it is (drawn empty);
 *  a re-bound or added curve must name a real Y (and X) of an existing
 *  dataset, and must not make the graph draw from itself. */
export function layerRowsProblems(
  old: readonly LinkedCurve[],
  rows: readonly LayerRow[],
  datasets: readonly Dataset[],
  reaches: (fromId: string) => boolean,
): string[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const froms = rows.flatMap((r) => (r.from === null ? [] : [r.from]));
  const out: string[] = [];
  if (new Set(froms).size !== froms.length) out.push("a curve is listed twice");
  rows.forEach((r, i) => {
    if (r.from !== null && old[r.from] && sameBinding(r.curve, old[r.from])) return;
    const name = `Curve ${i + 1}`;
    const ds = byId.get(r.curve.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds) out.push(`${name}: choose a source dataset`);
    else if (r.curve.yKey < 0 || r.curve.yKey >= width) out.push(`${name}: choose a Y column of “${ds.name}”`);
    else if (r.curve.xKey !== null && (r.curve.xKey < 0 || r.curve.xKey >= width)) out.push(`${name}: choose an X column of “${ds.name}”`);
    else if (reaches(ds.id)) out.push(`${name}: “${ds.name}” draws from this graph, so the two would depend on each other`);
  });
  return out;
}

/** Each graph row's identity: "source#X#sourceRow" -- the assembly lays one
 *  block of rows per distinct (source, X), in first-curve order
 *  (lib/linkedCurves.assembleLinkedCurves). A curve that resolves to nothing
 *  adds no rows. */
export function graphRowKeys(curves: readonly LinkedCurve[], datasets: readonly Dataset[]): string[] {
  const byId = new Map(datasets.map((d) => [d.id, d]));
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const c of curves) {
    const ds = byId.get(c.datasetId);
    const width = ds?.data.labels.length ?? 0;
    if (!ds || c.yKey < 0 || c.yKey >= width || (c.xKey !== null && (c.xKey < 0 || c.xKey >= width))) continue;
    const block = `${c.datasetId}#${c.xKey}`;
    if (seen.has(block)) continue;
    seen.add(block);
    for (let r = 0; r < ds.data.time.length; r++) keys.push(`${block}#${r}`);
  }
  return keys;
}

/** A graph's masked rows after its curves change from `before` to `after`:
 *  each mask follows its source point; a point no longer drawn drops out. */
export function remapGraphMask(
  excluded: readonly number[] | undefined,
  before: readonly LinkedCurve[],
  after: readonly LinkedCurve[],
  datasets: readonly Dataset[],
): number[] | undefined {
  if (!excluded?.length) return undefined;
  const oldKeys = graphRowKeys(before, datasets);
  const index = new Map(graphRowKeys(after, datasets).map((k, i) => [k, i]));
  const out = excluded.flatMap((r) => {
    const i = oldKeys[r] === undefined ? undefined : index.get(oldKeys[r]);
    return i === undefined ? [] : [i];
  });
  return out.length ? out.sort((a, b) => a - b) : undefined;
}
