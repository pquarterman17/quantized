// Quick-fit gadget (gap #33) — pure model list + row/x,y selection over an ROI
// intersected with the active dataset's analysis view (guard #11: excluded and
// filtered rows are dropped BEFORE the ROI clip, the same rows the plot itself
// hides/greys — see lib/rowstate). No React / store / uPlot imports here, so
// this is unit-tested standalone like lib/mapcuts.

import { fmtNum } from "./format";
import { activeRowIndices, analysisData, droppedRows } from "./rowstate";
import type { CalcResult, Dataset } from "./types";

/** The curated model choices offered by the gadget — a small, fast subset of
 *  the full /api/fitting/models registry (the Curve Fit workshop exposes the
 *  rest). "Exponential Decay" is the registered backend name behind the
 *  gadget's "Exponential" pick (there is no bare "Exponential" model). */
export const QUICK_FIT_MODELS = ["Linear", "Gaussian", "Exponential Decay"] as const;

export interface RoiRowSelection {
  x: number[];
  y: number[];
  /** Original dataset row indices, 1:1 with x/y — feeds rowstate.expandToFull
   *  to realign the fit result with the full-length plot x. */
  rows: number[];
}

/** The dataset's analysis-view rows (#50 excluded ∪ #53 filtered pruned, via
 *  rowstate.analysisData) whose x on channel `col` falls in [lo, hi] AND whose
 *  y on that channel is finite. Endpoints may be given in either order. Empty
 *  selection when nothing qualifies (no active dataset, no ROI, no channel, or
 *  nothing in range). */
export function selectRoiRows(
  active: Dataset | null,
  roi: readonly [number, number] | null,
  col: number | null,
): RoiRowSelection {
  const empty: RoiRowSelection = { x: [], y: [], rows: [] };
  if (!active || !roi || col == null) return empty;
  const ad = analysisData(active);
  if (!ad) return empty;
  const n = active.data.time.length;
  const kept = activeRowIndices(n, droppedRows(active));
  const lo = Math.min(roi[0], roi[1]);
  const hi = Math.max(roi[0], roi[1]);
  const x: number[] = [];
  const y: number[] = [];
  const rows: number[] = [];
  for (let i = 0; i < ad.time.length; i++) {
    const xv = ad.time[i];
    const yv = ad.values[i]?.[col];
    if (xv == null || !Number.isFinite(xv) || xv < lo || xv > hi) continue;
    if (yv == null || !Number.isFinite(yv)) continue;
    x.push(xv);
    y.push(yv);
    rows.push(kept[i] ?? i);
  }
  return { x, y, rows };
}

/** Compact "p0=1.23±0.04  p1=0.01±0.00" text for the chip — the gadget skips
 *  the /api/fitting/models round-trip the Curve Fit workshop uses for real
 *  parameter names, so params are indexed (matches the report's own p0/p1/…
 *  fallback naming, lib/api.reportEmit param_names). Empty string when there
 *  are no params to show. */
export function formatQfitParams(result: CalcResult | null): string {
  if (!result) return "";
  const params = Array.isArray(result.params) ? (result.params as number[]) : [];
  const errors = Array.isArray(result.errors) ? (result.errors as (number | null)[]) : [];
  return params
    .map((p, i) => {
      const e = errors[i];
      const ev = typeof e === "number" && Number.isFinite(e) ? `±${fmtNum(e)}` : "";
      return `p${i}=${fmtNum(p)}${ev}`;
    })
    .join("  ");
}

/** The raw dataset channel of the first VISIBLE plotted series — the column
 *  the gadget fits, mirroring the "topmost visible trace" convention already
 *  used by the ∫/∩ region tools (uplotRegionTools.firstVisibleCol), but
 *  computed from the store's own plotted-channel + hidden-channel bookkeeping
 *  rather than a live uPlot instance. Null when nothing is plotted. */
export function firstVisiblePlottedChannel(
  plotted: readonly number[],
  isHidden: (channel: number) => boolean,
): number | null {
  for (const c of plotted) {
    if (!isHidden(c)) return c;
  }
  return plotted.length > 0 ? plotted[0] : null;
}
