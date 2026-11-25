// /api/spectro/* wrappers (GAP_AUDIT_9 G21): Fourier self-deconvolution, 2-D
// correlation and peak onset. NOT re-exported by lib/api.ts: the only consumer
// is the lazy Spectroscopy extras workshop (keeps the eager bundle unchanged).

import type { DataStruct } from "../types";
import { postJSON } from "./http";

export type Apodization = "triangular" | "bessel";

export interface FsdInfo {
  apodization: Apodization; hwhm: number; k: number; cutoff: number; k_max: number;
  fwhm_in: number; fwhm_out: number; noise_gain: number;
}
export interface FsdResult { y: (number | null)[]; info: FsdInfo }

export interface Corr2dResult {
  synchronous: DataStruct;
  asynchronous: DataStruct;
  info: { spectra: number; points: number; perturbation?: number[]; reference: number[]; x: number[] };
}

export interface OnsetResult {
  side: "left" | "right";
  x: number[];
  baseline_line: number[];
  tangent_line: number[];
  baseline: { slope: number; intercept: number; lo: number; hi: number };
  top: { x: number; y: number; height: number };
  tangent: { x_onset: number; y_onset: number; slope: number; x_steepest: number; y_steepest: number };
  threshold: { x_onset: number; y_onset: number; fraction: number; level: number };
}

export const spectroFsd = (body: { x: number[]; y: number[]; hwhm: number; k: number; apodization: Apodization }): Promise<FsdResult> =>
  postJSON("/api/spectro/fsd", body);

export const spectroCorr2d = (body: {
  x: number[]; spectra: number[][]; perturbation?: number[]; x_label?: string; x_unit?: string; x_min?: number; x_max?: number;
}): Promise<Corr2dResult> => postJSON("/api/spectro/corr2d", body);

export const spectroOnset = (body: {
  x: number[]; y: number[]; side?: "left" | "right"; x_min?: number; x_max?: number;
  baseline_min?: number; baseline_max?: number; fraction?: number; smooth?: number;
}): Promise<OnsetResult> => postJSON("/api/spectro/onset", body);
