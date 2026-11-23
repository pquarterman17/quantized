// The Signal Processing spectrogram as a RECORDABLE transform (`op: "spectrogram"`),
// so "Save recipe" can store it in the Recipe Library and the Pipeline / batch
// apply can replay it. The maths is backend (calc/spectrogram.py, the same
// /api/spectral/spectrogram route the live preview calls); this module is the
// params, their validation for replay, and the ONE compute shared by both.
//
// Reads the dataset's ANALYSIS rows (exclusions/filters pruned), like the other
// transforms. The optional X range (`xMin` / `xMax`, inclusive) is applied by
// the backend before the segments are cut. Lazy: workshops and the runner only.

import { runSpectrogram } from "./api/spectrogram";
import { xWindowOf } from "./transformSigop";
import type { XWindow } from "./resultInputsRecord";
import type { DataStruct } from "./types";

export type SpectrogramWindowName = "hann" | "hamming" | "blackman" | "flattop" | "none";
const WINDOWS: readonly string[] = ["hann", "hamming", "blackman", "flattop", "none"];
const SCALINGS: readonly string[] = ["psd", "power", "amplitude"];
const DETRENDS: readonly string[] = ["mean", "linear", "none"];

export interface SpectrogramParams {
  op: "spectrogram";
  channel: number;
  segment_len: number;
  window: SpectrogramWindowName;
  overlap: number;
  scaling: "psd" | "power" | "amplitude";
  detrend: "mean" | "linear" | "none";
  resample: boolean;
  /** Optional inclusive X range; both absent = every row. */
  xMin?: number;
  xMax?: number;
  /** X unit the range and frequency axis were recorded in (recipes only): replay refuses a different unit. */
  xUnit?: string;
}

export function spectrogramLabel(primaryName: string): string {
  return `Spectrogram · ${primaryName}`;
}

export function spectrogramOutputName(source: string): string {
  return `${source} (spectrogram)`;
}

/** The inclusive X window of a spectrogram run, or undefined for every row. */
export function spectrogramXWindow(p: SpectrogramParams): XWindow | undefined {
  return xWindowOf(p.xMin, p.xMax);
}

/** The /api/spectral/spectrogram body for `data` (the range as the route names it). */
export function spectrogramBody(data: DataStruct, p: Omit<SpectrogramParams, "op" | "xMin" | "xMax"> & { xMin?: number; xMax?: number }) {
  const { xMin, xMax, ...rest } = p;
  return { dataset: data, ...rest, ...(xMin !== undefined ? { x_min: xMin } : {}), ...(xMax !== undefined ? { x_max: xMax } : {}) };
}

export async function computeSpectrogram(
  p: SpectrogramParams,
  source: { name: string; data: DataStruct },
  opts: { signal?: AbortSignal } = {},
): Promise<{ data: DataStruct; name: string }> {
  const { op: _op, xUnit: _xUnit, ...rest } = p;
  const data = await runSpectrogram(spectrogramBody(source.data, rest), opts.signal);
  return { data, name: spectrogramOutputName(source.name) };
}

/** Validate a recorded `spectrogram` step's params (a .dwk / template is user-editable JSON). */
export function spectrogramParamsOf(raw: Record<string, unknown>): SpectrogramParams {
  const whole = (key: string, min: number): number => {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < min) throw new Error(`"spectrogram" needs a whole number "${key}" of at least ${min}`);
    return v;
  };
  const oneOf = <T extends string>(key: string, allowed: readonly string[]): T => {
    const v = String(raw[key] ?? "");
    if (!allowed.includes(v)) throw new Error(`"spectrogram" has an unknown ${key} "${v}"`);
    return v as T;
  };
  const overlap = raw.overlap;
  if (typeof overlap !== "number" || !Number.isFinite(overlap) || overlap < 0 || overlap >= 1) {
    throw new Error('"spectrogram" overlap must be at least 0 and below 1');
  }
  const bound = (key: "xMin" | "xMax"): number | undefined => {
    const v = raw[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`"spectrogram" ${key} must be a finite number`);
    return v;
  };
  const xMin = bound("xMin");
  const xMax = bound("xMax");
  if (xMin !== undefined && xMax !== undefined && xMin >= xMax) throw new Error('"spectrogram" X minimum must be below X maximum');
  return {
    op: "spectrogram",
    channel: whole("channel", 0),
    segment_len: whole("segment_len", 1),
    window: oneOf<SpectrogramWindowName>("window", WINDOWS),
    overlap,
    scaling: oneOf<SpectrogramParams["scaling"]>("scaling", SCALINGS),
    detrend: oneOf<SpectrogramParams["detrend"]>("detrend", DETRENDS),
    resample: raw.resample === true,
    ...(typeof raw.xUnit === "string" ? { xUnit: raw.xUnit } : {}),
    ...(xMin !== undefined ? { xMin } : {}),
    ...(xMax !== undefined ? { xMax } : {}),
  };
}
