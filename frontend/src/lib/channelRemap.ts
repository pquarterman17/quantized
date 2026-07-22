// What happens to CHANNEL-INDEX-KEYED state when a column disappears.
//
// A recurring defect class in this repo (three instances fixed 2026-07-05,
// commit 4113104; a fourth found 2026-07-19): state keyed by a column index
// goes stale when the column COUNT changes, so the surviving indices silently
// point at different data.
//
// The 2026-07-05 round fixed the DATASET-scoped half (`channelRoles`,
// `channelTypes`, `filter`) inline in `removeFormula`. It missed the parallel
// VIEW-scoped half -- `xKey`/`yKeys`/`y2Keys`/`seriesStyles`/`seriesLabels`/
// `errKeys`/`seriesOrder`/`hiddenChannels` -- because those live in a
// different store slice that the fixing commit never touched, and the test
// written beside it asserts only the fields that were fixed. Concretely: with
// formulas F1 at column 3 and F2 at column 4, hiding F1 and then removing it
// shifted F2 down into index 3, where the stale `hiddenChannels: [3]` then
// hid F2 -- a column the user never asked to hide silently vanished.
//
// Both halves now live here so the rule is stated ONCE. Pure: plain values in,
// patch out, no store import.

import type { ChannelRole, ColumnFilter, ModelingType, SeriesStyle } from "./types";

/** Shift one channel index down past a removed column. `null` = the index WAS
 *  the removed column and the caller must drop it. */
export function remapChannel(c: number, removedCol: number): number | null {
  if (c === removedCol) return null;
  return c > removedCol ? c - 1 : c;
}

/** Remap a `Record<number, T>` keyed by column index, dropping the removed
 *  column's entry. Returns `undefined` when nothing survives, matching the
 *  store's "absent rather than empty" convention for these optional fields. */
export function remapKeyedRecord<T>(
  rec: Record<number, T> | undefined,
  removedCol: number,
): Record<number, T> | undefined {
  if (!rec) return rec;
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    const c = remapChannel(Number(k), removedCol);
    if (c !== null) out[c] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Same, but keeping an empty record rather than collapsing to `undefined` --
 *  the VIEW fields are non-optional (`seriesStyles` is always an object). */
function remapKeyedRecordDense<T>(rec: Record<number, T>, removedCol: number): Record<number, T> {
  const out: Record<number, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    const c = remapChannel(Number(k), removedCol);
    if (c !== null) out[c] = v;
  }
  return out;
}

/** Remap an index LIST, dropping the removed column. */
export function remapChannelList(list: number[], removedCol: number): number[] {
  return list.map((c) => remapChannel(c, removedCol)).filter((c): c is number => c !== null);
}

/** The dataset-scoped index-keyed fields (the half fixed in 2026-07-05). */
export interface DatasetChannelState {
  channelRoles?: Record<number, ChannelRole>;
  channelTypes?: Record<number, ModelingType>;
  filter?: ColumnFilter[];
}

export function remapDatasetChannels(
  d: DatasetChannelState,
  removedCol: number,
): DatasetChannelState {
  const filter = d.filter
    ?.filter((f) => f.col !== removedCol)
    .map((f) => (f.col > removedCol ? { ...f, col: f.col - 1 } : f));
  return {
    channelRoles: remapKeyedRecord(d.channelRoles, removedCol),
    channelTypes: remapKeyedRecord(d.channelTypes, removedCol),
    filter: filter && filter.length ? filter : undefined,
  };
}

/** The view-scoped index-keyed fields (the half that was missing). */
export interface ViewChannelState {
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  hiddenChannels: number[];
  seriesOrder: number[] | null;
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  errKeys: Record<number, number>;
}

/** Remap the live plot view after `removedCol` disappears from its dataset.
 *
 *  `xKey` deliberately becomes `null` when it WAS the removed column: there is
 *  no honest substitute, and null is the store's existing "no explicit x"
 *  state (row index), which every consumer already handles. `errKeys` is
 *  remapped on BOTH sides -- its keys are Y channels and its values are error
 *  channels, so a removed column can invalidate either end. */
export function remapViewChannels(v: ViewChannelState, removedCol: number): ViewChannelState {
  const errKeys: Record<number, number> = {};
  for (const [k, val] of Object.entries(v.errKeys)) {
    const key = remapChannel(Number(k), removedCol);
    const value = remapChannel(val, removedCol);
    if (key !== null && value !== null) errKeys[key] = value;
  }
  return {
    xKey: v.xKey === null ? null : remapChannel(v.xKey, removedCol),
    yKeys: v.yKeys === null ? null : remapChannelList(v.yKeys, removedCol),
    y2Keys: v.y2Keys === null ? null : remapChannelList(v.y2Keys, removedCol),
    hiddenChannels: remapChannelList(v.hiddenChannels, removedCol),
    seriesOrder: v.seriesOrder === null ? null : remapChannelList(v.seriesOrder, removedCol),
    seriesStyles: remapKeyedRecordDense(v.seriesStyles, removedCol),
    seriesLabels: remapKeyedRecordDense(v.seriesLabels, removedCol),
    errKeys,
  };
}

/** Remap the channel-keyed view state of every window bound to `datasetId`
 *  after `removedCol` disappears — the per-window analogue of `remapViewChannels`.
 *  A background `PlotWindow` keeps its OWN PlotView copy of these fields, so
 *  remapping only the live singleton leaves those stale (a hidden/styled channel
 *  in an unfocused window would follow the shifted column). Generic over the
 *  window shape so this module stays store-free; windows with a `null` datasetId
 *  (panels, snapshots) are left untouched. */
export function remapWindowViews<W extends { datasetId: string | null; view: ViewChannelState }>(
  windows: readonly W[],
  datasetId: string,
  removedCol: number,
): W[] {
  return windows.map((w) =>
    w.datasetId === datasetId
      ? { ...w, view: { ...w.view, ...remapViewChannels(w.view, removedCol) } }
      : w,
  );
}
