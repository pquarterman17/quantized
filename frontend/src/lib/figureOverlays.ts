// A figure document's saved FIT CURVE (gap audit 5, lane C): the fit (with
// its Curve Fit band) a graph draws, kept ON the figure the way Origin keeps a
// fit curve as a plot in its graph -- so a saved figure, a Figure Page panel,
// a batch-built figure and a Library multi-figure PDF carry the fit instead of
// the bare data.
//
// The fit, and with a Peak Analyzer model fit its FITTED background (a result
// of that fit, tagged `BaselineOverlay.fitOf`). An ESTIMATED baseline and the
// peak markers are tool PREVIEWS (their panels clear them on close, and a
// dataset/view change clears them too), so they are not figure content.
//
// The live canvas draws the store's transient `fitOverlay` singleton. A plot
// window's document captures the fit IT drew whenever its view is committed,
// and the fit is put back when the window takes focus (store/windowOverlays.ts),
// so the canvas and every document render agree (lib/figureDocumentOverlaySpec).
//
// FAIL CLOSED. The curve is row-aligned to the data it was computed on and
// records its own `OverlayBinding` (the Y and the X it was read against, #679).
// `rows` is `overlayRowsKey` of that dataset: the numbers (lib/dataFingerprint)
// AND the row state the curve depends on -- the excluded / filtered-out rows
// and the column designations, roles and types. When the bound dataset no
// longer matches (cells edited, rows excluded or re-included, a column
// re-designated, a re-import), the curve is not drawn anywhere -- never
// re-aligned, never guessed onto other rows -- and the export reports it as
// left out. Placement on a per-series-X view and the "bound curve not shown"
// refusal are lib/overlayPlacement's, unchanged.
//
// Pure, and LAZY: the store reaches it through store/windowOverlaysLazy.ts,
// the export path through lib/figureDocumentOverlaySpec.

import { dataFingerprint } from "./dataFingerprint";
import type { FitBandEdges } from "./fitBandOverlay";
import type { BaselineOverlay, FitOverlay, OverlayBinding } from "./fitTypes";
import { droppedRows } from "./rowstate";
import type { Dataset } from "./types";

/** The saved curve: the store's overlay less its dataset tag (the document's
 *  own binding names the dataset). */
export interface FigureOverlayCurve {
  binding: OverlayBinding;
  y: (number | null)[];
  band?: FitBandEdges;
}

export interface FigureOverlays {
  /** `overlayRowsKey` of the dataset the curve aligns to. */
  rows: string;
  fit?: FigureOverlayCurve;
  /** The fit's fitted background (Peak Analyzer), saved and restored with it. */
  background?: FigureOverlayCurve;
}

/** The numbers and the row state a fit curve was drawn over (module header). */
export function overlayRowsKey(ds: Pick<Dataset, "data" | "excludedRows" | "filter" | "columnDesignations" | "channelRoles" | "channelTypes">): string {
  const state = JSON.stringify([
    [...droppedRows(ds as Dataset)].sort((a, b) => a - b),
    ds.columnDesignations ?? null,
    ds.channelRoles ?? null,
    ds.channelTypes ?? null,
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < state.length; i++) h = Math.imul(h ^ state.charCodeAt(i), 0x01000193);
  return `${dataFingerprint(ds.data)}.${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function curveFits(curve: { y: readonly unknown[]; band?: FitBandEdges }, n: number): boolean {
  return curve.y.length === n && (curve.band ?? []).every((edge) => edge.y.length === n);
}

/** A gap is null: the canvas fills gap rows with NaN, which JSON cannot carry
 *  and the section validator refuses (review N1). */
const cell = (v: number | null): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `fit` (and its fitted `background`, when it is this fit's) as a document
 *  section for dataset `ds`, keyed `rows` (default: `ds`'s rows now -- pass the
 *  key from when the curve was DRAWN, review N7); undefined when it is not
 *  `ds`'s, has no binding, or does not align to `ds`'s rows. A copy. */
export function captureFit(
  fit: FitOverlay | null, ds: Dataset | undefined, rows?: string, background?: BaselineOverlay | null,
): FigureOverlays | undefined {
  if (!fit || !ds || fit.datasetId !== ds.id || !fit.binding || !curveFits(fit, ds.data.time.length)) return undefined;
  const band = fit.band?.length ? { band: fit.band.map((e) => ({ ...e, y: e.y.map(cell) })) } : {};
  const out: FigureOverlays = { rows: rows ?? overlayRowsKey(ds), fit: structuredClone({ binding: fit.binding, y: fit.y.map(cell), ...band }) };
  if (background?.fitOf === fit && background.binding && curveFits(background, ds.data.time.length)) {
    out.background = structuredClone({ binding: background.binding, y: background.y.map(cell) });
  }
  return out;
}

/** The fitted background a section restores with `fit` (its own), or null. */
export function backgroundFromDocument(section: unknown, ds: Dataset | undefined, fit: FitOverlay | null): BaselineOverlay | null {
  const overlays = fit && ds ? sanitizeFigureOverlays(section) : undefined;
  if (!overlays?.background || !fit || !ds || !curveFits(overlays.background, ds.data.time.length)) return null;
  return { datasetId: ds.id, ...structuredClone(overlays.background), fitOf: fit };
}

/** The store overlay a document's saved section stands for, tagged with `ds`,
 *  or null when it holds no (valid) fit or `ds` no longer matches its rows. A
 *  document carries its section as loaded (the eager load path only
 *  shape-checks it, lib/figureDocument), so it is validated HERE. */
export function fitFromDocument(section: unknown, ds: Dataset | undefined): FitOverlay | null {
  const overlays = sanitizeFigureOverlays(section);
  if (!overlays?.fit || !ds || ds.pending || overlays.rows !== overlayRowsKey(ds)) return null;
  if (!curveFits(overlays.fit, ds.data.time.length)) return null;
  return { datasetId: ds.id, ...structuredClone(overlays.fit) };
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

function sanitizeCurve(value: unknown): FigureOverlayCurve | null {
  if (!isObject(value) || !isObject(value.binding)) return null;
  const { yKey, xKey } = value.binding;
  if (!Number.isInteger(yKey) || (yKey as number) < 0) return null;
  if (xKey !== null && (!Number.isInteger(xKey) || (xKey as number) < 0)) return null;
  const y = cells(value.y);
  if (!y) return null;
  const curve: FigureOverlayCurve = { binding: { yKey: yKey as number, xKey: xKey as number | null }, y };
  if (Array.isArray(value.band)) {
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

/** Validate a persisted section; undefined when it is malformed or holds no
 *  fit (never part of a fit). Unknown kinds are ignored. */
export function sanitizeFigureOverlays(value: unknown): FigureOverlays | undefined {
  if (!isObject(value) || typeof value.rows !== "string" || !value.rows) return undefined;
  const fit = sanitizeCurve(value.fit);
  if (!fit) return undefined;
  if (value.background === undefined) return { rows: value.rows, fit };
  const background = sanitizeCurve(value.background);
  return background && !background.band && background.y.length === fit.y.length
    ? { rows: value.rows, fit, background }
    : undefined;
}
