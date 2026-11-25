import { iirSpecProblem, type BesselNorm, type IirBand, type IirFamily, type IirSpec } from "../../../lib/spectralIir";

/** UI state for the IIR engine of the Frequency filter operation. The cutoff
 *  and order fields are shared with the FFT-domain filter. */
export interface IirUiSettings {
  filterEngine: "fft" | "iir";
  iirFamily: IirFamily;
  iirBand: IirBand;
  iirRp: string;
  iirRs: string;
  iirBesselNorm: BesselNorm;
  iirZeroPhase: boolean;
}

export const DEFAULT_IIR_SETTINGS: IirUiSettings = {
  filterEngine: "fft",
  iirFamily: "butter",
  iirBand: "lowpass",
  iirRp: "1",
  iirRs: "40",
  iirBesselNorm: "phase",
  iirZeroPhase: false,
};

/** The data's Nyquist frequency, 0.5 / median(|dx|): the same spacing rule as the backend's sampling-rate
 *  inference (calc/spectral.py `_infer_sampling_rate`). Null when the X spacing is not usable. */
export function nyquistOf(x: readonly number[]): number | null {
  const dx: number[] = [];
  for (let i = 1; i < x.length; i++) dx.push(Math.abs(x[i]! - x[i - 1]!));
  if (dx.length === 0 || dx.some((v) => !Number.isFinite(v))) return null;
  dx.sort((a, b) => a - b);
  const mid = dx.length >> 1;
  const median = dx.length % 2 ? dx[mid]! : (dx[mid - 1]! + dx[mid]!) / 2;
  return median > 0 ? 0.5 / median : null;
}

/** The shipped cutoff defaults (the FFT-domain filter's), and what the IIR engine starts from instead: fractions
 *  of Nyquist, so the first design is never refused (0.2 and 0.6 are provisional, owner to confirm). */
export const SHIPPED_CUTOFFS = { low: "1", high: "2" } as const;
export function iirDefaultCutoffs(nyquist: number): { low: string; high: string } {
  return { low: String(Number((0.2 * nyquist).toPrecision(3))), high: String(Number((0.6 * nyquist).toPrecision(3))) };
}

export const usesRipple = (family: IirFamily): boolean => family === "cheby1" || family === "ellip";
export const usesAttenuation = (family: IirFamily): boolean => family === "cheby2" || family === "ellip";
export const isBandBand = (band: IirBand): boolean => band === "bandpass" || band === "bandstop";

interface CutoffFields {
  cutoffLow: string;
  cutoffHigh: string;
  order: string;
}

export function iirSpecFrom(settings: IirUiSettings & CutoffFields): IirSpec {
  const family = settings.iirFamily;
  return {
    family,
    btype: settings.iirBand,
    order: Number(settings.order),
    cutoff: isBandBand(settings.iirBand)
      ? [Number(settings.cutoffLow), Number(settings.cutoffHigh)]
      : [Number(settings.cutoffLow)],
    ...(usesRipple(family) ? { rp: Number(settings.iirRp) } : {}),
    ...(usesAttenuation(family) ? { rs: Number(settings.iirRs) } : {}),
    ...(family === "bessel" ? { besselNorm: settings.iirBesselNorm } : {}),
    zeroPhase: settings.iirZeroPhase,
  };
}

/** "" when the entered IIR design is valid. With the data's Nyquist known, a cutoff at or above it is refused
 *  here (with the limit), so no request is sent only to log a 422. */
export function validateIirSettings(settings: IirUiSettings & CutoffFields, nyquist: number | null = null): string {
  const problem = iirSpecProblem(iirSpecFrom(settings));
  if (problem || nyquist === null) return problem;
  const cuts = iirSpecFrom(settings).cutoff;
  return cuts.some((c) => c >= nyquist)
    ? `IIR cutoffs must be below Nyquist (${Number(nyquist.toPrecision(4))} for this X spacing). Lower the cutoff.`
    : "";
}
