// Batch peak integration — the pure half (ORIGIN_GAP_PLAN #35's UI). No React,
// no store, no fetch.
//
// CHANNELS. The batch integrates the X/Y the plot shows on the active dataset
// (its X column + primary Y), matched in every other dataset BY COLUMN NAME,
// as the Peak Analyzer batch does. A dataset without that column is an error
// row naming it — never a guess at another column (fail closed).
//
// GRIDS. Datasets measured on one grid go up with a single shared `x`, the
// only form the route can align (alignment shifts by whole samples). Datasets
// on different grids go up with their OWN x each (`xs`): the backend
// integrates each on its own points, so nothing is resampled.
//
// THE TREND. The derived dataset is one row per integrated dataset: x is a
// chosen metadata field (temperature, field, …; "300 K" parses to 300 with
// unit K) or the dataset order, and each window contributes Area / Centroid /
// FWHM columns. Provenance — windows, baseline, alignment, channels, the
// field, every source and every skipped one — is `metadata.peakIntegrateBatch`,
// the same shape of record the Peak Analyzer batch keeps in `peakBatch`.

import { dropGapRows } from "../../../lib/api/finitePairs";
import type { IntegrateBatchRequest, IntegrateBatchResponse } from "../../../lib/api/peaks";
import { selectedFitData } from "../../../lib/fitselection";
import { parseQuantity } from "../../../lib/metadataCleanup";
import { metaValue, pathLabel, type MetaPath } from "../../../lib/metadataKeys";
import { analysisData } from "../../../lib/rowstate";
import type { DataStruct, Dataset } from "../../../lib/types";
import { csvTextCell } from "../../../lib/csvCell";

export interface IntegrateWindow {
  lo: number;
  hi: number;
}

// 12 significant digits: drops binary noise (1 - 0.8 = 0.19999999999999996)
// from an editable field while keeping far more precision than any x axis.
const tidy = (v: number): number => Number(v.toPrecision(12));

/** Windows as center ± FWHM of each usable peak, in x order. */
export function windowsFromPeaks(peaks: readonly { center: number; fwhm: number }[]): IntegrateWindow[] {
  return peaks
    .filter((p) => Number.isFinite(p.center) && Number.isFinite(p.fwhm) && p.fwhm > 0)
    .map((p) => ({ lo: tidy(p.center - p.fwhm), hi: tidy(p.center + p.fwhm) }))
    .sort((a, b) => a.lo - b.lo);
}

/** Why these windows cannot be sent, or null. */
export function windowsProblem(windows: readonly IntegrateWindow[]): string | null {
  if (windows.length === 0) return "add at least one integration window";
  const bad = windows.findIndex((w) => !(Number.isFinite(w.lo) && Number.isFinite(w.hi) && w.lo < w.hi));
  return bad < 0 ? null : `window ${bad + 1}: low must be a number below high`;
}

/** Which columns the batch integrates: names (null x = the row axis) plus the
 *  active dataset's indices, preferred while the name still matches. */
export interface IntegrateChannels {
  xLabel: string | null;
  yLabel: string;
  xIndex: number | null;
  yIndex: number;
}

export function integrateChannels(
  active: Dataset | null | undefined,
  xKey: number | null,
  yKeys: number[] | null,
  seriesOrder: number[] | null,
): IntegrateChannels | null {
  const sel = selectedFitData(active, xKey, yKeys, seriesOrder);
  const labels = active?.data.labels ?? [];
  if (!sel || labels[sel.yKey] === undefined) return null;
  const xLabel = xKey === null ? null : (labels[xKey] ?? null);
  if (xKey !== null && xLabel === null) return null;
  return { xLabel, yLabel: labels[sel.yKey], xIndex: xKey, yIndex: sel.yKey };
}

function columnOf(labels: readonly string[], label: string, preferred: number | null): number {
  if (preferred !== null && labels[preferred] === label) return preferred;
  return labels.indexOf(label);
}

/** `ds`'s analysis rows (exclusions and filters honoured) on the batch
 *  channels, gap rows dropped. Throws an Error saying why when impossible. */
export function seriesFor(ds: Dataset, ch: IntegrateChannels): { x: number[]; y: number[]; gaps: number } {
  const data = analysisData(ds);
  if (!data) throw new Error("no data");
  const yi = columnOf(data.labels, ch.yLabel, ch.yIndex);
  if (yi < 0) throw new Error(`no column named "${ch.yLabel}"`);
  let x = data.time;
  if (ch.xLabel !== null) {
    const xi = columnOf(data.labels, ch.xLabel, ch.xIndex);
    if (xi < 0) throw new Error(`no column named "${ch.xLabel}"`);
    x = data.values.map((row) => row[xi]);
  }
  const pairs = dropGapRows(x, data.values.map((row) => row[yi]));
  if (pairs.x.length === 0) throw new Error("no finite X/Y pairs");
  return { x: pairs.x, y: pairs.y, gaps: pairs.n - pairs.keep.length };
}

/** True when every x array is the same grid, point for point. */
export function sameGrid(xs: readonly (readonly number[])[]): boolean {
  const [first, ...rest] = xs;
  return !!first && rest.every((x) => x.length === first.length && x.every((v, i) => v === first[i]));
}

export function batchBody(
  series: readonly { name: string; x: number[]; y: number[] }[],
  windows: readonly IntegrateWindow[],
  opts: { baseline: "linear" | "none"; align: boolean },
): IntegrateBatchRequest {
  const shared = sameGrid(series.map((s) => s.x));
  return {
    ...(shared ? { x: series[0]?.x ?? [] } : { xs: series.map((s) => s.x) }),
    spectra: series.map((s) => s.y),
    regions: windows.map((w) => [w.lo, w.hi]),
    baseline: opts.baseline,
    align: opts.align,
    labels: series.map((s) => s.name),
  };
}

