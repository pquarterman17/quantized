// Per-series X for the LIVE plot (Origin-gap audit 2, #2). A sheet laid out
// T1,R1,T2,R2 binds each Y to its nearest-preceding X (`lib/ownXSeries.ts`'s
// `seriesXKeyFor`). The plot pipeline draws ONE X array, so when the shown
// curves belong to several X columns the plot, the stacked panels and the
// export all draw a derived VIEW of the dataset instead of the dataset:
//
//   - one row block per distinct X source, in first-curve order, each block
//     the source's own rows in their own order (never a sorted X union, so a
//     non-monotonic sweep keeps its acquisition order);
//   - the view's `.time` is those X columns concatenated, and every channel
//     keeps its OWN index, holding values only inside the block of the X it
//     belongs to (NaN elsewhere) -- so styles, renames, hidden flags, error
//     bindings and every other channel-keyed setting apply unchanged;
//   - excluded / filtered rows stay excluded, once per block.
//
// When every shown curve shares one X there is no view: the plan just names
// that X (which may differ from the plot's `xKey` -- a Y before every X
// column stays on `.time` even after "Set as X" picked a later X).
//
// Loaded on demand (`Stage/usePerSeriesXView.ts`, `figureSpecPerSeriesX.ts`):
// only a sheet with a designated X value column ever needs it.

import { effectiveDesignations } from "./columnmeta";
import { seriesXKeyFor } from "./ownXSeries";
import { effectiveChannels } from "./plotdata";
import { droppedRows } from "./rowstate";
import type { Dataset, DataStruct } from "./types";

export interface PerSeriesXView {
  /** The dataset to draw: same id/channels/settings, the block layout as data. */
  dataset: Dataset;
  /** Source rows per block -- view row `v` is source row `v % rowsPerBlock`. */
  rowsPerBlock: number;
  /** Each block's X source (null = `.time`), in block order. */
  blocks: (number | null)[];
}

export interface PerSeriesXPlan {
  /** The X the plot draws against: the view's `.time` (null) when there is a
   *  view, else the one X every shown curve shares. */
  xKey: number | null;
  view: PerSeriesXView | null;
}

/** A cached view: its data and the dropped rows it carries, per block. */
interface CachedView {
  view: PerSeriesXView;
  dropped: number[] | undefined;
}
const cache = new WeakMap<DataStruct, Map<string, CachedView>>();

/** Plan the plot of `shown` channels of `ds` when the plot's X is `xKey`. */
export function perSeriesXPlan(ds: Dataset, xKey: number | null, shown: readonly number[]): PerSeriesXPlan {
  const designations = effectiveDesignations(ds.data, ds.columnDesignations);
  if (!designations.includes("X")) return { xKey, view: null };
  const blocks: (number | null)[] = [];
  for (const c of shown) {
    const x = seriesXKeyFor(designations, xKey, c);
    if (!blocks.includes(x)) blocks.push(x);
  }
  if (blocks.length <= 1) return { xKey: blocks.length ? blocks[0] : xKey, view: null };
  return { xKey: null, view: perSeriesXData(ds, xKey, blocks) };
}

/** The block-layout view of `ds` (see the module doc). Cached per `data`
 *  object; the key holds everything else the view is built from -- the
 *  designations, the plot's X (it decides which block a channel before every
 *  X joins), the blocks, the error bindings and the dropped rows. */
export function perSeriesXData(ds: Dataset, xKey: number | null, blocks: readonly (number | null)[]): PerSeriesXView {
  const designations = effectiveDesignations(ds.data, ds.columnDesignations);
  const dropped = [...droppedRows(ds)].sort((a, b) => a - b);
  const key = JSON.stringify([designations, xKey, blocks, ds.errorRoles ?? [], dropped]);
  let byKey = cache.get(ds.data);
  const hit = byKey?.get(key);
  if (hit) return { ...hit.view, dataset: { ...ds, data: hit.view.dataset.data, excludedRows: hit.dropped, filter: undefined } };

  const { data } = ds;
  const n = data.time.length;
  const width = data.labels.length;
  const blockOf = Array.from({ length: width }, (_, c) =>
    blocks.indexOf(designations[c] === "X" ? c : seriesXKeyFor(designations, xKey, c)),
  );
  // An error column draws on its target's curve, whichever block that is.
  for (const b of ds.errorRoles ?? []) {
    if (b.target >= 0 && b.target < width && b.channel >= 0 && b.channel < width) blockOf[b.channel] = blockOf[b.target];
  }
  const time: number[] = [];
  const values: number[][] = [];
  blocks.forEach((x, bi) => {
    for (let r = 0; r < n; r++) {
      const row = data.values[r] ?? [];
      time.push(x === null ? data.time[r] : (row[x] ?? NaN));
      values.push(blockOf.map((b, c) => (b === bi ? (row[c] ?? NaN) : NaN)));
    }
  });
  const name = (x: number | null): string =>
    x === null ? String(data.metadata?.["x_column_long"] || data.metadata?.["x_column_name"] || "x") : (data.labels[x] ?? `col ${x + 1}`);
  const unit = (x: number | null): string => (x === null ? String(data.metadata?.["x_column_unit"] ?? "") : (data.units[x] ?? ""));
  const title = jointXTitle(blocks.map((x) => [name(x), unit(x)]));
  const metadata: Record<string, unknown> = {
    ...data.metadata,
    x_column_long: title.name,
    x_column_name: title.name,
    x_column_unit: title.unit,
    per_series_x_blocks: blocks.length,
  };
  if (blocks.some((x) => x !== null)) delete metadata["time_is_datetime"];
  const excludedRows = blocks.flatMap((_, bi) => dropped.map((r) => bi * n + r));
  const view: PerSeriesXView = {
    rowsPerBlock: n,
    blocks: [...blocks],
    dataset: {
      ...ds,
      data: { ...data, time, values, metadata },
      excludedRows: excludedRows.length ? excludedRows : undefined,
      filter: undefined,
    },
  };
  if (!byKey) cache.set(ds.data, (byKey = new Map()));
  byKey.set(key, { view, dropped: excludedRows.length ? excludedRows : undefined });
  return view;
}

