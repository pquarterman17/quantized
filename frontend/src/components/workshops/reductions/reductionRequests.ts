// The request bodies of the FFT thickness and reflectivity FFT runs, built in
// one place for the single run (useFftThickness / useReflectivityFft) and the
// batch over worksheets (reductionBatchItems.ts), so the two cannot drift: a batch
// row for the active worksheet sends exactly what the panel's Compute sends.

import type { reflectivityFft, fftThickness } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";

/** Why this scan cannot be sent as it is, or null. A blank / NaN cell reaches the
 *  backend as JSON null (a bare 422 naming array positions), and dropping the
 *  row would change the sampling the FFT assumes, so the run is refused with the
 *  count instead. Provisional, owner to confirm: refuse rather than drop. */
export function gapProblem(d: DataStruct, col: number): string | null {
  let bad = 0;
  d.time.forEach((x, i) => {
    if (!Number.isFinite(x) || !Number.isFinite(d.values[i]?.[col])) bad += 1;
  });
  if (d.values.length > 0 && col >= (d.values[0]?.length ?? 0)) return "The selected intensity column no longer exists.";
  return bad === 0 ? null
    : `${bad} of ${d.time.length} rows have a blank or non-finite X or intensity value. Exclude those rows (or filter them out) and run again; nothing was computed.`;
}

export type FftThicknessBody = Parameters<typeof fftThickness>[0];
export type ReflectivityFftBody = Parameters<typeof reflectivityFft>[0];

export interface FftThicknessSettings {
  wavelength: number;
  twoThetaMin: number | null;
  twoThetaMax: number | null;
  windowFn: string;
  maxThicknessNm: number;
}

/** 2θ (the worksheet's X) against the intensity in column `col`; the backend
 *  does the 2θ-range subsetting. */
export function fftThicknessBody(d: DataStruct, col: number, s: FftThicknessSettings): FftThicknessBody {
  return {
    two_theta_deg: d.time,
    intensity: d.values.map((row) => row[col]),
    wavelength_a: s.wavelength,
    two_theta_min: s.twoThetaMin ?? undefined,
    two_theta_max: s.twoThetaMax ?? undefined,
    window: s.windowFn,
    max_thickness_nm: s.maxThicknessNm,
  };
}

export type ReflFftPreprocess = "logR" | "logRQ4" | "R" | "RQ4";

export interface ReflectivityFftSettings {
  isNeutron: boolean;
  wavelength: number;
  xMin: number | null;
  xMax: number | null;
  windowFn: string;
  preprocess: ReflFftPreprocess;
  maxThicknessNm: number;
  peakProminence: number;
}

// The file's own say on its x axis. `is_neutron` means "x is Q in Å⁻¹" to the
// backend, so a neutron probe (ORSO/NCNR metadata) or a reciprocal-length x
// unit opens checked. Restated from reflectivity/reflFitData rather than
// imported: sharing that module across two lazy chunks splits it into a third
// and grows the eager preload map.
const NM = /nm(⁻¹|\^?-1)|1\/nm/;
export const unitOf = (d: DataStruct | undefined): string => String(d?.metadata?.x_column_unit ?? "").toLowerCase();

export function xIsQ(d: DataStruct | undefined): boolean {
  const unit = unitOf(d);
  return /neutron/i.test(String(d?.metadata?.probe ?? "")) || NM.test(unit) || /ang|å|a-1|1\/a/.test(unit);
}

/** x against the reflectivity in column `col`; a Q axis recorded in nm⁻¹ is
 *  converted to Å⁻¹ (the range bounds, typed in the file's unit, with it). */
export function reflectivityFftBody(d: DataStruct, col: number, s: ReflectivityFftSettings): ReflectivityFftBody {
  const k = s.isNeutron && NM.test(unitOf(d)) ? 0.1 : 1;
  return {
    x: k === 1 ? d.time : d.time.map((q) => q * k),
    reflectivity: d.values.map((row) => row[col]),
    is_neutron: s.isNeutron,
    wavelength_a: s.isNeutron ? undefined : s.wavelength,
    x_min: s.xMin == null ? undefined : s.xMin * k,
    x_max: s.xMax == null ? undefined : s.xMax * k,
    window: s.windowFn,
    preprocess: s.preprocess,
    max_thickness_nm: s.maxThicknessNm,
    peak_prominence_threshold: s.peakProminence,
  };
}
