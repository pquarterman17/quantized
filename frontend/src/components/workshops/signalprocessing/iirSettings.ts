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

/** "" when the entered IIR design is valid (the Nyquist limit is checked against the data by the backend). */
export function validateIirSettings(settings: IirUiSettings & CutoffFields): string {
  return iirSpecProblem(iirSpecFrom(settings));
}
