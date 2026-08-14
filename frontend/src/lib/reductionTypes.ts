// Wire shapes of POST /api/reductions/{williamson-hall,fft-thickness,
// reflectivity-fft} (routes/reductions.py -> calc.reductions*). Split out of
// lib/types.ts (LIBRARY_WORKBOOK_UX_PLAN PR A1, 2026-08-14) so a first-class
// `WorkbookNode`/`Dataset.workbookId` addition could land there without
// raising its pinned ceiling (architecture.test.ts's TS_MODULE_PINS) — this
// block was a self-contained, single-domain leaf (nothing else in types.ts
// references these interfaces), so it moved verbatim with no behavior change.
// NaN-typed fields (undefined grain size, no superlattice detected) serialize
// as null — the routes return `dict[str, Any]`, which FastAPI runs through
// pydantic's JSON-mode encoder, converting NaN to null (verified empirically;
// same convention as RsmStrainResponse in lib/types.ts).

/** Response of POST /api/reductions/williamson-hall. */
export interface WilliamsonHallResult {
  grain_size_nm: number | null; // null when the fit intercept <= 0 (undefined)
  microstrain: number;
  r2: number;
  plot_x: number[];
  plot_y: number[];
  fit_line: [number, number];
}

/** Response of POST /api/reductions/fft-thickness. */
export interface FftThicknessResult {
  thickness_nm: number;
  uncertainty_nm: number | null; // null when the FFT peak's FWHM can't be bracketed
  wavelength_a: number;
  two_theta_range: [number, number];
  fft_magnitude: number[];
  thickness_axis: number[];
  n_points: number;
}

/** The `superlattice` block of a reflectivity-FFT response — null fields when
 *  no bilayer periodicity was detected (`detected: false`, the common case). */
export interface SuperlatticeResult {
  detected: boolean;
  bilayer_period_nm: number | null;
  total_thickness_nm: number | null;
  n_repeats: number | null;
  sublayer_a_nm: number | null;
  sublayer_b_nm: number | null;
  suppressed_orders: number[];
}

/** Response of POST /api/reductions/reflectivity-fft. */
export interface ReflectivityFftResult {
  thicknesses_nm: number[];
  amplitudes: number[];
  harmonic_labels: string[];
  q_range: [number, number];
  preprocess: string;
  fft_magnitude: number[];
  thickness_axis: number[];
  is_neutron: boolean;
  wavelength_a?: number;
  superlattice: SuperlatticeResult;
}
