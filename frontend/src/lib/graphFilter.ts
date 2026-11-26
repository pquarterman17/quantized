// Filter plotted data from the graph (Origin's Data Slicer; gap plan item 22):
// keep only the rows inside the graph's zoomed X range (and, for a single
// curve, its Y range). The shortest honest path onto the EXISTING Data Filter:
// the result is an ordinary `Dataset.filter` range predicate, written by
// `setDatasetFilter` (coalesced undo, the same chokepoint the Data Filter
// window uses), so the plot, fits, statistics and exports all follow it and
// the Data Filter window shows and edits it.
//
// A live graph (Plot together) has no rows of its own: its points are its
// SOURCE sheets' rows (`linkedRowSources`), so the predicate goes on each
// source, on the X column its curves are drawn against.
//
// Fail closed: an unfixed (auto) range, a source that is loading, a column the
// filter cannot range over (a nominal one) or one sheet drawn against two
// different X columns refuses the whole action.

import { fixedLim, type HalfLim } from "./axisLim";
import { curveBindingAt, type RebindState } from "./curveRebind";
import { visibleCurves } from "./browseGraph";
import { channelModelingType } from "./modeling";
import type { ColumnFilter, DataFilter, Dataset } from "./types";

export interface FilterEdit {
  datasetId: string;
  datasetName: string;
  filter: DataFilter;
}

export type FilterPlan = { ok: true; edits: FilterEdit[]; summary: string } | { ok: false; why: string };

const range = (col: number, [lo, hi]: readonly [number, number]): ColumnFilter => ({ col, kind: "range", min: Math.min(lo, hi), max: Math.max(lo, hi) });

/** `existing` with the predicates on the columns of `next` replaced by `next`. */
function merged(existing: DataFilter | undefined, next: ColumnFilter[]): DataFilter {
  return [...(existing ?? []).filter((f) => !next.some((n) => n.col === f.col)), ...next];
}

/** The filter edits that keep the rows inside the focused graph's fixed X
 *  range, and with `withY` (one visible curve only) its fixed Y range. */
export function planViewFilter(s: RebindState & { xLim: HalfLim | null; yLim: HalfLim | null }, withY: boolean): FilterPlan {
  const x = fixedLim(s.xLim);
  if (!x) return { ok: false, why: "Zoom the graph to the X range to keep first: it is on auto." };
  const channels = visibleCurves(s);
  if (channels.length === 0) return { ok: false, why: "The graph has no visible curve." };
  const y = withY ? fixedLim(s.yLim) : null;
  if (withY && !y) return { ok: false, why: "The Y range is on auto: set it (zoom) to filter on it." };
  if (withY && channels.length > 1) return { ok: false, why: "A Y range filter needs exactly one visible curve: hide the others, or filter on X only." };
  const bySource = new Map<string, { xCol: number; yCol: number }>();
  for (const c of channels) {
    const b = curveBindingAt(s, c);
    if (!b) return { ok: false, why: "A curve has no sheet of its own to filter." };
    const xCol = b.xKey === null ? -1 : b.xKey;
    const seen = bySource.get(b.datasetId);
    if (seen && seen.xCol !== xCol) return { ok: false, why: "One sheet is drawn against two different X columns: filter it in the Data Filter window." };
    bySource.set(b.datasetId, { xCol, yCol: b.yKey });
  }
  const edits: FilterEdit[] = [];
  for (const [id, { xCol, yCol }] of bySource) {
    const src: Dataset | undefined = s.datasets.find((d) => d.id === id);
    if (!src || src.pending) return { ok: false, why: "A source sheet is still loading." };
    for (const col of y ? [xCol, yCol] : [xCol]) {
      if (col >= 0 && channelModelingType(src, col) !== "continuous") return { ok: false, why: `“${src.data.labels[col]}” is not a continuous column: a range cannot filter it.` };
    }
    const next = [range(xCol, x), ...(y ? [range(yCol, y)] : [])];
    // The sheet's own predicates stay (even an inert one: it stays in the document); ours replace those on the same columns.
    edits.push({ datasetId: id, datasetName: src.name, filter: merged(src.filter, next) });
  }
  const names = edits.map((e) => `“${e.datasetName}”`).join(", ");
  return { ok: true, edits, summary: `kept only the rows in the plotted ${y ? "X and Y ranges" : "X range"} of ${names}` };
}
