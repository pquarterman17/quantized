// "Open in Signal Processing (Spectrogram)" (OPEN_ITEMS row 12, reopen gaps
// lane): the recorded request of a Spectrogram output, read back strictly.
// FAIL CLOSED: null unless EVERY setting is present and of the right type; the
// X range is both edges or neither. The signal column is proved by
// `extra.picks` (lib/reductionsReopenSeed.ts: position AND name). Lazy:
// imported by the Spectrogram body and the lazy opener only.

import type { ReopenSeed } from "./committedOutputReopen";

export const SPECTROGRAM_REOPEN_TOOL = "signal-spectrogram";

const WINDOWS = ["hann", "hamming", "blackman", "flattop", "none"] as const;
const SCALINGS = ["psd", "power", "amplitude"] as const;
const DETRENDS = ["mean", "linear", "none"] as const;

export interface SpectrogramSeed {
  channel: number;
  segmentLen: number;
  window: (typeof WINDOWS)[number];
  /** Percent shared between segments, as the form holds it. */
  overlapPct: number;
  scaling: (typeof SCALINGS)[number];
  detrend: (typeof DETRENDS)[number];
  resample: boolean;
  range: { xMin: number; xMax: number } | null;
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value);

export function spectrogramSeed(s: ReopenSeed | null | undefined): SpectrogramSeed | null {
  if (!s) return null;
  const { channel, segment_len, window, overlap, scaling, detrend, resample, x_min, x_max } = s;
  if (!isNumber(channel) || !Number.isInteger(channel) || channel < 0 || !isNumber(segment_len) || !Number.isInteger(segment_len)
    || !oneOf(window, WINDOWS) || !isNumber(overlap) || overlap < 0 || overlap >= 1 || !oneOf(scaling, SCALINGS)
    || !oneOf(detrend, DETRENDS) || typeof resample !== "boolean") return null;
  if ((x_min === undefined) !== (x_max === undefined)) return null;
  if (x_min !== undefined && (!isNumber(x_min) || !isNumber(x_max))) return null;
  return {
    channel, segmentLen: segment_len, window, overlapPct: Number((overlap * 100).toFixed(6)), scaling, detrend, resample,
    range: isNumber(x_min) && isNumber(x_max) ? { xMin: x_min, xMax: x_max } : null,
  };
}
