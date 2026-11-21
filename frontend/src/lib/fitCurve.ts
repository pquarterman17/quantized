// Display-curve fits (P4 phase 2, plans/LARGE_PAYLOAD_PLAN.md; backend
// routes/_fitresults.py). Curve Fit only: import it from lazy code, never from
// an eager module (the eager bundle has no headroom).
//
// A large fit asked with `display_points` leaves its full `yFit` (19 MB of JSON
// at 1M rows) and a weighted fit's `obsVar` off the wire and returns
// `yFitDisplay`: the curve's per-bucket min/max rows plus its gap edges. The
// overlay draws THAT (`displayOverlayY`: undefined between display rows, which
// uPlot draws across, null at a real gap), and every consumer that needs full
// resolution goes through ONE accessor family here:
//   * `fullFitCurve`   -- the fit's yFit at every fitted point: by `resultId`
//     (/api/fitting/curve), else, on a 409 (evicted, a server restart, a
//     reopened project), the model evaluated at its own x (/bands, covar
//     null): the same `evaluate` on the same doubles, so bit-identical;
//   * `fullFitResult`  -- the result with `yFit` and `residuals` back
//     (write-to-sheet, report, residual plots, the status line's runs test);
//   * `fullFitOverlay` -- the overlay with a dense `y` (export, snapshot);
//   * `fitBandsFor`    -- a weighted band's obsVar by id, or on a 409 the
//     fit's own weights resent (the server rebuilds obsVar as the fit did).
// A small fit (<= FIT_DISPLAY_MIN_POINTS) keeps the phase-1 lean response: it
// has nothing to gain, and keeps its full `yFit` in memory as before.

import { autoGuess } from "./api/curvefit";
import { fitBands, type BandsRequest, type BandsResult } from "./api/fitStats";
import { restoreGapRows } from "./api/finitePairs";
import { postJSON, type HttpError } from "./api/http";
import type { FitCurveSource, FitOverlay } from "./fitTypes";
import { withResiduals } from "./fitResiduals";
import { postBySource, type FitSource } from "./fitSource";
import { expandToFull } from "./rowstate";
import type { CalcResult } from "./types";

/** Fits with more points than this ask for a display curve. */
export const FIT_DISPLAY_MIN_POINTS = 20_000;
/** The display budget: ~2 rows per bucket (min + max), 4096 buckets. */
export const FIT_DISPLAY_POINTS = 4096;

type Num = number | null;
/** The wire's display curve: `rows` index the POSTED points. */
export interface FitDisplay {
  rows: number[];
  y: Num[];
}

const is409 = (e: unknown): boolean => (e as HttpError | null)?.status === 409;

/** The response fields a fit of `n` points asks for: lean always, plus a
 *  display curve when it is large. */
export function fitTransport(n: number): { return_residuals: false; display_points?: number } {
  return n > FIT_DISPLAY_MIN_POINTS ? { return_residuals: false, display_points: FIT_DISPLAY_POINTS } : { return_residuals: false };
}

export function fitDisplayOf(result: CalcResult | null | undefined): FitDisplay | null {
  const d = result?.yFitDisplay as FitDisplay | undefined;
  return d && Array.isArray(d.rows) && Array.isArray(d.y) ? d : null;
}

/** The overlay column for a display curve, laid out exactly as the full
 *  curve always was (`restoreGapRows` then `expandToFull`: NaN at a gap pair
 *  or a non-finite value, null off the analysis rows) except that a fitted
 *  row between display rows is undefined, which uPlot draws across. */
export function displayOverlayY(
  display: FitDisplay,
  pairs: Parameters<typeof restoreGapRows>[1],
  kept: readonly number[],
  n: number,
): Num[] {
  const perPoint = new Array<number | undefined>(pairs.keep.length).fill(undefined);
  display.rows.forEach((k, i) => {
    if (k < perPoint.length) perPoint[k] = display.y[i] ?? Number.NaN;
  });
  const gapped = new Array<number | undefined>(pairs.n).fill(Number.NaN);
  pairs.keep.forEach((j, i) => {
    gapped[j] = perPoint[i];
  });
  const out = kept.length === n ? gapped : expandToFull(gapped as Num[], kept, n);
  return out as Num[];
}

/** Attach the curve's source to a display result (in memory only), so every
 *  full-resolution consumer can find it. */
export function withCurveSource(result: CalcResult, model: string, x: number[], rows: number[]): CalcResult {
  if (!fitDisplayOf(result)) return result;
  const fitCurve: FitCurveSource = {
    resultId: typeof result.resultId === "string" ? result.resultId : null,
    model,
    params: [...((result.params as number[] | undefined) ?? [])],
    rows,
    x,
  };
  return { ...result, fitCurve };
}

/** The dataset row of each fitted point: the kept analysis pairs (`keep`,
 *  lib/api/finitePairs) mapped through the analysis rows (`kept`, all `n`
 *  rows = the identity), exactly as the overlay has always expanded them. */
export function fitRowsOf(keep: readonly number[], kept: readonly number[], n: number): number[] {
  return kept.length === n ? [...keep] : keep.map((j) => kept[j]!);
}

/** Run a fit with the transport for its size; restore the residuals (lean)
 *  and record a display curve's source. `rows`: `fitRowsOf`. With `source`
 *  (a /api/fitting/fit request), x/y go by dataset handle when the server
 *  holds the dataset (lib/fitSource; phase 3). */
