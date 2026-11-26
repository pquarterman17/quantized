// Map analysis workshop: the form model, the requests it produces and the
// readable summary of a result. Pure (no React, no store) so it is unit-testable.

import type { MapPeaksRequest, MapVolumeRequest } from "../../../lib/api/mapAnalysis";
import { boxColumns } from "../../../lib/mapBoxSpace";
import type { RoiRect } from "../../../lib/roi";
import type { DataStruct } from "../../../lib/types";

export type MapAnalysisMode = "peaks" | "volume";

export interface MapAnalysisForm {
  mode: MapAnalysisMode;
  model: "gaussian" | "lorentzian";
  rotate: boolean;
  nPeaks: string;
  threshold: string;
  minSep: string;
  smooth: string;
  window: string;
  x0: string; x1: string; y0: string; y1: string;
  bg: "none" | "constant" | "plane";
  bgValue: string;
  border: string;
  skipEmpty: boolean;
  rule: "pixel" | "trapezoid";
}

export const emptyForm = (): MapAnalysisForm => ({
  mode: "peaks", model: "gaussian", rotate: false, nPeaks: "", threshold: "0.05", minSep: "4", smooth: "1", window: "8",
  x0: "", x1: "", y0: "", y1: "", bg: "none", bgValue: "", border: "2", skipEmpty: false, rule: "pixel",
});

const num = (t: string): number => (t.trim() === "" ? NaN : Number(t));

type Built<R> = { req: R; error?: undefined } | { error: string; req?: undefined };
type Cols = { x_col?: number; y_col?: number; z_col?: number };

export function buildPeaksRequest(f: MapAnalysisForm): Built<Omit<MapPeaksRequest, "dataset" | keyof Cols>> {
  const thr = num(f.threshold), sep = num(f.minSep), sm = num(f.smooth), win = num(f.window);
  const n = f.nPeaks.trim() === "" ? null : Number(f.nPeaks);
  if (n !== null && (!Number.isInteger(n) || n < 1 || n > 100)) return { error: "Number of peaks must be a whole number from 1 to 100 (empty = every peak above the threshold)." };
  if (!(thr >= 0 && thr < 1)) return { error: "Threshold is a fraction of the map's range, from 0 up to (not including) 1." };
  if (!Number.isInteger(sep) || sep < 1) return { error: "Minimum separation must be a whole number of cells, at least 1." };
  if (!(sm >= 0)) return { error: "Smoothing must be zero or a positive number of cells." };
  if (!Number.isInteger(win) || win < 3) return { error: "Minimum fit window must be a whole number of cells, at least 3." };
  return { req: { n_peaks: n, threshold: thr, min_separation: sep, model: f.model, rotate: f.rotate, smooth_sigma: sm, fit_window: win } };
}

export function buildVolumeRequest(f: MapAnalysisForm): Built<Omit<MapVolumeRequest, "dataset" | keyof Cols>> {
  const b = [f.x0, f.x1, f.y0, f.y1].map(num);
  if (b.some((v) => !Number.isFinite(v))) return { error: "Enter all four rectangle bounds as numbers, or use the box drawn on the map." };
  const bord = num(f.border);
  if (!Number.isInteger(bord) || bord < 1) return { error: "Border width must be a whole number of cells, at least 1." };
  let background: MapVolumeRequest["background"] = { kind: f.bg } as MapVolumeRequest["background"];
  if (f.bg === "constant" && f.bgValue.trim() !== "") {
    const v = Number(f.bgValue);
    if (!Number.isFinite(v)) return { error: "The constant background must be a number (empty = the border mean)." };
    background = { kind: "constant", value: v };
  }
  return {
    req: {
      region: { kind: "rect", x0: b[0]!, x1: b[1]!, y0: b[2]!, y1: b[3]! },
      background, border: bord, on_nan: f.skipEmpty ? "skip" : "refuse", rule: f.rule,
    },
  };
}

/** The drawn box as bounds on the axes it was drawn on, with those axes' X / Y / value columns. */
export function drawnBounds(data: DataStruct, rect: RoiRect | null, zPick?: number): { bounds: [number, number, number, number]; cols: [number, number, number]; error?: undefined } | { error: string; bounds?: undefined; cols?: undefined } {
  if (!rect) return { error: "Draw a box on the map first (Box tool in the map toolbar)." };
  const keys = boxColumns(data, rect, zPick);
  if (typeof keys === "string") return { error: keys };
  if (!keys) return { error: "The box was drawn on axes this map does not have; type the bounds instead." };
  const nums = [rect.x0, rect.x1, rect.y0, rect.y1];
  if (!nums.every(Number.isFinite)) return { error: "The drawn box is not a valid rectangle." };
  return { cols: keys, bounds: [Math.min(rect.x0, rect.x1), Math.max(rect.x0, rect.x1), Math.min(rect.y0, rect.y1), Math.max(rect.y0, rect.y1)] };
}

export const boundText = (v: number): string => String(Number(v.toPrecision(12)));

const g = (v: unknown): string => (typeof v === "number" ? String(Number(v.toPrecision(5))) : "n/a");
const pm = (v: unknown, e: unknown): string => (typeof e === "number" ? `${g(v)} ± ${g(e)}` : g(v));

interface PeakRow { rank: number; ok: boolean; message?: string; x0: number | null; x0_err: number | null; y0: number | null; y0_err: number | null; volume: number | null; volume_err: number | null }

/** One line per peak or the volume lines, from the committed table's metadata. */
export function summarize(out: DataStruct, mode: MapAnalysisMode): string[] {
  const m = out.metadata ?? {};
  if (mode === "peaks") {
    const info = m["map_peaks"] as { peaks?: PeakRow[]; n_found?: number; n_merged?: number } | undefined;
    const peaks = info?.peaks ?? [];
    const head = `${peaks.length} peak${peaks.length === 1 ? "" : "s"} fitted${info?.n_found && info.n_found > peaks.length ? ` (${info.n_found} found)` : ""}`;
    const merged = info?.n_merged ?? 0;
    const note = merged > 0 ? [`${merged} maxima merged out (flank bumps or duplicates of a brighter peak)`] : [];
    return [head, ...note, ...peaks.map((p) => (p.ok
      ? `#${p.rank}: x ${pm(p.x0, p.x0_err)}, y ${pm(p.y0, p.y0_err)}, volume ${pm(p.volume, p.volume_err)}`
      : `#${p.rank}: fit failed (${p.message ?? "unknown"})`))];
  }
  const v = m["map_volume"] as Record<string, unknown> | undefined;
  if (!v) return [];
  return [`Volume ${g(v["volume"])}${v["rule"] === "trapezoid" ? " (trapezoid rule)" : ""}`, `Area ${g(v["area"])} over ${String(v["n_cells"])} cells${Number(v["n_nan"]) > 0 ? ` (${String(v["n_nan"])} empty skipped)` : ""}`, `Mean ${g(v["mean"])}`];
}
