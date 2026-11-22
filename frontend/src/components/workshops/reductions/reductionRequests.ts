// The request bodies of the FFT thickness and reflectivity FFT runs, built in
// one place for the single run (useFftThickness / useReflectivityFft) and the
// batch over worksheets (reductionBatch.ts), so the two cannot drift: a batch
// row for the active worksheet sends exactly what the panel's Compute sends.

import type { reflectivityFft, fftThickness } from "../../../lib/api/reductions";
import type { DataStruct } from "../../../lib/types";

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
const unitOf = (d: DataStruct | undefined): string => String(d?.metadata?.x_column_unit ?? "").toLowerCase();

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
