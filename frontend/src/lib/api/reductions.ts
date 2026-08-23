// /api/reductions/* wrappers — split out of lib/api.ts (R8 bundle-diet
// pass, 2026-08-23; see api/reference.ts's header for why): every consumer
// is the lazy reductions workshop. NOT re-exported by lib/api.ts;
// useWilliamsonHall.ts / useFftThickness.ts / useReflectivityFft.ts import
// directly from this path.

import { postJSON } from "./http";
import type { FftThicknessResult, ReflectivityFftResult, WilliamsonHallResult } from "../reductionTypes";

/** Crystallite size + microstrain from XRD peak positions and widths. */
export function williamsonHall(body: {
  two_theta_deg: number[];
  fwhm_deg: number[];
  wavelength_a?: number;
  k_factor?: number;
  instrumental_broadening_deg?: number;
}): Promise<WilliamsonHallResult> {
  return postJSON("/api/reductions/williamson-hall", body);
}

/** Film thickness from Laue-fringe periodicity via FFT (XRD). */
export function fftThickness(body: {
  two_theta_deg: number[];
  intensity: number[];
  wavelength_a: number;
  two_theta_min?: number;
  two_theta_max?: number;
  window?: string;
  max_thickness_nm?: number;
}): Promise<FftThicknessResult> {
  return postJSON("/api/reductions/fft-thickness", body);
}

/** Kiessig-fringe FFT thickness(es) + superlattice analysis (XRR/NR). */
export function reflectivityFft(body: {
  x: number[];
  reflectivity: number[];
  is_neutron?: boolean;
  wavelength_a?: number | null;
  x_min?: number;
  x_max?: number;
  window?: string;
  preprocess?: string;
  max_thickness_nm?: number;
  peak_prominence_threshold?: number;
}): Promise<ReflectivityFftResult> {
  return postJSON("/api/reductions/reflectivity-fft", body);
}
