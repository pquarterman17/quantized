// Typed fetch layer over the FastAPI backend. All endpoints are under /api
// (dev: Vite proxies to uvicorn :8000; prod: same-origin static mount).
//
// Five pieces live in the `lib/api/` sibling directory (JMP_GAP #14 ratchet):
// `api/http.ts` (transport), `api/stats.ts` (`/api/stats/*`),
// `api/exportMultivar.ts` (JMP_GAP #10, multivar `/api/export/*` figures),
// `api/plot.ts` (P3.4, `/api/plot/*`), and `api/crystallography.ts`
// (`/api/crystallography/*`) — all re-exported below, so every consumer
// keeps importing from `./lib/api`, which resolves to THIS file, not the
// directory. Add a new stats wrapper to `api/stats.ts`, a new plot wrapper
// to `api/plot.ts`, a new crystallography wrapper to
// `api/crystallography.ts`; this file is pinned shrink-only in
// `architecture.test.ts`.
//
// R8 bundle-diet pass (2026-08-23): the reference/units, sld, electrical,
// optics, vacuum, thermal, diffusion, electrochemistry, semiconductor,
// thin-film, superconductor, and magnetic calculator wrappers that used to
// live directly in THIS file moved to their own `api/*.ts` siblings (NOT
// re-exported here, same "zero headroom" convention as api/reference.ts).
// They were lazy-workshop-only (every consumer is a Calculators tab, itself
// behind AppOverlays.tsx's lazy `CalculatorsPanel`), but because this file
// is ALSO reachable from useApp.ts's eager `fftSpectral`/`fitModel`/
// `peaksIntegrate`/`uploadFile` imports, Rollup has no way to ship only
// PART of one module eagerly — the whole file goes wherever its eager
// importer's chunk goes. Co-locating ~640 lines of never-eager calculator
// endpoints in the same file as those four eager functions was silently
// inflating the eager bundle by tens of kB (see
// frontend/scripts/check-bundle-size.mjs's 2026-08-23 history entry for the
// measured delta). Put a NEW lazy-only wrapper in its own `api/<domain>.ts`
// sibling from the start — never here — even if it feels like a natural
// extension of a function that's still (rightly) in this file.

import { getJSON, postDownload, postForm, postJSON } from "./api/http";
import type { BookSource, CalcResult, CorrectionParams, DataStruct } from "./types";

// The transport helpers the standalone clients already import from "./api"
// (lib/jobs, lib/fitbumps, lib/originTemplate) — re-exported so that stays true.
export { postForm, unwrap } from "./api/http";
// The /api/stats/* wrappers, extracted 2026-07-29. New ones go THERE, not here.
export * from "./api/stats";
export * from "./api/exportMultivar"; // multivar /api/export/* figure wrappers (JMP_GAP #10)
export * from "./api/plot"; // /api/plot/* wrappers (P3.4). New ones go THERE, not here.
export * from "./api/crystallography"; // /api/crystallography/* wrappers. New ones go THERE, not here.
export * from "./api/xray"; // /api/xray/* wrappers. New ones go THERE, not here.
export * from "./api/figurePage"; // GOTO #4 figure-page wrappers. New fields go THERE, not here.
// reportEmit/reportExport (R8 pass): genuinely eager via
// folderOps.ts -> runTemplate.ts, so unlike this pass's other extractions,
// this one stays re-exported — see api/report.ts's own header.
export * from "./api/report";

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

export async function health(): Promise<{ status: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as { status: string };
}

/** Import a local file path (auto-detect format) → DataStruct. `signal` lets
 *  a caller abort mid-request (P3.4 slice 1 import cancel) — the backend may
 *  still finish parsing server-side; the client just stops waiting. */
export function importFile(path: string, signal?: AbortSignal): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/parsers/import", { path }, signal);
}

/** Upload a file's bytes from the browser (file-picker / drag-drop) → DataStruct.
 *  `signal` — see importFile. */
export async function uploadFile(file: File, signal?: AbortSignal): Promise<DataStruct> {
  const form = new FormData();
  form.append("file", file, file.name);
  return postForm<DataStruct>("/api/parsers/upload", form, signal);
}

/** Fetch one Origin book's full data (ORIGIN_FILE_DECODE_PLAN #38 — the lazy
 *  per-book import transport's on-demand fetch): `POST /api/parsers/books/data`
 *  with `source`'s project-level reference (path or upload token) plus the
 *  book's own id. Called by `useApp.ensureBookData` the first time a pending
 *  Dataset is actually shown (activated, bound into a plot window/panel, or
 *  opened in the worksheet) — never eagerly for every book at import time. */
export function fetchBookData(source: BookSource): Promise<DataStruct> {
  // Mirrors quantized.routes.books.BookDataRequest exactly (book_id + EITHER
  // path OR token) — `kind`/`rows`/`cols` are frontend-only bookkeeping, not
  // sent.
  return postJSON<DataStruct>("/api/parsers/books/data", {
    book_id: source.bookId,
    ...(source.kind === "path" ? { path: source.path } : { token: source.token }),
  });
}

/** The bundled first-run demo dataset (a synthetic VSM-like hysteresis loop,
 *  `GET /api/samples/demo`) — the real packaged sample, parsed server-side
 *  through the ordinary `import_auto` path, as opposed to the purely
 *  client-side `makeDemoDataset()` fallback used when offline. */
