// A figure document's ANALYSIS OVERLAYS (gap audit 5, lane C): the fit curve
// (with its Curve Fit band), the estimated baseline and the peak markers a
// graph draws, kept ON the figure the way Origin keeps a fit curve as a plot in
// its graph -- so a saved figure, a Figure Page panel, a batch-built figure and
// a Library multi-figure PDF carry the fit instead of the bare data.
//
// The live canvas draws the store's transient singletons (`fitOverlay`,
// `baselineOverlay`, `peakOverlay`, each tagged with its dataset). A plot
// window's document captures the ones drawn for its dataset whenever its view
// is committed (store/windowOverlays.ts), and seeds them back when the window
// is focused or a saved figure is opened, so the canvas and every document
// render agree (lib/figureDocumentOverlaySpec.ts appends them to the export).
//
// FAIL CLOSED. Each curve is row-aligned to the data it was computed on and
// records its own `OverlayBinding` (the Y and the X it was read against, #679).
// `rows` is that data's content hash (lib/dataFingerprint): when the bound
// data no longer hashes the same (rows edited, inserted, sorted, re-imported),
// the overlays are not drawn anywhere -- never re-aligned, never guessed onto
// other rows -- and the export reports them as left out. Placement on a
// per-series-X view and the "bound curve not shown" refusal are
// lib/overlayPlacement's, unchanged.
//
// Pure, and LAZY: the store reaches it through store/windowOverlaysLazy.ts
// (capture / seed), the export path through lib/figureDocumentOverlaySpec.

import { dataFingerprint } from "./dataFingerprint";
import type { FitBandEdges } from "./fitBandOverlay";
import type { BaselineOverlay, FitOverlay, OverlayBinding, PeakOverlay } from "./fitTypes";
import type { DataStruct } from "./types";

/** One saved overlay curve: the store's overlay less its dataset tag (the
 *  document's own binding names the dataset). `band` is the fit's only. */
export interface FigureOverlayCurve {
  binding: OverlayBinding;
  y: (number | null)[];
  band?: FitBandEdges;
}

export interface FigureOverlays {
  /** `dataFingerprint` of the rows every curve below aligns to. */
  rows: string;
  fit?: FigureOverlayCurve;
  baseline?: FigureOverlayCurve;
  peaks?: FigureOverlayCurve;
}

/** The store's overlay singletons (the slice of AppState read and written). */
export interface LiveOverlays {
  fitOverlay: FitOverlay | null;
  baselineOverlay: BaselineOverlay | null;
  peakOverlay: PeakOverlay | null;
}

const KINDS = [
  ["fit", "fitOverlay"],
  ["baseline", "baselineOverlay"],
  ["peaks", "peakOverlay"],
] as const;

function curveFits(curve: { y: readonly unknown[]; band?: FitBandEdges }, n: number): boolean {
  return curve.y.length === n && (curve.band ?? []).every((edge) => edge.y.length === n);
}

/** The overlays the canvas draws for `datasetId` over `data`, as a document
 *  section; undefined when it draws none. Row-misaligned objects are skipped. */
export function captureFigureOverlays(
  live: LiveOverlays,
  datasetId: string | null,
  data: DataStruct | undefined,
): FigureOverlays | undefined {
  if (!datasetId || !data) return undefined;
  const n = data.time.length;
  const out: FigureOverlays = { rows: dataFingerprint(data) };
  let any = false;
  for (const [kind, field] of KINDS) {
    const overlay = live[field];
    if (!overlay || overlay.datasetId !== datasetId || !overlay.binding || !curveFits(overlay, n)) continue;
    const band = kind === "fit" ? (overlay as FitOverlay).band : undefined;
    out[kind] = structuredClone({ binding: overlay.binding, y: overlay.y, ...(band?.length ? { band } : {}) });
    any = true;
  }
  return any ? out : undefined;
}

/** Do `overlays` still align to `data`? (The FAIL CLOSED gate, module header.) */
export function overlaysMatchData(overlays: FigureOverlays, data: DataStruct): boolean {
  return overlays.rows === dataFingerprint(data);
}

/** The store overlays a document's saved section stands for, tagged with
 *  `datasetId`: only the kinds it holds, and none when its rows are stale or
 *  the section is malformed. A document carries its section as loaded (the
 *  eager load path only shape-checks it, lib/figureDocument), so it is
 *  validated HERE, where it is drawn. */
export function liveOverlaysFromDocument(
  section: FigureOverlays | undefined,
  datasetId: string | null,
  data: DataStruct | undefined,
): Partial<LiveOverlays> {
  const overlays = sanitizeFigureOverlays(section);
  if (!overlays || !datasetId || !data || !overlaysMatchData(overlays, data)) return {};
  if (overlayKinds(overlays).some((kind) => overlays[kind]!.y.length !== data.time.length)) return {};
  const out: Partial<LiveOverlays> = {};
  for (const [kind, field] of KINDS) {
    const curve = overlays[kind];
    if (!curve) continue;
    (out as Record<string, unknown>)[field] = { datasetId, ...structuredClone(curve) };
  }
  return out;
}

/** The labels of the kinds a section holds, as the export names them. */
export function overlayKinds(overlays: FigureOverlays | undefined): ("fit" | "baseline" | "peaks")[] {
  return overlays ? KINDS.flatMap(([kind]) => (overlays[kind] ? [kind] : [])) : [];
}

// ---- untrusted input (.dwk / clipboard / recipe) -----------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cells(value: unknown): (number | null)[] | null {
  return Array.isArray(value) && value.every((v) => v === null || (typeof v === "number" && Number.isFinite(v)))
    ? [...value as (number | null)[]]
    : null;
}

function sanitizeCurve(value: unknown, withBand: boolean): FigureOverlayCurve | null {
  if (!isObject(value) || !isObject(value.binding)) return null;
  const { yKey, xKey } = value.binding;
  if (!Number.isInteger(yKey) || (yKey as number) < -1) return null;
  if (xKey !== null && (!Number.isInteger(xKey) || (xKey as number) < 0)) return null;
  const y = cells(value.y);
  if (!y) return null;
  const curve: FigureOverlayCurve = { binding: { yKey: yKey as number, xKey: xKey as number | null }, y };
  if (withBand && Array.isArray(value.band)) {
    const band: FitBandEdges = [];
    for (const edge of value.band) {
      const ey = isObject(edge) ? cells(edge.y) : null;
      if (!isObject(edge) || typeof edge.label !== "string" || !ey || ey.length !== y.length) return null;
      band.push({ label: edge.label, y: ey, ...(typeof edge.legend === "string" ? { legend: edge.legend } : {}) });
    }
    if (band.length) curve.band = band;
  }
  return curve;
}

/** Validate a persisted section. A malformed curve drops the whole section
 *  (never part of a fit); the figure itself always loads. */
export function sanitizeFigureOverlays(value: unknown): FigureOverlays | undefined {
  if (!isObject(value) || typeof value.rows !== "string" || !value.rows) return undefined;
  const out: FigureOverlays = { rows: value.rows };
  let n: number | null = null;
  for (const [kind] of KINDS) {
    if (value[kind] === undefined) continue;
    const curve = sanitizeCurve(value[kind], kind === "fit");
    if (!curve || (n !== null && curve.y.length !== n)) return undefined;
    n = curve.y.length;
    out[kind] = curve;
  }
  return n === null ? undefined : out;
}
