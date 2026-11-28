// Map operations workshop: the form model and the request/name it produces.
// Pure (no React, no store) so the wiring is unit-testable.

import type { MapOpRequest } from "../../../lib/api/mapOps";

export type MapOpKind = "crop" | "flip" | "rotate" | "transpose" | "level" | "arith" | "scalar" | "fft" | "fftfilter" | "imgfilter" | "wavelet2d";

export const OP_OPTIONS: { value: MapOpKind; label: string }[] = [
  { value: "crop", label: "Crop to a rectangle" },
  { value: "flip", label: "Flip" },
  { value: "rotate", label: "Rotate" },
  { value: "transpose", label: "Transpose" },
  { value: "level", label: "Plane / surface level" },
  { value: "arith", label: "Map ± × ÷ map" },
  { value: "scalar", label: "Map ± × ÷ number" },
  { value: "fft", label: "2-D FFT (spectrum)" },
  { value: "fftfilter", label: "2-D FFT filter" },
  { value: "imgfilter", label: "Image filter (smooth / edges)" },
  { value: "wavelet2d", label: "2-D wavelet (denoise / smooth)" },
];

export const ARITH_OPTIONS = [
  { value: "add", label: "A + B" },
  { value: "sub", label: "A − B" },
  { value: "mul", label: "A × B" },
  { value: "div", label: "A ÷ B" },
] as const;

export interface MapOpsForm {
  op: MapOpKind;
  xmin: string; xmax: string; ymin: string; ymax: string;
  flipAxis: "h" | "v";
  degrees: "90" | "180" | "270";
  order: "1" | "2";
  restoreMean: boolean;
  arith: "add" | "sub" | "mul" | "div";
  otherId: string;
  interpolate: boolean;
  allowMismatch: boolean;
  scalar: string;
  reverse: boolean;
  fftOutput: "magnitude" | "log_magnitude" | "power" | "phase";
  fftWindow: "none" | "hann" | "tukey";
  fftRemoveMean: boolean;
  fMode: "lowpass" | "highpass" | "bandpass" | "bandstop";
  cutLow: string; cutHigh: string; edgeSigma: string;
  imgKind: "gaussian" | "median" | "uniform" | "sobel" | "laplacian";
  sigma: string; size: string;
  edgeMode: "reflect" | "nearest" | "mirror" | "wrap" | "constant";
  cval: string;
  gradient: "magnitude" | "x" | "y";
  wtAction: "denoise" | "smooth";
  wtWavelet: string;
  /** "" = automatic (up to 3, as deep as the map allows). */
  wtLevel: string;
  wtMode: string;
  wtThreshold: "soft" | "hard";
  /** Denoise: absolute threshold in the map's value unit; "" = universal (noise from the finest diagonal band). */
  wtValue: string;
  /** Smooth: detail levels to zero, comma list ("1,2"). */
  wtZero: string;
}

export const emptyForm = (): MapOpsForm => ({
  op: "crop", xmin: "", xmax: "", ymin: "", ymax: "", flipAxis: "h", degrees: "90", order: "1", restoreMean: false,
  arith: "sub", otherId: "", interpolate: false, allowMismatch: false, scalar: "1", reverse: false,
  fftOutput: "magnitude", fftWindow: "none", fftRemoveMean: false,
  fMode: "lowpass", cutLow: "", cutHigh: "", edgeSigma: "0",
  imgKind: "gaussian", sigma: "1", size: "3", edgeMode: "reflect", cval: "0", gradient: "magnitude",
  wtAction: "denoise", wtWavelet: "db4", wtLevel: "", wtMode: "symmetric", wtThreshold: "soft", wtValue: "", wtZero: "1",
});

const num = (t: string): number => (t.trim() === "" ? NaN : Number(t));

/** "" -> null (unbounded); a non-number -> NaN so the caller can name it. */
const bound = (t: string): number | null => (t.trim() === "" ? null : Number(t));

const SYMBOL = { add: "+", sub: "−", mul: "×", div: "÷" } as const;

