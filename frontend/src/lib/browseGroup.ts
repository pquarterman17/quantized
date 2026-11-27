// Browse graph, several curves at once (Origin gap plan item 22, "curves per
// step"). `lib/browseGraph.ts` steps ONE curve; with N curves per step the
// browser owns a GROUP of N consecutive Y columns of one sheet, starting at the
// chosen curve, and steps the whole group by N (columns) or moves the whole
// group to the next sheet that carries all its columns (sheets).
//
// The graph shows exactly the group's curves (at N > 1 every curve outside the group is dropped): a step replaces the group's
// slots by the new window, adds slots when the window is wider than the group,
// and drops them when it is narrower, so the figure, its legend and its export
// (all read from the same layer) never hold a stale curve. The write is
// `applyLayerContents`, the one binding path (one undo step; the kept curves
// keep their styles and Y2 placement through the column shifts).
//
// Windows tile the browsable columns from the first one: 0..N-1, N..2N-1, and a
// last window that is shorter when N does not divide the count (never wrapped
// or padded). Stepping off the end wraps to the first window; stepping back
// from a window that does not start on a tile lands on the first column.
//
// Fail closed: a sheet is refused when any group curve's columns are missing or
// ambiguous on it; a hidden curve on a plain graph (it would be dropped) is
// refused as in the single-curve path. Each new curve is named in the scheme of
// the curve it replaces (a plain column name, or "sheet: column"); a legend the
// user typed for an old column described that column, not the next, so it is not kept.

import { browsableColumns, visibleCurves, type BrowseBy } from "./browseGraph";
import { rebindBlocker, worksheetCandidates, type CurveBindingRef, type RebindState } from "./curveRebind";
import { layerRowsChanged, newCurve, type LayerRow } from "./layerContents";
import { is2DMap } from "./mapdata";
import type { Dataset, LinkedCurve } from "./types";

export const MAX_CURVES_PER_STEP = 24;

/** A step the layer path applies (`rows` replaces the graph's layer). */
export type GroupPlan =
  | {
      ok: true;
      group: true;
      /** The group's first layer slot (after the step) and its size (before it). */
      index: number;
      size: number;
      /** The new group's size. */
      width: number;
      rows: LayerRow[];
      /** 1-based place of the new group's first column (or sheet) in its ring, and the ring's size. */
      position: number;
      count: number;
      /** What the group now shows: a column name or a range of them, or a sheet name. */
      name: string;
    }
  | { ok: false; why: string };

const refuse = (why: string): GroupPlan => ({ ok: false, why });
const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** `n` as a whole number of curves, 1..MAX. */
export const cleanPerStep = (n: number): number => (Number.isFinite(n) ? Math.min(MAX_CURVES_PER_STEP, Math.max(1, Math.round(n))) : 1);

/** The group's size: the remembered one when it still fits the layer from `index`, else 1. */
export function groupAt(layer: readonly LinkedCurve[], index: number, remembered: number): number {
  return remembered > 1 && index >= 0 && index + remembered <= layer.length ? remembered : 1;
}

/** The layer slot of the curve in visible place `slot`, or -1. A live graph's channel IS its layer index;
 *  a plain dataset's graph draws its channels in layer order. */
export function layerIndexOf(s: RebindState, layer: readonly LinkedCurve[], slot: number): number {
  const channel = visibleCurves(s)[slot];
  if (channel === undefined) return -1;
  const ds = s.datasets.find((d) => d.id === s.activeId);
  return ds?.linkedCurves ? channel : layer.findIndex((c) => c.yKey === channel);
}

/** A curve on `src`'s columns, named in the scheme of `like` (a derived "sheet: column" legend, or the plain column name). */
const derived = (src: Dataset, xKey: number | null, yKey: number, like: LinkedCurve): LinkedCurve =>
  like.labelFrom !== undefined ? newCurve(src, xKey, yKey) : { datasetId: src.id, xKey, yKey, label: src.data.labels[yKey] ?? "" };

/** Plan one step of the group that starts at visible place `slot`: `by` column (a window of `n` columns) or sheet,
 *  `delta` +1 / -1. `layer` is the graph's curves now, `remembered` the group size the last step left here. */
