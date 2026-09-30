// /api/peaks/* wrappers beyond `peaksIntegrate` (which stays in lib/api.ts —
// used eagerly). Split out here (R8 bundle-diet pass, 2026-08-23; see
// api/reference.ts's header for why): every one of these is the lazy peaks
// workshop only. NOT re-exported by lib/api.ts; the peaks workshop imports
// directly from this path.

import { postJSON } from "./http";
import type { MultiFitResult, Peak, SinglePeakFit } from "../types";
import type { components } from "./schema";

/** Robust peak detection -> peak list + estimated background. Omitted
 *  settings take the route's (2θ-tuned) defaults; the `_deg` fields are in x
 *  units, and `bg_*` picks the detector's own background (SNIP default). */
export function findPeaks(body: {
  x: number[];
  y: number[];
  snr_threshold?: number;
  min_prominence?: number;
  max_peaks?: number;
  sensitivity?: string;
  min_separation?: number;
  max_window_deg?: number;
  min_width_deg?: number;
  max_width_deg?: number;
  bg_method?: "snip" | "polynomial";
  bg_poly_degree?: number;
  bg_iterative?: boolean;
}): Promise<{ peaks: Peak[]; background: (number | null)[] }> {
  return postJSON("/api/peaks/find", body);
}

/** Seed for a peak fit — center/FWHM/height (+ optional eta for pseudo-Voigt). */
export interface PeakSeed {
  center: number;
  fwhm: number;
  height: number;
  eta?: number;
}

/** Fit one peak in a window to a named shape (/api/peaks/fit). */
export function fitPeak(body: {
  x: number[];
  y: number[];
  x_lo: number;
  x_hi: number;
  seed_center: number;
  seed_fwhm?: number;
  model?: string;
}): Promise<SinglePeakFit> {
  return postJSON("/api/peaks/fit", body);
}

/** Fit all peaks + a polynomial background simultaneously (/api/peaks/fit-multi). */
export function fitMultiPeak(body: {
  x: number[];
  y: number[];
  peaks: PeakSeed[];
  model?: string;
  bg_degree?: number;
  constrain?: boolean;
  link_mode?: string;
}): Promise<MultiFitResult> {
  return postJSON("/api/peaks/fit-multi", body);
}

// ── mixed-shape peak model fit (audit P2.4) ──────────────────────────────────
export type PeakModelFitRequest = components["schemas"]["PeakModelFitRequest"];
export type PeakModelFitResponse = components["schemas"]["PeakModelFitResponse"];

/** Per-peak shapes + polynomial background with per-parameter start/vary/
 *  bounds/ties (/api/peaks/model-fit). Synchronous on the server (30 s cap):
 *  `signal` only stops the CLIENT waiting — a cancelled fit still finishes
 *  server-side and its response is dropped. */
export function fitPeakModel(
  body: PeakModelFitRequest,
  signal?: AbortSignal,
): Promise<PeakModelFitResponse> {
  return postJSON("/api/peaks/model-fit", body, signal);
}

// ── batch integration (ORIGIN_GAP_PLAN #35) ──────────────────────────────────

/** One integrated window of one spectrum (NaN travels as null). */
export interface IntegrateBatchPeak {
  region: [number, number];
  area: number | null;
  area_pct: number | null;
  centroid: number | null;
  height: number | null;
  position: number | null;
  fwhm: number | null;
}

/** One spectrum's row from /api/peaks/integrate-batch: `peaks` when `ok`,
 *  else `error` saying why (a window outside the data, …). */
export interface IntegrateBatchRow {
  index: number;
  label: string;
  ok: boolean;
  error?: string;
  shift_samples: number;
  shift_x: number;
  total_area: number | null;
  peaks?: IntegrateBatchPeak[];
}

export interface IntegrateBatchResponse {
  regions: [number, number][];
  n_spectra: number;
  n_regions: number;
  aligned: boolean;
  reference: number;
  baseline: string;
  results: IntegrateBatchRow[];
  n_failed: number;
}

export interface IntegrateBatchRequest {
  /** One grid shared by every spectrum — the only form alignment accepts. */
  x?: number[];
  /** Each spectrum's own x (datasets measured on different grids). */
  xs?: number[][];
  spectra: number[][];
  regions: [number, number][];
  baseline?: "linear" | "none";
  align?: boolean;
  reference?: number;
  labels?: string[];
}

/** Integrate fixed windows across many spectra (/api/peaks/integrate-batch). */
export function integratePeaksBatch(body: IntegrateBatchRequest, signal?: AbortSignal): Promise<IntegrateBatchResponse> {
  return postJSON("/api/peaks/integrate-batch", body, signal);
}
