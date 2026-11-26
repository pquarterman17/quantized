// The /api wrappers no eager code calls, split out of lib/api.ts and re-exported
// from it with `export *` (bundle diet slice 32, `plans/BUNDLE_HEADROOM.md`): the
// SQLite query, the by-path import, the clipboard text-import pair, the model fit,
// peak integration and FFT. Only lazy chunks reach them (the import wizard, the
// ROI-gadget computes, the Data commands), so they ship with those.

import { fitSolverExtra } from "./fitSolverBody";
import { postImport, postJSON } from "./api/http";
import type { FftSpectralResult, FitRequest, IntegrateResponse } from "./api";
import type { CalcResult, DataStruct } from "./types";

export interface SqliteQueryRequest {
  path: string;
  query: string;
  x_column?: string;
  max_rows?: number;
}

/** Execute one read-only SELECT/CTE against a local SQLite database. */
export async function querySqlite(req: SqliteQueryRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/database/sqlite/query", req);
}

/** Import a local file path (auto-detect format) → DataStruct. `signal` lets
 *  a caller abort mid-request (P3.4 slice 1 import cancel) — the backend may
 *  still finish parsing server-side; the client just stops waiting. */
export function importFile(path: string, signal?: AbortSignal): Promise<DataStruct> {
  const init = { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }), signal };
  return postImport<DataStruct>("/api/parsers/import", init);
}

/** Best-effort starting import settings for raw text (delimiter, header/units
 *  lines, column roles) — the same guesser behind the import wizard's first
 *  render (`io.import_preview.guess_settings`). Used by clipboard paste
 *  (gap #47) so pasted text imports through the one shared text-import engine
 *  instead of a second parser. */
export function guessImportSettings(text: string): Promise<Record<string, unknown>> {
  return postJSON<Record<string, unknown>>("/api/import/guess", { text });
}

/** Parse raw text under `settings` (from `guessImportSettings`, or a caller's
 *  own tweak of it) into a DataStruct — the import wizard's "confirm" step. */
export function parseImportText(
  text: string,
  settings: Record<string, unknown>,
): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/import/parse", { text, settings });
}

/** Bounded nonlinear least-squares fit of a named model. */
export async function fitModel(req: FitRequest, signal?: AbortSignal): Promise<CalcResult> {
  // Preferences ▸ Fitting solver limits (non-default only; lib/fitPrefs.ts).
  return postJSON("/api/fitting/fit", { ...req, ...(await fitSolverExtra("/api/fitting/fit")) }, signal);
}

/** Integrate-only peak analysis: net area/centroid/FWHM/%-area per region. */
export function peaksIntegrate(body: {
  x: number[];
  y: number[];
  regions: [number, number][];
  baseline?: "linear" | "none" | "tangent";
}): Promise<IntegrateResponse> {
  return postJSON("/api/peaks/integrate", body);
}

/** Single-record FFT spectrum of one ROI's (x, y). Defaults to a one-sided
 *  magnitude spectrum (hanning window, mean-detrended) — the ROI gadget's
 *  FFT mode never requests "complex" (unserializable; see the route). */
export function fftSpectral(body: {
  x: number[];
  y: number[];
  window?: string;
  output_type?: "psd" | "magnitude" | "phase";
  sided?: "one" | "two";
  detrend?: "mean" | "linear" | "none";
}): Promise<FftSpectralResult> {
  return postJSON("/api/spectral/fft", body);
}
