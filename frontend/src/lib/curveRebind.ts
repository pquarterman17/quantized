// Pure model behind the plot right-click "Change Y / Change X / Change
// Worksheet" entries (Origin gap plan item 38): what a curve is bound to now,
// which columns it could take, and which other sheets hold the SAME columns.
// The writes live in store/curveRebindApply.ts and go through Layer Contents'
// apply path (store/layerContentsApply.ts), so there is one way to rebind.
//
// Fail closed: a column is matched by NAME only, and a name that matches more
// than one column of a sheet refuses that sheet with a message. Nothing is
// ever bound by position or "closest".

import { is2DMap } from "./mapdata";
import { curveX } from "./perSeriesX";
import { effectiveChannels } from "./plotdata";
import { linkedGraphReaches } from "./linkedCurves";
import type { Dataset } from "./types";
import type { AppState } from "../store/useApp";

/** What one curve draws: its source sheet and the two source columns
 *  (`xKey` null = the sheet's own X). */
export interface CurveBindingRef {
  datasetId: string;
  xKey: number | null;
  yKey: number;
}

/** The window state this model reads (the open-time store snapshot). */
export type RebindState = Pick<
  AppState,
  "datasets" | "activeId" | "xKey" | "yKeys" | "seriesOrder" | "hiddenChannels" | "seriesLabels" | "workbooks"
>;

/** The curve at display channel `channel` of the focused graph, or null when it
 *  has no curve of its own (a channel past a live graph's curves, a map, no
 *  focused dataset). A live graph's channel IS its curve index; a plain
 *  dataset's channel is its own Y column, drawn against its own X. */
export function curveBindingAt(s: RebindState, channel: number): CurveBindingRef | null {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || is2DMap(ds.data)) return null;
  if (ds.linkedCurves) {
    const c = ds.linkedCurves[channel];
    return c ? { datasetId: c.datasetId, xKey: c.xKey, yKey: c.yKey } : null;
  }
  if (channel < 0 || channel >= ds.data.labels.length) return null;
  const own = curveX(ds, s.xKey)[channel];
  return { datasetId: ds.id, xKey: own === undefined ? s.xKey : own, yKey: channel };
}

/** Why the focused graph's curves cannot be re-pointed now, or null. A plain
 *  dataset's graph becomes a live graph of its VISIBLE curves when one is
 *  re-bound (Layer Contents' rule), so a hidden curve would be dropped:
 *  refused instead of lost. */
export function rebindBlocker(s: RebindState): string | null {
  const ds = s.datasets.find((d) => d.id === s.activeId);
  if (!ds || ds.linkedCurves) return null;
  const plotted = effectiveChannels(ds.data, s.yKeys, s.xKey, ds.channelRoles, s.seriesOrder);
  return plotted.some((c) => s.hiddenChannels.includes(c)) ? "Show all curves first: a hidden curve would be dropped from the new graph." : null;
}

/** Is the legend text of the curve at `channel` typed by the user (kept on a
 *  rebind) rather than derived from its source (re-derived)? */
export function legendIsTyped(s: Pick<RebindState, "seriesLabels">, channel: number, curveLabelFrom: string | undefined, live: boolean): boolean {
  return s.seriesLabels[channel] !== undefined || (live && curveLabelFrom === undefined);
}

/** Column choices of `ds`: its own labels, made unique ("T", "T (2)") for the menu. */
export function columnChoices(ds: Dataset): { col: number; label: string }[] {
  const seen = new Map<string, number>();
  return ds.data.labels.map((l, col) => {
    const base = l || `col ${col + 1}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return { col, label: k === 1 ? base : `${base} (${k})` };
  });
}

export type ColumnMatch = { col: number } | { none: true } | { ambiguous: string };

/** The column of `to` named like column `col` of `from`: an exact name, else the
 *  same name ignoring case and surrounding blanks. A name `to` carries on more
 *  than one column is ambiguous, never a guess. */
export function matchColumn(from: Dataset, col: number, to: Dataset): ColumnMatch {
  const name = from.data.labels[col];
  if (!name || !name.trim()) return { none: true };
  const labels = to.data.labels;
  const tiers = [(l: string) => l === name, (l: string) => l.trim().toLowerCase() === name.trim().toLowerCase()];
  for (const same of tiers) {
    const hits = labels.flatMap((l, i) => (same(l) ? [i] : []));
    if (hits.length === 1) return { col: hits[0] };
    if (hits.length > 1) return { ambiguous: `“${to.name}” has ${hits.length} columns named “${name}”` };
  }
  return { none: true };
}

export type SheetResolution = { binding: CurveBindingRef } | { none: true } | { ambiguous: string };

/** `curve`'s columns found by name on sheet `to`: every bound column (its Y, and
 *  its X unless that is the sheet's own X) must resolve. */
export function resolveOnSheet(from: Dataset, curve: CurveBindingRef, to: Dataset): SheetResolution {
  const y = matchColumn(from, curve.yKey, to);
  const x = curve.xKey === null ? ({ col: -1 } as const) : matchColumn(from, curve.xKey, to);
  for (const m of [y, x]) if ("ambiguous" in m) return m;
  if (!("col" in y) || !("col" in x)) return { none: true };
  return { binding: { datasetId: to.id, xKey: curve.xKey === null ? null : x.col, yKey: y.col } };
}

export interface SheetCandidate {
  sheet: Dataset;
  /** The book the sheet belongs to, "" for a loose dataset. */
  book: string;
  resolution: SheetResolution;
}

/** The other sheets `curve` could move to: every plain, loaded sheet but its
 *  own and any whose columns do not all resolve (those are left out). An
 *  ambiguous sheet IS listed, so the menu can say why it is refused. Graphs,
 *  maps, books not yet fetched and sheets the focused graph already draws
 *  from are never offered. */
export function worksheetCandidates(s: RebindState, curve: CurveBindingRef): SheetCandidate[] {
  const from = s.datasets.find((d) => d.id === curve.datasetId);
  if (!from) return [];
  const books = new Map(s.workbooks.map((b) => [b.id, b.name]));
  return s.datasets.flatMap((to) => {
    if (to.id === from.id || to.linkedCurves || to.pending || is2DMap(to.data)) return [];
    if (s.activeId && linkedGraphReaches(s.datasets, to.id, s.activeId)) return [];
    const resolution = resolveOnSheet(from, curve, to);
    return "none" in resolution ? [] : [{ sheet: to, book: (to.workbookId && books.get(to.workbookId)) || "", resolution }];
  });
}
