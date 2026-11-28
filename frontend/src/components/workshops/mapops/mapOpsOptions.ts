// Map operations: every option list the form offers, in one place, so the UI
// that renders them and the preset adapter that accepts them cannot drift.

import type { MapOpsForm } from "./mapOpsForm";

type Options<V extends string> = readonly { value: V; label: string }[];

export const FLIP_OPTIONS: Options<MapOpsForm["flipAxis"]> = [
  { value: "h", label: "Horizontal (left ↔ right)" },
  { value: "v", label: "Vertical (top ↔ bottom)" },
];

export const ROTATE_OPTIONS: Options<MapOpsForm["degrees"]> = (["90", "180", "270"] as const).map((v) => ({ value: v, label: `${v}° counter-clockwise` }));

export const LEVEL_ORDER_OPTIONS: Options<MapOpsForm["order"]> = [
  { value: "1", label: "Plane (order 1)" },
  { value: "2", label: "Quadric surface (order 2)" },
];

export const FFT_OUTPUT_OPTIONS: Options<MapOpsForm["fftOutput"]> = [
  { value: "magnitude", label: "Magnitude (amplitude)" },
  { value: "log_magnitude", label: "log10 magnitude" },
  { value: "power", label: "Power" },
  { value: "phase", label: "Phase (rad)" },
];

export const FFT_WINDOW_OPTIONS: Options<MapOpsForm["fftWindow"]> = [
  { value: "none", label: "None" },
  { value: "hann", label: "Hann" },
  { value: "tukey", label: "Tukey (α 0.5)" },
];

export const FILTER_MODE_OPTIONS: Options<MapOpsForm["fMode"]> = [
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "bandpass", label: "Band-pass" },
  { value: "bandstop", label: "Band-stop" },
];

export const IMAGE_FILTER_OPTIONS: Options<MapOpsForm["imgKind"]> = [
  { value: "gaussian", label: "Gaussian" },
  { value: "median", label: "Median" },
  { value: "uniform", label: "Uniform (mean)" },
  { value: "sobel", label: "Sobel edges" },
  { value: "laplacian", label: "Laplacian" },
];

export const SOBEL_OPTIONS: Options<MapOpsForm["gradient"]> = [
  { value: "magnitude", label: "Gradient magnitude" },
  { value: "x", label: "Gradient along X" },
  { value: "y", label: "Gradient along Y" },
];

export const EDGE_MODE_OPTIONS: Options<MapOpsForm["edgeMode"]> = [
  { value: "reflect", label: "Reflect" },
  { value: "nearest", label: "Nearest" },
  { value: "mirror", label: "Mirror" },
  { value: "wrap", label: "Wrap (periodic)" },
  { value: "constant", label: "Constant value" },
];

export const WAVELET_OPTIONS = ["haar", "db2", "db4", "db8", "sym4", "sym8", "coif2", "bior2.2", "bior4.4"].map((v) => ({ value: v, label: v }));

/** Edge extensions of the 2-D transform (the 1-D `origin-periodic` convention does not apply). */
export const WAVELET_MODE_OPTIONS = ["symmetric", "periodization", "zero", "constant", "smooth", "reflect", "antisymmetric", "antireflect", "periodic"].map((v) => ({ value: v, label: v }));

export const WAVELET_ACTION_OPTIONS: Options<MapOpsForm["wtAction"]> = [
  { value: "denoise", label: "Denoise (threshold detail)" },
  { value: "smooth", label: "Smooth (zero detail levels)" },
];

export const WAVELET_THRESHOLD_OPTIONS: Options<MapOpsForm["wtThreshold"]> = [
  { value: "soft", label: "Soft" },
  { value: "hard", label: "Hard" },
];