/** The request body for the form (without the dataset payloads), or an error text. */
export function buildRequest(f: MapOpsForm): { req: Omit<MapOpRequest, "dataset">; error?: undefined } | { error: string; req?: undefined } {
  switch (f.op) {
    case "crop": {
      const b = [f.xmin, f.xmax, f.ymin, f.ymax].map(bound);
      if (b.some((v) => v !== null && !Number.isFinite(v))) return { error: "Crop bounds must be numbers (leave a bound empty for no limit)." };
      if (b.every((v) => v === null)) return { error: "Enter at least one crop bound." };
      return { req: { op: "crop", xmin: b[0], xmax: b[1], ymin: b[2], ymax: b[3] } };
    }
    case "flip": return { req: { op: "flip", axis: f.flipAxis } };
    case "rotate": return { req: { op: "rotate", degrees: Number(f.degrees) } };
    case "transpose": return { req: { op: "transpose" } };
    case "level": return { req: { op: "plane_level", order: Number(f.order), restore_mean: f.restoreMean } };
    case "arith":
      if (!f.otherId) return { error: "Pick the second map (B)." };
      return { req: { op: "arith", arith: f.arith, interpolate: f.interpolate, allow_mismatch: f.allowMismatch } };
    case "scalar": {
      const v = Number(f.scalar);
      if (f.scalar.trim() === "" || !Number.isFinite(v)) return { error: "Enter the number to combine with." };
      return { req: { op: "scalar", arith: f.arith, value: v, reverse: f.reverse } };
    }
    case "fft":
      return { req: { op: "fft2d", fft_output: f.fftOutput, window: f.fftWindow, remove_mean: f.fftRemoveMean } };
    case "fftfilter": {
      const lo = num(f.cutLow), hi = num(f.cutHigh), es = num(f.edgeSigma);
      const needLo = f.fMode !== "lowpass", needHi = f.fMode !== "highpass";
      if ((needLo && !(lo > 0)) || (needHi && !(hi > 0))) return { error: "Enter the cutoff(s) as positive numbers in 1/axis units." };
      if (f.edgeSigma.trim() !== "" && !(es >= 0)) return { error: "Edge softness must be zero or a positive number." };
      return { req: { op: "fft_filter", filter_mode: f.fMode, cutoff_low: needLo ? lo : null, cutoff_high: needHi ? hi : null, edge_sigma: f.edgeSigma.trim() === "" ? 0 : es } };
    }
    case "imgfilter": {
      const base = { op: "image_filter" as const, filter_kind: f.imgKind, edge_mode: f.edgeMode };
      const cv = num(f.cval);
      if (f.edgeMode === "constant" && !Number.isFinite(cv)) return { error: "Enter the constant edge value." };
      const common = { ...base, ...(f.edgeMode === "constant" ? { cval: cv } : {}) };
      if (f.imgKind === "gaussian") {
        const sg = num(f.sigma);
        if (!(sg > 0)) return { error: "Gaussian sigma must be a positive number of pixels." };
        return { req: { ...common, sigma: sg } };
      }
      if (f.imgKind === "median" || f.imgKind === "uniform") {
        const sz = num(f.size);
        if (!Number.isInteger(sz) || sz < 1) return { error: "Window size must be a whole number of pixels." };
        return { req: { ...common, size: sz } };
      }
      return { req: f.imgKind === "sobel" ? { ...common, gradient: f.gradient } : common };
    }
    case "wavelet2d": {
      const lv = num(f.wtLevel), tv = num(f.wtValue);
      if (f.wtLevel.trim() !== "" && !(Number.isInteger(lv) && lv >= 1)) return { error: "Level must be a whole number of 1 or more (blank for automatic)." };
      const base = { op: "wavelet2d" as const, wt_action: f.wtAction, wt_wavelet: f.wtWavelet, wt_mode: f.wtMode, ...(f.wtLevel.trim() === "" ? {} : { wt_level: lv }) };
      if (f.wtAction === "smooth") {
        const zero = f.wtZero.split(",").map((t) => t.trim()).filter((t) => t !== "");
        if (zero.length === 0 || zero.some((t) => !Number.isInteger(Number(t)) || Number(t) < 1)) return { error: "Enter the detail levels to zero as whole numbers, like 1,2." };
        return { req: { ...base, wt_zero: zero.join(",") } };
      }
      if (f.wtValue.trim() !== "" && !(tv >= 0)) return { error: "The threshold must be zero or a positive number (blank for the automatic one)." };
      return { req: { ...base, wt_threshold: f.wtThreshold, ...(f.wtValue.trim() === "" ? {} : { wt_value: tv }) } };
    }
  }
}

/** Short label of the operation, used in the result's name. */
export function opLabel(f: MapOpsForm, otherName?: string): string {
  switch (f.op) {
    case "crop": return "crop";
    case "flip": return f.flipAxis === "h" ? "flip H" : "flip V";
    case "rotate": return `rotate ${f.degrees}°`;
    case "transpose": return "transpose";
    case "level": return f.order === "1" ? "plane level" : "quadric level";
    case "arith": return `A ${SYMBOL[f.arith]} ${otherName ?? "B"}`;
    case "scalar": return f.reverse ? `${f.scalar} ${SYMBOL[f.arith]} A` : `A ${SYMBOL[f.arith]} ${f.scalar}`;
    case "fft": return `FFT ${f.fftOutput.replace("_", " ")}`;
    case "fftfilter": return `FFT ${f.fMode}`;
    case "imgfilter": return f.imgKind === "sobel" ? "Sobel" : f.imgKind;
    case "wavelet2d": return f.wtAction === "denoise" ? `wavelet denoise ${f.wtWavelet}` : `wavelet smooth ${f.wtWavelet}`;
  }
}