export function fetchDemoSample(): Promise<DataStruct> {
  return getJSON<DataStruct>("/api/samples/demo");
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

export interface CorrectionsRequest {
  dataset: DataStruct;
  params: CorrectionParams;
  bg_dataset?: DataStruct | null;
  bg_interp?: string;
}

/** Apply the correction pipeline to a DataStruct → corrected DataStruct. */
export function applyCorrections(req: CorrectionsRequest): Promise<DataStruct> {
  return postJSON<DataStruct>("/api/corrections/apply", req);
}

// ── Fitting ─────────────────────────────────────────────────────────────────
export interface FitRequest {
  model: string;
  x: number[];
  y: number[];
  p0?: number[];
  lower?: number[];
  upper?: number[];
  /** Per-point 1-sigma errors -> weights 1/dy^2 (canonical). Wins over `weights`.
   *  `null`/absent = unweighted (so a recompute can pass `sel.dy` straight through). */
  dy?: number[] | null;
  weights?: number[];
  fixed?: boolean[];
  calc_errors?: boolean;
}

/** Bounded nonlinear least-squares fit of a named model. */
export function fitModel(req: FitRequest): Promise<CalcResult> {
  return postJSON("/api/fitting/fit", req);
}

// ── Export (file downloads) ─────────────────────────────────────────────────
/** Export XRD data as CSV / Origin ASCII; triggers a browser download. */
export function exportXrdCsv(body: {
  dataset: DataStruct;
  fmt?: string;
  intensity?: string;
  include_metadata?: boolean;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/xrd-csv", body, "export.csv");
}

/** Export a DataStruct (+ optional corrected view) as a self-describing HDF5
 *  file; triggers a browser download. */
export function exportHdf5(body: {
  dataset: DataStruct;
  corrected?: DataStruct | null;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/hdf5", body, "export.h5");
}

/** Current plot-state snapshot for the .ogs GRAPH block (item 26) — mirrors
 *  the Zustand plot fields (yKeys/xKey/xLog/yLog/xLim/yLim/y2Keys). */
export interface OriginGraphSpec {
  y_keys?: number[] | null;
  x_key?: number | null;
  x_log?: boolean;
  y_log?: boolean;
  x_lim?: [number, number] | null;
  y_lim?: [number, number] | null;
  y2_keys?: number[];
}

/** Export a DataStruct as an Origin LabTalk .ogs script + CSV (zipped).
 *  ``graph``, when given, exports the current plot state (selected
 *  channels, axis limits/log flags, y2 split) as an Origin GRAPH, not just
 *  the rebuilt workbook. */
export function exportOrigin(body: {
  dataset: DataStruct;
  filename?: string;
  log_x?: boolean;
  log_y?: boolean;
  make_graph?: boolean;
  graph?: OriginGraphSpec;
}): Promise<void> {
  return postDownload("/api/export/origin", body, "export.zip");
}

/** Whether COM "Send to Origin" is usable right now (Windows + pywin32 +
 *  QZ_ORIGIN_COM=1); everywhere it's false, use exportOrigin instead. */
export function originComStatus(): Promise<{ available: boolean }> {
  return getJSON("/api/export/origin-com/status");
}

/** Push datasets into a RUNNING OriginPro instance as new workbooks (COM). */
export function sendToOrigin(body: {
  datasets: { dataset: DataStruct; name: string }[];
}): Promise<{ books: string[]; rows: number[] }> {
  return postJSON("/api/export/origin-com", body);
}

/** Export several datasets side-by-side into one role-based CSV. */
export function exportConsolidated(body: {
  datasets: { dataset: DataStruct; name: string }[];
  fmt?: string;
  filename?: string;
}): Promise<void> {
  return postDownload("/api/export/consolidated", body, "consolidated.csv");
}

// ── Peak integration (#32) ──────────────────────────────────────────────────

/** One integrated region from /api/peaks/integrate. */
export interface IntegratedPeak {
  region: [number, number];
  area: number;
  area_pct: number;
  centroid: number;
  height: number;
  position: number;
  fwhm: number;
  [key: string]: unknown;
}

/** Full /api/peaks/integrate response (one or more regions). The ROI gadget's
 *  Integrate mode (#34) always sends a single region, but keeps the full
 *  shape — that's what `from_integrate`'s report emitter expects verbatim. */
export interface IntegrateResponse {
  peaks: IntegratedPeak[];
  total_area: number;
  baseline: string;
}

/** Integrate-only peak analysis: net area/centroid/FWHM/%-area per region. */
export function peaksIntegrate(body: {
  x: number[];
  y: number[];
  regions: [number, number][];
  baseline?: "linear" | "none";
}): Promise<IntegrateResponse> {
  return postJSON("/api/peaks/integrate", body);
}

// ── FFT spectral (gap #34 ROI gadget family) ────────────────────────────────

/** /api/spectral/fft response — magnitude/psd/phase spectrum (never complex;
 *  see the route's own docstring). `window` is dropped server-side. */
export interface FftSpectralResult {
  freq: number[];
  magnitude?: (number | null)[];
  psd?: (number | null)[];
  phase?: (number | null)[];
  df: number;
  nfft: number;
  fs: number;
  windowName: string;
  [key: string]: unknown;
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

/** One direction-pair of error magnitudes (MAIN #36). Equal arrays for a
 *  symmetric binding; independent ones for an asymmetric pair. */
export interface ErrorPair {
  plus: (number | null)[];
  minus: (number | null)[];
}