export async function displayFit<R extends { y: number[]; x: number[] }>(
  fit: (req: R & ReturnType<typeof fitTransport>) => Promise<CalcResult>,
  req: R,
  model: string,
  rows: number[],
  source?: FitSource,
): Promise<CalcResult> {
  const body = { ...req, ...fitTransport(req.x.length) };
  const raw = await postBySource("/api/fitting/fit", body, source, rows, () => fit(body));
  return withCurveSource(withResiduals(raw, req.y), model, req.x, rows);
}

/** /api/fitting/autoguess on `x`/`y`: by dataset handle + `rows` when the
 *  server holds `source` (lib/fitSource, P8), else the arrays as before. */
export function autoGuessFor(
  model: string,
  x: number[],
  y: number[],
  source: FitSource | undefined,
  rows: readonly number[],
): Promise<{ p0: number[] }> {
  return postBySource("/api/fitting/autoguess", { model, x, y }, source, rows, () => autoGuess(model, x, y));
}

/** The overlay column for `r` over `n` dataset rows: the display curve, or
 *  the full `yFit` with its gap pairs restored and expanded to every row (the
 *  pre-phase-2 overlay); null when the result has neither. */
export function fitOverlayColumn(
  r: CalcResult,
  pairs: Parameters<typeof restoreGapRows>[1],
  kept: readonly number[],
  n: number,
): { y: Num[]; full?: FitCurveSource } | null {
  const display = fitDisplayOf(r);
  const src = curveSourceOf(r);
  if (display && src) return { y: displayOverlayY(display, pairs, kept, n), full: src };
  const yFit = r.yFit as Num[] | undefined;
  if (!Array.isArray(yFit)) return null;
  const aligned = restoreGapRows(yFit, pairs);
  return { y: kept.length === n ? aligned : expandToFull(aligned, kept, n) };
}

export const curveSourceOf = (result: CalcResult | null | undefined): FitCurveSource | null =>
  (result?.fitCurve as FitCurveSource | undefined) ?? null;

const curves = new WeakMap<FitCurveSource, Promise<Num[]>>();

/** The fit's yFit at every fitted point (module header). One request per
 *  source; a failure is not cached. */
export function fullFitCurve(src: FitCurveSource): Promise<Num[]> {
  let hit = curves.get(src);
  if (!hit) {
    hit = loadCurve(src);
    curves.set(src, hit);
    hit.catch(() => curves.delete(src));
  }
  return hit;
}

async function loadCurve(src: FitCurveSource): Promise<Num[]> {
  let y: Num[] | null = null;
  if (src.resultId) {
    try {
      y = (await postJSON<{ yFit: Num[] }>("/api/fitting/curve", { result_id: src.resultId })).yFit;
    } catch (e) {
      if (!is409(e)) throw e;
    }
  }
  if (!y) {
    y = (await fitBands({ model: src.model, params: src.params, covar: null, x: src.x, n_points: src.x.length, n_free: src.params.length })).yFit;
  }
  if (y.length !== src.rows.length) throw new Error("the full fit curve does not match the fitted rows; re-fit");
  return y;
}

/** `overlay` at full resolution (a copy; `overlay` itself when it is not a
 *  display curve). */
export async function fullFitOverlay<T extends FitOverlay | null>(overlay: T): Promise<T> {
  if (!overlay?.full) return overlay;
  const full = await fullFitCurve(overlay.full);
  // Every undefined row is a fitted row, so all are overwritten here; a
  // non-finite value is NaN, as `restoreGapRows` writes it.
  const y = [...overlay.y];
  overlay.full.rows.forEach((r, i) => {
    y[r] = full[i] ?? Number.NaN;
  });
  const { full: _source, ...rest } = overlay;
  return { ...rest, y } as T;
}

const results = new WeakMap<CalcResult, Promise<CalcResult>>();

/** `result` with its full `yFit` and `residuals` (y - yFit, lib/fitResiduals)
 *  back; `result` itself when it is not a display result. */
export function fullFitResult(result: CalcResult, y: readonly number[]): Promise<CalcResult> {
  const src = curveSourceOf(result);
  if (!src) return Promise.resolve(result);
  let hit = results.get(result);
  if (!hit) {
    hit = fullFitCurve(src).then((yFit) => {
      const { yFitDisplay: _d, ...rest } = result;
      return withResiduals({ ...rest, yFit }, y);
    });
    results.set(result, hit);
    hit.catch(() => results.delete(result));
  }
  return hit;
}

/** The weighting the fit ran with, for the obsVar fallback. */
export interface FitWeightsUsed {
  x: readonly number[];
  dy?: readonly number[] | null;
  weights?: readonly number[] | null;
}

/** /bands for a fit: a weighted display result's obsVar by id, and on a 409
 *  the fit's own weights and s² resent (routes/fitting_stats). Any other fit
 *  posts `req` as is. */
export async function fitBandsFor(req: BandsRequest, result: CalcResult, fit: FitWeightsUsed, signal?: AbortSignal): Promise<BandsResult> {
  const src = curveSourceOf(result);
  if (!src || (fit.dy == null && fit.weights == null)) return fitBands(req, signal);
  if (src.resultId) {
    try {
      return await fitBands({ ...req, result_id: src.resultId }, signal);
    } catch (e) {
      if (!is409(e)) throw e;
    }
  }
  const s2 = result.errorsScaled === false ? 1 : Number(result.chiSqRed);
  if (!Number.isFinite(s2)) return fitBands(req, signal); // no variance to rebuild: mse only
  return fitBands({
    ...req,
    x_data: [...fit.x],
    ...(fit.dy != null ? { obs_dy: [...fit.dy] } : { obs_weights: [...fit.weights!] }),
    obs_scale: s2,
  }, signal);
}
