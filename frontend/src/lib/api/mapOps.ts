// `/api/map-ops/apply` (calc/map_ops, calc/map_arith): one call per map
// operation, result is a native-grid map DataStruct. Its only consumer is the
// lazy Map operations workshop; NOT re-exported by lib/api.ts.

import { postJSON } from "./http";
import type { DataStruct } from "../types";

export type MapOpName = "crop" | "flip" | "rotate" | "transpose" | "plane_level" | "arith" | "scalar" | "fft2d" | "fft_filter" | "image_filter" | "wavelet2d";

export interface MapOpRequest {
  dataset: DataStruct;
  op: MapOpName;
  x_col?: number;
  y_col?: number;
  z_col?: number;
  xmin?: number | null;
  xmax?: number | null;
  ymin?: number | null;
  ymax?: number | null;
  axis?: "h" | "v";
  degrees?: number;
  order?: number;
  restore_mean?: boolean;
  other?: DataStruct;
  arith?: "add" | "sub" | "mul" | "div";
  interpolate?: boolean;
  allow_mismatch?: boolean;
  value?: number;
  reverse?: boolean;
  fft_output?: "magnitude" | "log_magnitude" | "power" | "phase";
  window?: "none" | "hann" | "tukey";
  remove_mean?: boolean;
  filter_mode?: "lowpass" | "highpass" | "bandpass" | "bandstop";
  cutoff_low?: number | null;
  cutoff_high?: number | null;
  edge_sigma?: number;
  filter_kind?: "gaussian" | "median" | "uniform" | "sobel" | "laplacian";
  sigma?: number;
  size?: number;
  edge_mode?: "reflect" | "nearest" | "mirror" | "wrap" | "constant";
  cval?: number;
  gradient?: "magnitude" | "x" | "y";
  wt_action?: "denoise" | "smooth";
  wt_wavelet?: string;
  wt_level?: number | null;
  wt_mode?: string;
  wt_threshold?: "soft" | "hard";
  wt_value?: number | null;
  wt_zero?: string;
}

export const mapOpApply = (body: MapOpRequest, signal?: AbortSignal): Promise<DataStruct> =>
  postJSON("/api/map-ops/apply", body, signal);
