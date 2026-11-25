// Export defaults (PREFS_AUDIT lane 2, P1-4): what a NEW export starts from,
// in one `qz.exportPrefs` slot. Read by the Figure Builder, the quick Export
// dialog, the auxiliary-figure panels and the file export chokepoint (`withExportPrefs`, called from api/figureRenderInfo).
//
// Fail closed: every default equals today's behaviour (vector PDF, the
// "default" style, each surface's own legacy DPI, opaque, live SVG text), so
// nothing changes unless the user changes a pref. All defaults are
// PROVISIONAL, owner to confirm.
//
// DPI PRECEDENCE (owner decision 2026-11-25): a style preset's calibrated DPI
// WINS over the pref. The pref applies only where the preset sets none: the
// uncalibrated "default" baseline (its 200 is the interactive fallback, not a
// journal spec; calc/figure_styles.py) and an unknown style. SIZE: a style
// preset IS the size (FIGURE_STYLE_SIZE_CM), so the size default is the
// default style preset; a window's Page setup size still overrides it.
//
// Eager-light: this module is tiny and imports no store.

import { definePrefSlot } from "./prefSlots";
import { FIGURE_STYLE_DPI } from "./figureStyleDpi";

export const EXPORT_FORMATS = ["pdf", "svg", "eps", "png", "tiff"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
/** The formats the auxiliary figure panels (ternary, pie, polar map, ...) offer. */
export const AUX_EXPORT_FORMATS: readonly string[] = ["pdf", "svg", "png"];
/** Raster DPI range the export routes accept. */
export const EXPORT_DPI_RANGE = [50, 1200] as const;

export interface ExportPrefs {
  /** Vector stays the default (provisional, owner to confirm). */
  format: ExportFormat;
  /** The style preset id: also the figure size (see header). */
  stylePreset: string;
  /** Raster DPI; 0 = no pref, each surface keeps its own legacy default. */
  dpi: number;
  /** Transparent background for file export (Copy figure has its own pref). */
  transparent: boolean;
  /** SVG only: glyphs as path outlines (`svg_text_as_paths`). */
  textAsPaths: boolean;
}

export const EXPORT_PREF_DEFAULTS: ExportPrefs = { format: "pdf", stylePreset: "default", dpi: 0, transparent: false, textAsPaths: false };

function parse(raw: Record<string, unknown>): ExportPrefs {
  const d = EXPORT_PREF_DEFAULTS;
  const dpi = raw.dpi;
  return {
    format: EXPORT_FORMATS.includes(raw.format as ExportFormat) ? (raw.format as ExportFormat) : d.format,
    stylePreset: typeof raw.stylePreset === "string" && raw.stylePreset in FIGURE_STYLE_DPI ? raw.stylePreset : d.stylePreset,
    dpi: typeof dpi === "number" && Number.isFinite(dpi) && dpi >= EXPORT_DPI_RANGE[0] && dpi <= EXPORT_DPI_RANGE[1] ? Math.round(dpi) : d.dpi,
    transparent: typeof raw.transparent === "boolean" ? raw.transparent : d.transparent,
    textAsPaths: typeof raw.textAsPaths === "boolean" ? raw.textAsPaths : d.textAsPaths,
  };
}

export const exportPrefsSlot = definePrefSlot("qz.exportPrefs", EXPORT_PREF_DEFAULTS, parse);
export const exportPrefs = (): ExportPrefs => exportPrefsSlot.load();

/** The pref format when `allowed` offers it, else "pdf" (an aux panel without EPS/TIFF). */
export function exportFormatFor(allowed: readonly string[] = EXPORT_FORMATS): string {
  const f = exportPrefs().format;
  return allowed.includes(f) ? f : "pdf";
}

/** The DPI a style starts at. Calibrated preset DPI WINS; else the pref when
 *  set; else `fallback` (a surface's legacy default), else the preset table's
 *  own entry; undefined for an unknown style with nothing to say. */
export function exportDpiFor(style: string, fallback?: number): number | undefined {
  const calibrated = style === "default" ? undefined : FIGURE_STYLE_DPI[style];
  if (calibrated !== undefined) return calibrated;
  const pref = exportPrefs().dpi;
  if (pref > 0) return pref;
  return fallback ?? FIGURE_STYLE_DPI[style];
}

/** A request with the file-export prefs laid over fields it left unset
 *  (transparent background, SVG text as paths). Returns `body` itself when
 *  nothing applies, so default output is byte-identical. */
export function withExportPrefs<T extends { fmt?: string; transparent?: boolean; svg_text_as_paths?: boolean }>(body: T): T {
  const p = exportPrefs();
  const transparent = p.transparent && body.transparent === undefined;
  const paths = p.textAsPaths && body.fmt === "svg" && body.svg_text_as_paths === undefined;
  if (!transparent && !paths) return body;
  return { ...body, ...(transparent ? { transparent: true } : {}), ...(paths ? { svg_text_as_paths: true } : {}) };
}

/** The output a figure document shows when a field was never chosen: a field
 *  still at the document's own default (pdf / default / 300 dpi / opaque) and
 *  not in `touched` (fields the user edited in this session) reads the pref,
 *  so Preferences ▸ Export shows through in Publication Preview. Any other
 *  value is the document's own (an explicit choice wins). With no prefs set
 *  this returns `doc` itself. Read-side only: the stored document is never
 *  rewritten, so Apply and the discard prompt are unaffected. */
export function seedDocumentOutput<D extends { output: { format: string; stylePreset: string; dpi: number; transparent: boolean } }>(
  doc: D | null,
  touched: readonly string[],
): D | null {
  if (!doc) return doc;
  const o = doc.output, p = exportPrefs(), next = { ...o };
  const free = (k: string, legacy: unknown) => !touched.includes(k) && (o as Record<string, unknown>)[k] === legacy;
  if (free("format", "pdf")) next.format = p.format;
  if (free("stylePreset", "default")) next.stylePreset = p.stylePreset;
  if (free("dpi", 300)) next.dpi = exportDpiFor(next.stylePreset, 300) ?? 300;
  if (free("transparent", false)) next.transparent = p.transparent;
  return (Object.keys(o) as (keyof typeof o)[]).every((k) => next[k] === o[k]) ? doc : { ...doc, output: next };
}
