// The live plot's per-series X (origin gap audit 2, #2): a sheet with more
// than one X column (T1,R1,T2,R2 -- an Origin X,Y,X,Y book, or a user's
// "Set As X" on T2) draws every Y against the X column before it, Origin's
// nearest-preceding-X rule (lib/ownXSeries.ts). The plot pipeline binds ONE
// X, so the dataset is presented to it as a SEGMENT-CONCATENATED view -- the
// layout lib/originOverlay.ts and lib/quickFigureSeriesX.ts already render:
// one block of rows per distinct X (the shared X first), each Y's values only
// inside its own block, NaN elsewhere. Never a sorted X union, so a
// non-monotonic sweep (a hysteresis loop) keeps its row order.
//
// Unlike those two, the view is DERIVED, not a Library copy: it keeps the
// source's id and CHANNEL INDICES (styles, renames, hidden channels and error
// keys all stay keyed exactly as before), and it is rebuilt from the live
// rows, so a cell edit, a mask or a re-import reaches the plot. Channels that
// are not curves (X columns, error, label, group) are copied into every block:
// an error bar or a colour value only draws where its Y has a point.
//
// Row-indexed state is re-keyed into the view: the source's dropped rows
// (exclusion + filter) become the view's `excludedRows` in every block, and
// `viewRows` repeats a row selection per block. `PlotPayload.blockRows` is
// the inverse (the plot brush maps a view row back with `r % blockRows`).

import { effectiveDesignations } from "./columnmeta";
import { buildErrorSpans, type ErrorSpan } from "./errorbars";
import { droppedRows } from "./rowstate";
import type { Dataset, DataStruct } from "./types";

/** Each channel's block X: its own X column (nearest preceding "X"), else
 *  the book's first X (`.time`) when the plot's X is itself a designated X
 *  column (a Y before T2 belongs to T1, never to T2), else the plot's X
 *  (`shared`; a plain "plot against this column"). Only curves (a Y, or an
 *  undesignated channel -- ownXSeries' rule) get a block; every other channel
 *  is `undefined` (copied into every block). */
export function curveX(ds: Pick<Dataset, "data" | "columnDesignations">, shared: number | null): (number | null | undefined)[] {
  const designations = effectiveDesignations(ds.data, ds.columnDesignations).slice(0, ds.data.labels.length);
  let lastX: number | null = shared !== null && designations[shared] === "X" ? null : shared;
  return designations.map((d, c) => {
    if (d === "X") lastX = c;
    return (d === "Y" || d === undefined) && c !== shared ? lastX : undefined;
  });
}

/** The X column a fit/analysis of Y channel `yKey` must read: the curve's OWN X
 *  on a multi-X sheet (T1,R1,T2,R2 -- R2 against T2), else the plot's `xKey`
 *  (null = the time column). The same rule the plot draws by. */
export function ownXKey(ds: Pick<Dataset, "data" | "columnDesignations">, xKey: number | null, yKey: number): number | null {
  const own = curveX(ds, xKey)[yKey];
  return own === undefined ? xKey : own;
}

const cache = new WeakMap<DataStruct, Map<string, { data: DataStruct; blocks: (number | null)[] }>>();

/** The X blocks (shared X first) and the concatenated DataStruct, or null
 *  when every curve shares the plot's X (the source plots unchanged). */
export function perSeriesXData(
  ds: Pick<Dataset, "data" | "columnDesignations">,
  xKey: number | null,
): { data: DataStruct; blocks: (number | null)[] } | null {
  const own = curveX(ds, xKey);
  const blocks: (number | null)[] = [xKey];
  for (const x of own) if (x !== undefined && !blocks.includes(x)) blocks.push(x);
  if (blocks.length < 2) return null;
  const key = `${xKey}|${own.join(",")}`;
  const hit = cache.get(ds.data)?.get(key);
  if (hit) return hit;
  const src = ds.data;
  const n = src.time.length;
  const time: number[] = [];
  const values: number[][] = [];
  for (const x of blocks) {
    for (let r = 0; r < n; r++) {
      const row = src.values[r] ?? [];
      time.push(x === null ? src.time[r] : (row[x] ?? NaN));
      values.push(own.map((b, c) => (b === undefined || b === x ? (row[c] ?? NaN) : NaN)));
    }
  }
  const meta = src.metadata ?? {};
  const xName = (x: number | null) =>
    x === null ? String(meta.x_column_long || meta.x_column_name || "x") : (src.labels[x] ?? `col ${x + 1}`);
  const xUnit = (x: number | null) => (x === null ? String(meta.x_column_unit ?? "") : (src.units[x] ?? ""));
  const names = [...new Set(blocks.map(xName))];
  const units = [...new Set(blocks.map(xUnit))];
  const out = {
    data: {
      ...src,
      time,
      values,
      metadata: { ...meta, x_column_long: names.join(" / "), x_column_unit: units.length === 1 ? units[0] : "" },
    },
    blocks,
  };
  let byKey = cache.get(src);
  if (!byKey) cache.set(src, (byKey = new Map()));
  byKey.set(key, out);
  return out;
}

/** `ds` as the one-X plot must see it under `xKey` (see the module doc), or
 *  null when no per-series X applies. The view's X is always `.time`. */
export function perSeriesXDataset(ds: Dataset, xKey: number | null): { dataset: Dataset; blockRows: number } | null {
  const v = perSeriesXData(ds, xKey);
  if (!v) return null;
  const n = ds.data.time.length;
  const dropped = [...droppedRows(ds)].sort((a, b) => a - b);
  const excludedRows = v.blocks.flatMap((_, b) => dropped.map((r) => b * n + r));
  const { filter: _filter, ...rest } = ds;
  return { dataset: { ...rest, data: v.data, excludedRows }, blockRows: n };
}

/** Source rows repeated into every block of an `n`-row view. */
export function viewRows(rows: readonly number[], blocks: number, n: number): number[] {
  return Array.from({ length: blocks }, (_, b) => rows.map((r) => b * n + r)).flat();
}

/** The stacked-panel plot's error spans, one map per fetched channel. Each stack
 *  panel is a single-series plot over THIS per-series-X view (one block of rows
 *  per X), so its spans are built from the same view -- from the source rows
 *  they would cover only the first block and leave a secondary-X curve's bars
 *  misaligned. */
export function stackErrorSpans(active: Dataset, xKey: number | null, channels: readonly number[]): Map<number, ErrorSpan[]>[] {
  const roles = active.errorRoles;
  if (!roles?.length) return [];
  const data = perSeriesXData(active, xKey)?.data ?? active.data;
  return channels.map((ch) => buildErrorSpans(data, [ch], roles));
}
