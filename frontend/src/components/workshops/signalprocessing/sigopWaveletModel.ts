// Form state -> recordable args for the wavelet `sigop` methods (item 6 of the
// Origin gap plan): continuous (CWT) and discrete (DWT) transforms, reconstruction
// from chosen levels, wavelet smoothing and wavelet denoising. Split from
// sigopModel.ts, which dispatches here. Numeric fields are the strings the inputs
// hold; a blank CWT range is "auto" (the backend picks it). The maths is backend
// (calc/wavelets.py, calc/wavelet_ops.py, PyWavelets, an optional extra).

import type { SigopArgs, SigopMethod } from "../../../lib/transformSigop";

export type SigopWaveletMethod = "cwt" | "dwt" | "wavelet-reconstruct" | "wavelet-smooth" | "wavelet-denoise";

export const SIGOP_WAVELET_OPTIONS: { value: SigopWaveletMethod; label: string }[] = [
  { value: "cwt", label: "Wavelet · continuous (CWT scalogram)" },
  { value: "dwt", label: "Wavelet · discrete (DWT coefficients)" },
  { value: "wavelet-reconstruct", label: "Wavelet · reconstruct from levels" },
  { value: "wavelet-smooth", label: "Smooth · wavelet (zero detail levels)" },
  { value: "wavelet-denoise", label: "Denoise · wavelet threshold" },
];

/** Methods whose output has its own axis (a map, or coefficient indices): no overlay on the source. */
export const WAVELET_NEW_AXIS: readonly SigopMethod[] = ["cwt", "dwt"];

export const DISCRETE_WAVELETS = [
  "haar", "db2", "db4", "db6", "db8", "db10", "sym2", "sym4", "sym6", "sym8",
  "coif1", "coif2", "coif3", "coif4", "bior1.3", "bior2.2", "bior3.5", "bior4.4", "rbio3.5", "dmey",
];
export const EXTENSION_MODES = [
  "symmetric", "periodization", "zero", "constant", "smooth", "reflect", "antisymmetric", "antireflect", "periodic", "origin-periodic",
];

export interface SigopWaveletForm {
  cwtFamily: "morlet" | "mexican-hat" | "gaussian";
  cwtBandwidth: string;
  cwtCenter: string;
  cwtOrder: string;
  cwtAxis: "frequency" | "scale";
  cwtMin: string;
  cwtMax: string;
  cwtCount: string;
  cwtSpacing: "log" | "linear";
  cwtOutput: "scalogram" | "ridge";
  dwtWavelet: string;
  dwtLevel: string;
  dwtMode: string;
  /** Reconstruct: components switched OFF, comma list of "A" and detail levels ("" = keep all). */
  reconOff: string;
  /** Smooth: detail levels to zero, comma list ("1,2"). */
  smoothZero: string;
  /** Smooth: OriginPro's cutoff, a percentage of the detail coefficients to zero ("" = zero the ticked levels instead). */
  smoothCutoff: string;
  denoiseRule: "universal" | "sure" | "percent";
  /** Rule "percent" (OriginPro's custom threshold): hard threshold at this percentage of the largest detail coefficient. */
  denoisePercent: string;
  denoiseThreshold: "soft" | "hard";
  denoiseScope: "global" | "per-level";
}

export const DEFAULT_SIGOP_WAVELET_FORM: SigopWaveletForm = {
  cwtFamily: "morlet",
  cwtBandwidth: "1.5",
  cwtCenter: "1",
  cwtOrder: "2",
  cwtAxis: "frequency",
  cwtMin: "",
  cwtMax: "",
  cwtCount: "64",
  cwtSpacing: "log",
  cwtOutput: "scalogram",
  dwtWavelet: "db4",
  dwtLevel: "4",
  dwtMode: "symmetric",
  reconOff: "",
  smoothZero: "1",
  smoothCutoff: "",
  denoisePercent: "50",
  denoiseRule: "universal",
  denoiseThreshold: "soft",
  denoiseScope: "global",
};

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
const whole = (s: string, min: number, max = Infinity): boolean => Number.isInteger(num(s)) && num(s) >= min && num(s) <= max;
const blank = (s: string): boolean => s.trim() === "";

