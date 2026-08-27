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
//
// 2026-08-27 (independent review): two more channel-indexed fields had the
// same gap. `Dataset.errorRoles` (dataset-scoped, both `channel` and `target`
// ends) went unremapped -- a removed column shifted a surviving error binding
// onto the wrong column with no error, only a silently-wrong whisker size.
// `groupKey`/`facetKey` (view-scoped, "bindings-owned like xKey/yKeys" per
// `lib/plotview.ts`) had the same gap -- a removed column could leave
// `facetKey` pointing at a different column, re-faceting the grid on the
// wrong data. Both now follow the established patterns exactly (`errKeys`
// for the two-sided case, `xKey` for the single-sided case).

import type { ErrorBinding } from "./errorRoles";
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

/** Remap `Dataset.errorRoles` -- index-keyed on BOTH ends: `channel` (the
 *  error column) is always a real column index, but `target` (the column the
 *  error describes) carries the `-1` "bound to the x axis" sentinel
 *  (`lib/errorRoles.ts`'s `ErrorBinding` doc), which is never a column index
 *  and must pass through untouched rather than being treated as channel 0. A
 *  binding whose `channel` or non-sentinel `target` WAS the removed column is
 *  dropped, mirroring `remapViewChannels`'s `errKeys` treatment below.
 *
 *  Preserves the explicit-`[]`-vs-`undefined` distinction the O1 marker relies
 *  on (`lib/originBookRoles.ts`): an absent `errorRoles` stays absent, but an
 *  explicit array that remaps down to zero surviving bindings stays `[]`,
 *  never collapses to `undefined` -- doing so would silently re-enable the
 *  label-guesser fallback (`dataset.errorRoles ?? inferErrorBindings(...)`)
 *  for a dataset that had deliberately opted out of it. */
export function remapErrorRoles(
  roles: readonly ErrorBinding[] | undefined,
  removedCol: number,
): ErrorBinding[] | undefined {
  if (!roles) return undefined;
  const out: ErrorBinding[] = [];
  for (const r of roles) {
    const channel = remapChannel(r.channel, removedCol);
    if (channel === null) continue;
    const target = r.target < 0 ? r.target : remapChannel(r.target, removedCol);
    if (target === null) continue;
    out.push(channel === r.channel && target === r.target ? r : { ...r, channel, target });
  }
  return out;
}

/** The dataset-scoped index-keyed fields (the half fixed in 2026-07-05). */
export interface DatasetChannelState {
  channelRoles?: Record<number, ChannelRole>;
  channelTypes?: Record<number, ModelingType>;
  filter?: ColumnFilter[];
  errorRoles?: ErrorBinding[];
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
    errorRoles: remapErrorRoles(d.errorRoles, removedCol),
  };
}

/** The view-scoped index-keyed fields (the half that was missing). */
export interface ViewChannelState {
  xKey: number | null;
  yKeys: number[] | null;
  y2Keys: number[] | null;
  /** "Group" well channel -- bindings-owned like `xKey`/`yKeys` (`lib/plotview.ts`). */
  groupKey: number | null;
  /** Facet-by-column binding -- bindings-owned like `groupKey` (`lib/plotview.ts`). */
  facetKey: number | null;
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
 *  state (row index), which every consumer already handles. `groupKey` and
 *  `facetKey` are "bindings-owned like xKey/yKeys" (`lib/plotview.ts`'s own
 *  field docs) and follow the exact same null-on-removed pattern. `errKeys`
 *  is remapped on BOTH sides -- its keys are Y channels and its values are
 *  error channels, so a removed column can invalidate either end. */
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
    groupKey: v.groupKey === null ? null : remapChannel(v.groupKey, removedCol),
    facetKey: v.facetKey === null ? null : remapChannel(v.facetKey, removedCol),
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