/** A picked dataset's client-side outcome, in the picked order. The ok ones
 *  were sent, in this order, as the request's spectra. */
export type SourceOutcome =
  | { datasetId: string; name: string; ok: true }
  | { datasetId: string; name: string; ok: false; error: string };

export interface BatchIntegrateRow {
  dataset: string;
  datasetId: string;
  /** 1-based window number. */
  window: number;
  lo: number;
  hi: number;
  status: "ok" | "error";
  error: string | null;
  area: number | null;
  areaPct: number | null;
  centroid: number | null;
  fwhm: number | null;
  height: number | null;
  shiftX: number | null;
}

const fin = (v: number | null | undefined): number | null => (v == null || !Number.isFinite(v) ? null : v);

/** One row per (dataset, window), every picked dataset kept in order. */
export function batchIntegrateRows(
  outcomes: readonly SourceOutcome[],
  res: IntegrateBatchResponse | null,
  windows: readonly IntegrateWindow[],
): BatchIntegrateRow[] {
  let sent = 0;
  return outcomes.flatMap((o) => {
    const row = o.ok ? res?.results[sent++] : undefined;
    const error = !o.ok ? o.error : !row ? "no result was returned" : row.ok ? null : (row.error ?? "integration failed");
    return windows.map((w, k): BatchIntegrateRow => {
      const p = error === null ? row?.peaks?.[k] : undefined;
      return {
        dataset: o.name, datasetId: o.datasetId, window: k + 1, lo: w.lo, hi: w.hi,
        status: error === null ? "ok" : "error", error,
        area: fin(p?.area), areaPct: fin(p?.area_pct), centroid: fin(p?.centroid),
        fwhm: fin(p?.fwhm), height: fin(p?.height), shiftX: error === null ? fin(row?.shift_x) : null,
      };
    });
  });
}

const q = csvTextCell; // text cells are file-derived: formula-neutralized (OWASP)
const num = (v: number | null): string => (v === null ? "" : String(v));

/** RFC 4180 CSV of the result rows, in order; missing numbers are empty. */
export function batchIntegrateCsv(rows: readonly BatchIntegrateRow[]): string {
  const header = "dataset,window,lo,hi,status,area,area_pct,centroid,fwhm,height,shift_x,error";
  const lines = rows.map((r) => [
    q(r.dataset), r.window, r.lo, r.hi, r.status, num(r.area), num(r.areaPct), num(r.centroid),
    num(r.fwhm), num(r.height), num(r.shiftX), q(r.error ?? ""),
  ].join(","));
  return [header, ...lines].join("\n");
}

export interface TrendProvenance {
  baseline: string;
  aligned: boolean;
  channels: { x: string | null; y: string };
  ranAt: string;
}

/** The trend as a library DataStruct: one row per integrated dataset, x the
 *  metadata field at `field` (or the dataset order when null), Area /
 *  Centroid / FWHM per window. `skipped` names every dataset left out, and
 *  why; it is recorded in the provenance too. */
export function trendStruct(
  rows: readonly BatchIntegrateRow[],
  windows: readonly IntegrateWindow[],
  outcomes: readonly SourceOutcome[],
  metaOf: ReadonlyMap<string, Record<string, unknown>>,
  field: MetaPath | null,
  prov: TrendProvenance,
): { data: DataStruct; skipped: string[] } {
  const skipped: string[] = [];
  const units = new Set<string>();
  const points: { x: number; name: string; cells: number[] }[] = [];
  outcomes.forEach((o, k) => {
    const mine = rows.filter((r) => r.datasetId === o.datasetId);
    if (!o.ok || mine.some((r) => r.status !== "ok")) {
      skipped.push(`${o.name}: ${mine.find((r) => r.error)?.error ?? "not integrated"}`);
      return;
    }
    let x = k + 1;
    if (field) {
      const v = metaValue(metaOf.get(o.datasetId), field);
      const parsed = v === undefined ? null : parseQuantity(v);
      if (!parsed || "error" in parsed) {
        skipped.push(`${o.name}: no numeric ${pathLabel(field)}`);
        return;
      }
      x = parsed.n;
      if (parsed.unit) units.add(parsed.unit); // a bare number takes the others' unit
    }
    const cells = mine.flatMap((r) => [r.area, r.centroid, r.fwhm].map((v) => v ?? Number.NaN));
    points.push({ x, name: o.name, cells });
  });
  points.sort((a, b) => a.x - b.x);
  const span = (w: IntegrateWindow) => `${w.lo}–${w.hi}`;
  const labels = windows.flatMap((w) => [`Area ${span(w)}`, `Centroid ${span(w)}`, `FWHM ${span(w)}`]);
  return {
    skipped,
    data: {
      time: points.map((p) => p.x),
      values: points.map((p) => p.cells),
      labels,
      units: labels.map(() => ""),
      metadata: {
        source: "peak-batch-integrate",
        x_column_name: field ? pathLabel(field) : "Dataset #",
        x_column_unit: units.size === 1 ? [...units][0] : "",
        text_columns: { Dataset: points.map((p) => p.name) },
        peakIntegrateBatch: {
          windows: windows.map((w) => [w.lo, w.hi]),
          baseline: prov.baseline,
          aligned: prov.aligned,
          channels: prov.channels,
          xField: field,
          sources: outcomes.map((o) => ({ id: o.datasetId, name: o.name })),
          skipped,
          ranAt: prov.ranAt,
        },
      },
    },
  };
}