export function planBrowseGroup(s: RebindState, layer: readonly LinkedCurve[], by: BrowseBy, delta: 1 | -1, slot: number, n: number, remembered: number): GroupPlan {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || is2DMap(ds.data)) return refuse("Focus a graph first: there is no curve to step.");
  const blocked = rebindBlocker(s);
  if (blocked) return refuse(blocked);
  const index = layerIndexOf(s, layer, slot);
  if (index < 0) return refuse("The graph has no visible curve to step.");
  const size = groupAt(layer, index, remembered);
  const group = layer.slice(index, index + size);
  const src = s.datasets.find((d) => d.id === group[0].datasetId);
  if (!src) return refuse("That curve has no sheet of its own to step through.");
  if (src.pending) return refuse(`“${src.name}” is still loading: step again in a moment.`);
  const plan = by === "column" ? columnGroup(layer, index, size, src, delta, cleanPerStep(n)) : sheetGroup(s, layer, index, group, src, delta);
  if (!plan.ok) return plan;
  return layerRowsChanged(layer, plan.rows) ? plan : refuse(by === "column" ? `“${src.name}” has no other column to step to.` : "There is no other sheet to step to.");
}

function columnGroup(layer: readonly LinkedCurve[], index: number, size: number, src: Dataset, delta: 1 | -1, n: number): GroupPlan {
  const anchor = layer[index];
  const cols = browsableColumns(src, anchor.xKey);
  const m = cols.length;
  if (m < 2) return refuse(`“${src.name}” has no other column to step to.`);
  const at = cols.indexOf(anchor.yKey);
  const lastStart = Math.floor((m - 1) / n) * n;
  const start = at < 0 ? (delta > 0 ? 0 : lastStart) : delta > 0 ? (at + n >= m ? 0 : at + n) : at - n >= 0 ? at - n : at > 0 ? 0 : lastStart;
  const window = cols.slice(start, start + n);
  const curves = window.map((yKey, k) => derived(src, anchor.xKey, yKey, layer[index + Math.min(k, size - 1)]));
  // With several curves per step the graph holds exactly the window: the curves outside the group are dropped
  // (a 7-curve plot at N = 3 shows 3 curves, not those 3 plus the 6 it had). At N = 1 the other curves stay.
  const only = n > 1;
  const rows: LayerRow[] = [
    ...(only ? [] : layer.slice(0, index).map((curve, from) => ({ curve, from }))),
    ...curves.map((curve, k) => ({ curve, from: k < size ? index + k : null })),
    ...(only ? [] : layer.slice(index + size).map((curve, k) => ({ curve, from: index + size + k }))),
  ];
  const name = (c: number) => src.data.labels[c] || `col ${c + 1}`;
  const shown = window.length > 1 ? `${name(window[0])} to ${name(window[window.length - 1])}` : name(window[0]);
  return { ok: true, group: true, index: only ? 0 : index, size, width: window.length, rows, position: start + 1, count: m, name: shown };
}

const resolvedBinding = (c: { resolution: object }): CurveBindingRef | null => ("binding" in c.resolution ? (c.resolution.binding as CurveBindingRef) : null);

function sheetGroup(s: RebindState, layer: readonly LinkedCurve[], index: number, group: readonly LinkedCurve[], src: Dataset, delta: 1 | -1): GroupPlan {
  if (group.some((c) => c.datasetId !== src.id)) return refuse("The group's curves come from different sheets: step the columns instead.");
  // A sheet qualifies only when EVERY group curve's columns resolve on it exactly (by name; an ambiguous one is skipped).
  const perCurve = group.map(
    (c) =>
      new Map(
        worksheetCandidates(s, { datasetId: c.datasetId, xKey: c.xKey, yKey: c.yKey }).flatMap((cand) => {
          const b = resolvedBinding(cand);
          return b ? [[cand.sheet.id, b] as const] : [];
        }),
      ),
  );
  const ring = s.datasets.filter((d) => d.id === src.id || perCurve.every((m) => m.has(d.id)));
  if (ring.length < 2) return refuse(`No other sheet has columns named like these curves (“${src.name}” is the only one).`);
  const next = ring[wrap(ring.findIndex((d) => d.id === src.id) + delta, ring.length)];
  const rows: LayerRow[] = layer.map((curve, from) => {
    const k = from - index;
    const to = k >= 0 && k < group.length ? perCurve[k].get(next.id) : undefined;
    return to ? { curve: derived(next, to.xKey, to.yKey, curve), from } : { curve, from };
  });
  return { ok: true, group: true, index, size: group.length, width: group.length, rows, position: ring.indexOf(next) + 1, count: ring.length, name: next.name };
}
