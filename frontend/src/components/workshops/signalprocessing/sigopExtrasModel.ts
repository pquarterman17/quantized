// Form state -> recordable args for the "signal extras" sigop methods (item 7
// of the Origin gap plan): phase unwrap, percentile and binomial smoothing,
// extrema envelope, coherence, anti-alias decimation and Zoom FFT. Split from
// sigopModel.ts, which dispatches here. Numeric fields are the strings the
// inputs hold. The maths is backend (calc/signal_extras.py).

import type { SigopArgs, SigopMethod } from "../../../lib/transformSigop";

export type SigopExtraMethod =
  | "unwrap" | "percentile" | "binomial" | "envelope-extrema" | "coherence" | "decimate-aa" | "zoom-fft";

export const SIGOP_EXTRA_OPTIONS: { value: SigopExtraMethod; label: string }[] = [
  { value: "percentile", label: "Smooth · percentile filter" },
  { value: "binomial", label: "Smooth · binomial" },
  { value: "envelope-extrema", label: "Envelope · local extrema" },
  { value: "unwrap", label: "Phase unwrap" },
  { value: "decimate-aa", label: "Decimate · anti-alias filter" },
  { value: "coherence", label: "Coherence · two signals (Welch)" },
  { value: "zoom-fft", label: "Spectrum · Zoom FFT (band)" },
];

/** Extras that keep the rows and so take the optional X range. */
export const EXTRA_FILTERS_WITH_RANGE: readonly SigopMethod[] = ["unwrap", "percentile", "binomial", "envelope-extrema"];
/** Extras whose output has its own axis (frequency, or a thinned X): no overlay on the source. */
export const EXTRA_NEW_AXIS: readonly SigopMethod[] = ["coherence", "zoom-fft"];

export interface SigopExtraForm {
  phaseUnit: "radians" | "degrees";
  percentile: string;
  envSide: "upper" | "lower" | "both";
  envInterpolation: "spline" | "linear";
  envMinDistance: string;
  /** Window function of coherence and Zoom FFT (the FFT workbench's names). */
  spectralWindow: "none" | "hanning" | "hamming" | "blackman" | "flattop";
  segmentLen: string;
  overlap: string;
  factor: string;
  aaFilter: "iir" | "fir";
  aaOrder: string;
  zeroPhase: boolean;
  fMin: string;
  fMax: string;
  nPoints: string;
}

export const DEFAULT_SIGOP_EXTRA_FORM: SigopExtraForm = {
  phaseUnit: "radians",
  percentile: "50",
  envSide: "both",
  envInterpolation: "spline",
  envMinDistance: "1",
  spectralWindow: "hanning",
  segmentLen: "256",
  overlap: "0.5",
  factor: "2",
  aaFilter: "iir",
  aaOrder: "",
  zeroPhase: true,
  fMin: "",
  fMax: "",
  nPoints: "512",
};

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));
const whole = (s: string, min: number): boolean => Number.isInteger(num(s)) && num(s) >= min;

export function isExtraMethod(method: string): method is SigopExtraMethod {
  return SIGOP_EXTRA_OPTIONS.some((o) => o.value === method);
}

/** `{args, channels}` for an extra method, or the sentence saying what to fix.
 *  `windowRows` is the shared odd row-window field of the smoothing filters. */
export function extraArgsFromForm(
  method: SigopExtraMethod,
  f: SigopExtraForm,
  windowRows: string,
  channels: number[],
): { args: SigopArgs; channels: number[] } | string {
  const args: SigopArgs = {};
  const oddWindow = whole(windowRows, 1) && num(windowRows) % 2 === 1;
  switch (method) {
    case "unwrap":
      args.unit = f.phaseUnit;
      break;
    case "percentile":
      if (!oddWindow) return "Window must be an odd whole number of rows.";
      if (!(num(f.percentile) >= 0 && num(f.percentile) <= 100)) return "Percentile must be between 0 and 100.";
      args.window = num(windowRows);
      args.percentile = num(f.percentile);
      break;
    case "binomial":
      if (!oddWindow) return "Window must be an odd whole number of rows.";
      args.window = num(windowRows);
      break;
    case "envelope-extrema":
      if (!whole(f.envMinDistance, 1)) return "Minimum distance must be a whole number of rows, 1 or more.";
      args.side = f.envSide;
      args.interpolation = f.envInterpolation;
      args.minDistance = num(f.envMinDistance);
      break;
    case "coherence":
      if (channels.length !== 2) return "Coherence needs exactly two signal columns.";
      if (!whole(f.segmentLen, 4)) return "Segment length must be a whole number of rows, 4 or more.";
      if (!(num(f.overlap) >= 0 && num(f.overlap) < 1)) return "Overlap must be at least 0 and less than 1.";
      args.window = f.spectralWindow;
      args.segmentLen = num(f.segmentLen);
      args.overlap = num(f.overlap);
      break;
    case "decimate-aa":
      if (!whole(f.factor, 2)) return "Decimation factor must be a whole number, 2 or more.";
      if (f.aaFilter === "iir" && num(f.factor) > 13) return "IIR decimation works up to a factor of 13; use FIR for more.";
      if (f.aaOrder.trim() !== "" && !whole(f.aaOrder, 1)) return "Filter order must be a whole number, 1 or more (or blank for the default).";
      args.factor = num(f.factor);
      args.filter = f.aaFilter;
      if (f.aaOrder.trim() !== "") args.order = num(f.aaOrder);
      args.zeroPhase = f.zeroPhase;
      break;
    case "zoom-fft":
      if (!Number.isFinite(num(f.fMin)) || !Number.isFinite(num(f.fMax)) || !(num(f.fMin) >= 0 && num(f.fMin) < num(f.fMax))) {
        return "Band must be finite, from 0 or more up to a higher frequency.";
      }
      if (!whole(f.nPoints, 2)) return "Number of points must be a whole number, 2 or more.";
      args.fMin = num(f.fMin);
      args.fMax = num(f.fMax);
      args.nPoints = num(f.nPoints);
      args.window = f.spectralWindow;
      break;
  }
  return { args, channels };
}
