// Signal Processing, Spectrogram (short-time Fourier transform): form state ->
// the /api/spectral/spectrogram request, or the sentence saying what to fix.
// Pure: the view and the tests share it. Numeric fields stay the strings the
// inputs hold. The maths is `calc/spectrogram.py`.

import type { SpectrogramParams } from "../../../lib/transformSpectrogram";
import type { DataStruct } from "../../../lib/types";

export const SPECTROGRAM_OPERATION = "spectrogram" as const;

export type SpectrogramWindow = "hann" | "hamming" | "blackman" | "flattop" | "none";
export type SpectrogramScaling = "psd" | "power" | "amplitude";
export type SpectrogramDetrend = "mean" | "linear" | "none";

export const SPECTROGRAM_WINDOWS: { value: SpectrogramWindow; label: string }[] = [
  { value: "hann", label: "Hann" },
  { value: "hamming", label: "Hamming" },
  { value: "blackman", label: "Blackman" },
  { value: "flattop", label: "Flat top" },
  { value: "none", label: "None (rectangular)" },
];

export const SPECTROGRAM_SCALINGS: { value: SpectrogramScaling; label: string }[] = [
  { value: "psd", label: "Power spectral density" },
  { value: "power", label: "Power spectrum" },
  { value: "amplitude", label: "Amplitude" },
];

export interface SpectrogramForm {
  window: SpectrogramWindow;
  segmentLen: string;
  /** Percent of a segment shared with the next one: 0 to under 100. */
  overlapPct: string;
  scaling: SpectrogramScaling;
  detrend: SpectrogramDetrend;
  /** Opt in to interpolating an unevenly spaced X axis onto an even grid. */
  resample: boolean;
  /** Optional X range: cut the segments from rows with xMin <= X <= xMax (inclusive). */
  useRange: boolean;
  xMin: string;
  xMax: string;
}

export const DEFAULT_SPECTROGRAM_FORM: SpectrogramForm = {
  window: "hann",
  segmentLen: "256",
  overlapPct: "50",
  scaling: "psd",
  detrend: "mean",
  resample: false,
  useRange: false,
  xMin: "",
  xMax: "",
};

/** Must match `calc/spectrogram.py` `MAX_CELLS` / `_MIN_SEGMENT`. */
export const SPECTROGRAM_MAX_CELLS = 2_000_000;
export const SPECTROGRAM_MIN_SEGMENT = 8;

export interface SpectrogramRequestParams {
  channel: number;
  segment_len: number;
  window: SpectrogramWindow;
  overlap: number;
  scaling: SpectrogramScaling;
  detrend: SpectrogramDetrend;
  resample: boolean;
  /** Present only when the X range is on (the route's own names). */
  x_min?: number;
  x_max?: number;
}

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));

/** The request parameters, or the sentence saying what to fix. `rows` is the
 *  number of rows the transform will read (an upper bound: the backend also
 *  drops non-finite rows and refuses again if that leaves too few). */
export function spectrogramParams(
  form: SpectrogramForm, channel: number | null, totalRows: number, x: readonly number[] = [], y?: readonly (number | null | undefined)[],
): SpectrogramRequestParams | string {
  if (channel === null) return "Select a signal column.";
  // The backend (calc/spectral_grid.selected_arrays) keeps finite (X, Y) pairs only.
  const finite = (v: unknown): boolean => typeof v === "number" && Number.isFinite(v);
  let rows = y ? x.reduce((n, v, i) => n + (finite(v) && finite(y[i]) ? 1 : 0), 0) : totalRows;
  const range: { x_min?: number; x_max?: number } = {};
  if (form.useRange) {
    const lo = num(form.xMin);
    const hi = num(form.xMax);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi) return "X range must be finite and increasing.";
    range.x_min = lo;
    range.x_max = hi;
    rows = x.reduce((n, v, i) => n + (Number.isFinite(v) && v >= lo && v <= hi && (!y || finite(y[i])) ? 1 : 0), 0); // the rows the segments are cut from
    if (rows === 0) return "No rows fall inside the X range.";
  }
  const segment = num(form.segmentLen);
  if (!Number.isInteger(segment) || segment < SPECTROGRAM_MIN_SEGMENT) {
    return `Segment length must be a whole number of at least ${SPECTROGRAM_MIN_SEGMENT} rows.`;
  }
  if (segment > rows) return `Segment length (${segment}) cannot exceed the ${rows.toLocaleString()} rows available.`;
  const pct = num(form.overlapPct);
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return "Overlap must be at least 0 and under 100 percent.";
  const overlap = pct / 100;
  const shared = Math.floor(overlap * segment + 1e-9); // same epsilon as calc/spectrogram.py
  const hop = segment - shared;
  const cells = Math.floor((rows - shared) / hop) * (Math.floor(segment / 2) + 1);
  if (cells > SPECTROGRAM_MAX_CELLS) {
    return `This would make about ${cells.toLocaleString()} cells (limit ${SPECTROGRAM_MAX_CELLS.toLocaleString()}); use a shorter segment or less overlap.`;
  }
  return {
    channel, segment_len: segment, window: form.window, overlap, scaling: form.scaling,
    detrend: form.detrend, resample: form.resample, ...range,
  };
}

export function spectrogramRequest(data: DataStruct, params: SpectrogramRequestParams) {
  return { dataset: data, ...params };
}

/** The recordable transform for the current setup (what Save recipe stores). */
export function spectrogramTransformParams(params: SpectrogramRequestParams): SpectrogramParams {
  const { x_min, x_max, ...rest } = params;
  return { op: "spectrogram", ...rest, ...(x_min !== undefined ? { xMin: x_min } : {}), ...(x_max !== undefined ? { xMax: x_max } : {}) };
}

/** The grid size the backend recorded on its output (null for any other table). */
export function spectrogramGrid(data: DataStruct): { segments: number; frequencies: number } | null {
  const sa = data.metadata["spectralAnalysis"] as { operation?: unknown; parameters?: { segments?: unknown; frequencies?: unknown } } | undefined;
  const segments = sa?.parameters?.segments;
  const frequencies = sa?.parameters?.frequencies;
  if (sa?.operation !== "spectrogram" || typeof segments !== "number" || typeof frequencies !== "number") return null;
  return segments * frequencies === data.time.length ? { segments, frequencies } : null;
}
