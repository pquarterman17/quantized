// Form state -> recordable `sigop` params for the signal filters (Signal
// Processing workshop) and Reduce XY (Resample workshop). Pure: the view and the
// tests share it. Numeric fields are kept as the strings the inputs hold.

import type { SigopArgs, SigopMethod, SigopParams } from "../../../lib/transformSigop";

export type SigopFilterMethod = Exclude<SigopMethod, `reduce-${string}`>;
export type ReduceMethod = Extract<SigopMethod, `reduce-${string}`>;

export const SIGOP_FILTER_OPTIONS: { value: SigopFilterMethod; label: string }[] = [
  { value: "median", label: "Median filter" },
  { value: "despike", label: "Despike · median / MAD" },
  { value: "lowess", label: "Smooth · LOWESS" },
  { value: "convolve", label: "Convolve · Gaussian / Lorentzian" },
  { value: "deconvolve", label: "Deconvolve · Wiener" },
  { value: "hilbert", label: "Hilbert envelope" },
  { value: "ifft", label: "Inverse FFT" },
];

export const REDUCE_OPTIONS: { value: ReduceMethod; label: string }[] = [
  { value: "reduce-bin", label: "Bin-average by X" },
  { value: "reduce-duplicates", label: "Average duplicate X" },
  { value: "reduce-nth", label: "Keep every Nth row" },
];

export function isSigopFilter(value: string): value is SigopFilterMethod {
  return SIGOP_FILTER_OPTIONS.some((o) => o.value === value);
}

export interface SigopForm {
  window: string;
  threshold: string;
  fraction: string;
  iterations: string;
  kernel: "gaussian" | "lorentzian";
  fwhm: string;
  regularisation: string;
  output: "envelope" | "hilbert";
  removeMean: boolean;
  magnitudeChannel: number;
  phaseChannel: number;
  binMode: "width" | "count";
  binWidth: string;
  nBins: string;
  stat: "mean" | "median";
  withSd: boolean;
  withCount: boolean;
  xMode: "mean" | "center";
  tolerance: string;
  n: string;
  offset: string;
}

export const DEFAULT_SIGOP_FORM: SigopForm = {
  window: "5",
  threshold: "5",
  fraction: "0.3",
  iterations: "3",
  kernel: "gaussian",
  fwhm: "",
  regularisation: "0.001",
  output: "envelope",
  removeMean: true,
  magnitudeChannel: 0,
  phaseChannel: 1,
  binMode: "count",
  binWidth: "",
  nBins: "50",
  stat: "mean",
  withSd: false,
  withCount: false,
  xMode: "mean",
  tolerance: "0",
  n: "2",
  offset: "0",
};

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
const posInt = (s: string, min = 1): boolean => Number.isInteger(num(s)) && num(s) >= min;
const posNum = (s: string): boolean => Number.isFinite(num(s)) && num(s) > 0;

/** Default magnitude / phase columns for an inverse FFT: found by the label the
 *  FFT workbench writes ("… · Magnitude", "… · Phase"), else the first two. */
export function spectrumChannels(labels: readonly string[]): { magnitude: number; phase: number } {
  const mag = labels.findIndex((l) => /magnitude/i.test(l));
  const ph = labels.findIndex((l) => /phase/i.test(l));
  return { magnitude: mag >= 0 ? mag : 0, phase: ph >= 0 ? ph : Math.min(1, labels.length - 1) };
}

/** The params, or the sentence saying what to fix. */
export function sigopParamsFromForm(
  method: SigopMethod,
  f: SigopForm,
  channels: number[],
): SigopParams | string {
  const args: SigopArgs = {};
  let ch = channels;
  switch (method) {
    case "median":
      if (!posInt(f.window) || num(f.window) % 2 === 0) return "Window must be an odd whole number of rows.";
      args.window = num(f.window);
      break;
    case "despike":
      if (!posInt(f.window) || num(f.window) % 2 === 0) return "Window must be an odd whole number of rows.";
      if (!posNum(f.threshold)) return "Threshold must be a positive number of MADs.";
      args.window = num(f.window);
      args.threshold = num(f.threshold);
      break;
    case "lowess":
      if (!(num(f.fraction) > 0 && num(f.fraction) <= 1)) return "Fraction must be above 0 and at most 1.";
      if (!posInt(f.iterations, 0)) return "Robust iterations must be a whole number, 0 or more.";
      args.fraction = num(f.fraction);
      args.iterations = num(f.iterations);
      break;
    case "convolve":
    case "deconvolve":
      if (!posNum(f.fwhm)) return "Kernel width (FWHM, in X units) must be positive.";
      args.kernel = f.kernel;
      args.fwhm = num(f.fwhm);
      if (method === "deconvolve") {
        if (!posNum(f.regularisation)) return "Regularisation must be positive.";
        args.regularisation = num(f.regularisation);
      }
      break;
    case "hilbert":
      args.output = f.output;
      args.removeMean = f.removeMean;
      break;
    case "ifft":
      if (f.magnitudeChannel === f.phaseChannel) return "Pick different magnitude and phase columns.";
      args.magnitudeChannel = f.magnitudeChannel;
      args.phaseChannel = f.phaseChannel;
      ch = [];
      break;
    case "reduce-bin":
      if (f.binMode === "count") {
        if (!posInt(f.nBins)) return "Number of bins must be a positive whole number.";
        args.nBins = num(f.nBins);
      } else {
        if (!posNum(f.binWidth)) return "Bin width must be positive.";
        args.binWidth = num(f.binWidth);
      }
      args.xMode = f.xMode;
      args.stat = f.stat;
      args.withSd = f.withSd;
      args.withCount = f.withCount;
      break;
    case "reduce-duplicates":
      if (!(Number.isFinite(num(f.tolerance)) && num(f.tolerance) >= 0)) return "Tolerance must be zero or more.";
      args.tolerance = num(f.tolerance);
      args.stat = f.stat;
      args.withSd = f.withSd;
      args.withCount = f.withCount;
      break;
    case "reduce-nth":
      if (!posInt(f.n)) return "N must be a positive whole number.";
      if (!posInt(f.offset, 0)) return "First row must be a whole number, 0 or more.";
      args.n = num(f.n);
      args.offset = num(f.offset);
      ch = [];
      break;
  }
  if (method !== "ifft" && method !== "reduce-nth" && ch.length === 0) return "Select at least one column.";
  return { op: "sigop", method, channels: ch, args };
}
