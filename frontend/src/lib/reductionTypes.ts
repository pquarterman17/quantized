// Wire shapes of POST /api/reductions/{williamson-hall,fft-thickness,
// reflectivity-fft} (routes/reductions.py -> calc.reductions*) PLUS
// POST /api/rsm/{analyze,strain} (routes/rsm.py -> calc.rsm) — the RSM trio
// (RsmPeak/RsmAnalysisResponse/RsmStrainResponse) joined this file 2026-08-19
// (J2/P1.6b), moved verbatim from lib/types.ts for the same reason the
// original reductions block moved: funding a new field under that file's
// pinned ceiling (architecture.test.ts's TS_MODULE_PINS) without raising it.
// Split out of lib/types.ts (LIBRARY_WORKBOOK_UX_PLAN PR A1, 2026-08-14) so a
// first-class `WorkbookNode`/`Dataset.workbookId` addition could land there
// without raising its pinned ceiling — this block was a self-contained,
// single-domain leaf (nothing else in types.ts references these
// interfaces), so it moved verbatim with no behavior change.
// NaN-typed fields (undefined grain size, no superlattice detected) serialize
// as null — the routes return `dict[str, Any]`, which FastAPI runs through
// pydantic's JSON-mode encoder, converting NaN to null (verified empirically;
// same convention as `RsmStrainResponse` below).

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

// RsmPeak/RsmAnalysisResponse/RsmStrainResponse moved here verbatim from
// lib/types.ts (J2/P1.6b Recode workshop, funding the new `ComputedColumn.
// recode` field without raising that file's TS_MODULE_PINS ceiling) — a
// self-contained RSM-analysis wire-response leaf, same class as the four
// reductions results above; re-exported from lib/types.ts so no import site
// changes (the `export type {...} from "./reductionTypes"` line there).

/** One peak from POST /api/rsm/analyze. Centres/FWHM are `[omega, 2theta]` in
 *  angle space and `[Qx, Qz]` in reciprocal space (null when no Q-space). */
export interface RsmPeak {
  rank: number;
  centre_angle: [number, number];
  centre_Q: [number | null, number | null];
  fwhm_angle: [number, number];
  fwhm_Q: [number | null, number | null];
  amplitude: number;
  background: number;
  classification: string; // "substrate" | "film" | "unknown"
}

/** Response of POST /api/rsm/analyze. */
export interface RsmAnalysisResponse {
  peaks: RsmPeak[];
  n_peaks_found: number;
  intensity_unit: string;
  used_q_space: boolean;
}

/** Response of POST /api/rsm/strain (NaN fields serialize as null).
 *  `warnings` explains a null `eps_parallel`: near-symmetric reflections
 *  (|Qx|/|Qz| below the degeneracy threshold — see calc/rsm.py) carry no
 *  in-plane information, so eps_parallel is refused rather than fabricated
 *  from noise. Empty when nothing was degenerate. */
export interface RsmStrainResponse {
  eps_parallel: number | null;
  eps_perp: number | null;
  a_sub_parallel: number;
  a_sub_perp: number;
  a_film_parallel: number;
  a_film_perp: number;
  relaxation: number | null;
  warnings: string[];
}