export function isWaveletMethod(method: string): method is SigopWaveletMethod {
  return SIGOP_WAVELET_OPTIONS.some((o) => o.value === method);
}

/** Tokens of a comma list ("A,2"): "A" and whole numbers, deduplicated. */
export function levelTokens(list: string): string[] {
  return [...new Set(list.split(",").map((t) => t.trim()).filter((t) => t !== ""))];
}

/** `{args, channels}` for a wavelet method, or the sentence saying what to fix. */
export function waveletArgsFromForm(
  method: SigopWaveletMethod,
  f: SigopWaveletForm,
  channels: number[],
): { args: SigopArgs; channels: number[] } | string {
  const args: SigopArgs = {};
  if (method === "cwt") {
    if (channels.length !== 1) return "The continuous wavelet transform takes exactly one signal column.";
    if (f.cwtFamily === "morlet") {
      if (!(num(f.cwtBandwidth) > 0) || !(num(f.cwtCenter) > 0)) return "Morlet bandwidth and centre frequency must be positive.";
      args.bandwidth = num(f.cwtBandwidth);
      args.centerFrequency = num(f.cwtCenter);
    }
    if (f.cwtFamily === "gaussian") {
      if (!whole(f.cwtOrder, 1, 8)) return "Gaussian-derivative order must be a whole number from 1 to 8.";
      args.order = num(f.cwtOrder);
    }
    if (!whole(f.cwtCount, 2, 512)) return "Number of scales must be a whole number from 2 to 512.";
    for (const [s, label] of [[f.cwtMin, "minimum"], [f.cwtMax, "maximum"]] as const) {
      if (!blank(s) && !(Number.isFinite(num(s)) && num(s) > 0)) return `The ${label} must be a positive number (or blank for automatic).`;
    }
    if (!blank(f.cwtMin) && !blank(f.cwtMax) && !(num(f.cwtMin) < num(f.cwtMax))) return "The minimum must be below the maximum.";
    args.wavelet = f.cwtFamily;
    args.axis = f.cwtAxis;
    args.count = num(f.cwtCount);
    args.spacing = f.cwtSpacing;
    args.output = f.cwtOutput;
    if (!blank(f.cwtMin)) args.axisMin = num(f.cwtMin);
    if (!blank(f.cwtMax)) args.axisMax = num(f.cwtMax);
    return { args, channels };
  }
  if (!whole(f.dwtLevel, 1, 20)) return "Level must be a whole number from 1 to 20.";
  const level = num(f.dwtLevel);
  args.wavelet = f.dwtWavelet;
  args.level = level;
  args.mode = f.dwtMode;
  if (method === "wavelet-reconstruct") {
    const off = new Set(levelTokens(f.reconOff));
    const keep = ["A", ...Array.from({ length: level }, (_, i) => String(level - i))].filter((t) => !off.has(t));
    if (keep.length === 0) return "Keep at least one level.";
    args.keep = keep.join(",");
  } else if (method === "wavelet-smooth" && !blank(f.smoothCutoff)) {
    if (!(Number.isFinite(num(f.smoothCutoff)) && num(f.smoothCutoff) >= 0 && num(f.smoothCutoff) <= 100)) return "The cutoff must be a percentage from 0 to 100 (or blank to zero ticked levels).";
    args.cutoff = num(f.smoothCutoff);
  } else if (method === "wavelet-smooth") {
    const zero = levelTokens(f.smoothZero).filter((t) => Number(t) >= 1 && Number(t) <= level);
    if (zero.length === 0) return "Choose at least one detail level to zero.";
    args.zero = zero.join(",");
  } else if (method === "wavelet-denoise") {
    args.rule = f.denoiseRule;
    args.threshold = f.denoiseRule === "percent" ? "hard" : f.denoiseThreshold;
    if (f.denoiseRule === "percent") {
      if (!(Number.isFinite(num(f.denoisePercent)) && num(f.denoisePercent) >= 0 && num(f.denoisePercent) <= 100)) return "The threshold must be a percentage from 0 to 100.";
      args.percent = num(f.denoisePercent);
    }
    args.scope = f.denoiseScope;
  }
  return { args, channels };
}
