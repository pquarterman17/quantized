// Browse graph (Origin gap plan item 22; Origin's "Browse Graph" / graph
// slider): step ONE curve of the focused graph to the next or previous column
// of its sheet, or to the same columns on the next or previous sheet, without
// rebuilding the figure. This module is the pure plan: which curve, and what
// it should be bound to next. The write is `store/curveRebindApply.rebindCurve`
// (the same single binding path as Change Y / Change Worksheet and Layer
// Contents), so a step is one undo step, keeps the curve's style and
// follows the usual legend rule.
//
// Fail closed. A step that cannot be exact is refused with a reason, never
// guessed: a hidden curve on a plain graph (it would be dropped), a sheet
// whose columns are ambiguous by name, a source that is still loading.
//
// Stable choice. "Which curve" is its place among the graph's VISIBLE curves
// (`slot`), because a channel number changes meaning when the first step turns
// a plain dataset's graph into a live graph (a column index becomes a curve
// index); the visible order survives that.

import { curveBindingAt, rebindBlocker, worksheetCandidates, type CurveBindingRef, type RebindState, type SheetCandidate } from "./curveRebind";
import { is2DMap } from "./mapdata";
import { channelModelingType } from "./modeling";
import { effectiveChannels } from "./plotdata";
import type { Dataset } from "./types";

export type BrowseBy = "column" | "sheet";

export type BrowsePlan =
  | {
      ok: true;
      /** The display channel of the curve being stepped, and what it is bound to now. */
      channel: number;
      expected: CurveBindingRef;
      to: CurveBindingRef;
      /** Where the new binding sits in its ring (1-based) and the ring's size. */
      position: number;
      count: number;
      /** What the curve now shows: a column name, or a sheet name. */
      name: string;
    }
  | { ok: false; why: string };

const refuse = (why: string): BrowsePlan => ({ ok: false, why });

/** The focused graph's visible curves, as display channels in draw order. */
export function visibleCurves(s: RebindState): number[] {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || is2DMap(ds.data)) return [];
  return effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder).filter((c) => !s.hiddenChannels.includes(c));
}

/** The columns of `src` a curve can plot as Y: every continuous column but the
 *  curve's own X and the columns a role set aside (labels, ignored). */
export function browsableColumns(src: Dataset, xKey: number | null): number[] {
  return src.data.labels.flatMap((_, c) => (c !== xKey && !src.channelRoles?.[c] && channelModelingType(src, c) === "continuous" ? [c] : []));
}

const wrap = (i: number, n: number): number => ((i % n) + n) % n;

/** Plan one step of the curve in visible place `slot` (0 = the first visible
 *  curve), `by` column or sheet, `delta` +1 (next) or -1 (previous). */
export function planBrowse(s: RebindState, by: BrowseBy, delta: 1 | -1, slot = 0): BrowsePlan {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || is2DMap(ds.data)) return refuse("Focus a graph first: there is no curve to step.");
  const blocked = rebindBlocker(s);
  if (blocked) return refuse(blocked);
  const channel = visibleCurves(s)[slot];
  if (channel === undefined) return refuse("The graph has no visible curve to step.");
  const expected = curveBindingAt(s, channel);
  const src = expected && s.datasets.find((d) => d.id === expected.datasetId);
  if (!expected || !src) return refuse("That curve has no sheet of its own to step through.");
  if (src.pending) return refuse(`“${src.name}” is still loading: step again in a moment.`);
  return by === "column" ? columnStep(channel, expected, src, delta) : sheetStep(s, channel, expected, src, delta);
}

function columnStep(channel: number, expected: CurveBindingRef, src: Dataset, delta: 1 | -1): BrowsePlan {
  const cols = browsableColumns(src, expected.xKey);
  if (cols.length < 2) return refuse(`“${src.name}” has no other column to step to.`);
  const at = cols.indexOf(expected.yKey);
  const next = cols[at < 0 ? (delta > 0 ? 0 : cols.length - 1) : wrap(at + delta, cols.length)];
  return { ok: true, channel, expected, to: { ...expected, yKey: next }, position: cols.indexOf(next) + 1, count: cols.length, name: src.data.labels[next] || `col ${next + 1}` };
}

const resolved = (c: SheetCandidate) => ("binding" in c.resolution ? c.resolution.binding : null);

function sheetStep(s: RebindState, channel: number, expected: CurveBindingRef, src: Dataset, delta: 1 | -1): BrowsePlan {
  // Only sheets the curve's columns resolve on EXACTLY (by name; an ambiguous one is skipped, not guessed).
  const cands = worksheetCandidates(s, expected).filter((c) => resolved(c) !== null);
  if (cands.length === 0) return refuse(`No other sheet has columns named like this curve's (“${src.name}” is the only one).`);
  const ring = s.datasets.filter((d) => d.id === src.id || cands.some((c) => c.sheet.id === d.id));
  const next = ring[wrap(ring.findIndex((d) => d.id === src.id) + delta, ring.length)];
  const to = resolved(cands.find((c) => c.sheet.id === next.id)!)!;
  return { ok: true, channel, expected, to, position: ring.indexOf(next) + 1, count: ring.length, name: next.name };
}