/** Source rows -> view rows (a selected source row is selected in every block). */
export function viewRows(view: PerSeriesXView, rows: readonly number[]): number[] {
  return view.blocks.flatMap((_, bi) => rows.map((r) => bi * view.rowsPerBlock + r));
}

/** One X axis title over several X sources (gap audit 2 #11): every distinct
 *  quantity named -- "T1 / T2" in "K" when they share the unit, else each with
 *  its own, "T (K) / H (Oe)", and no shared unit. */
export function jointXTitle(sources: readonly (readonly [string, string])[]): { name: string; unit: string } {
  const pairs = [...new Map(sources.map(([n, u]) => [JSON.stringify([n, u]), [n, u] as const])).values()];
  const units = new Set(pairs.map(([, u]) => u));
  if (units.size <= 1) return { name: pairs.map(([n]) => n).join(" / "), unit: pairs[0]?.[1] ?? "" };
  return { name: pairs.map(([n, u]) => (u ? `${n} (${u})` : n)).join(" / "), unit: "" };
}

// ── the plot surfaces' adapter (Stage/usePerSeriesXView.ts) ───────────────

/** The plot-pipeline fields this step reads and may re-point. */
export interface PlotParamsIn {
  active: Dataset | null | undefined;
  xKey: number | null;
  yKeys: number[] | null;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  selection?: { datasetId: string; rows: number[] } | null;
  seriesLabels?: Record<number, string>;
}

const lastByActive = new WeakMap<Dataset, { inputs: unknown[]; out: Partial<PlotParamsIn> }>();

/** What the plot must draw instead of `p`: the per-series-X view (each Y on
 *  its own X; the old X column never turns into a curve) and a live graph's
 *  curve names under the renames. Memoized per input IDENTITY, so a render
 *  that changed none of them gets the very same objects back. */
export function plotOverrides(p: PlotParamsIn): Partial<PlotParamsIn> | null {
  const { active } = p;
  if (!active) return null;
  const inputs = [p.xKey, p.yKeys, p.seriesOrder, p.hiddenChannels, p.selection, p.seriesLabels];
  const last = lastByActive.get(active);
  if (last && last.inputs.every((v, i) => v === inputs[i])) return last.out;
  const plotted = effectiveChannels(active.data, p.yKeys, p.xKey, active.channelRoles, p.seriesOrder);
  const plan = perSeriesXPlan(active, p.xKey, plotted.filter((c) => !p.hiddenChannels.includes(c)));
  const view = plan.view;
  const params: Partial<PlotParamsIn> = {};
  if (p.seriesLabels) {
    const labels = withLinkedLegends(active.data, p.seriesLabels);
    if (labels !== p.seriesLabels) params.seriesLabels = labels;
  }
  if (view || plan.xKey !== p.xKey) {
    Object.assign(params, { active: view?.dataset ?? active, xKey: plan.xKey, yKeys: plotted });
    const sel = p.selection;
    if (view && sel && sel.datasetId === active.id) params.selection = { ...sel, rows: viewRows(view, sel.rows) };
  }
  lastByActive.set(active, { inputs, out: params });
  return params;
}

/** A live graph's legend defaults (gap audit 2 #1): the curve names
 *  lib/linkedCurves.ts stamps into `metadata.linked_curve_legends` -- the
 *  user's own label, else the source's CURRENT name -- laid UNDER the view's
 *  renames. The canvas and the export read it; the DOM legend (Stage/
 *  PlotLegend.tsx) reads the same field inline. */
export function withLinkedLegends<T extends Record<number, string>>(data: Pick<DataStruct, "metadata"> | null | undefined, labels: T): T {
  const raw = data?.metadata?.["linked_curve_legends"];
  if (!Array.isArray(raw)) return labels;
  const out: Record<number, string> = {};
  raw.forEach((l, i) => {
    if (typeof l === "string" && l) out[i] = l;
  });
  return { ...out, ...labels } as T;
}
