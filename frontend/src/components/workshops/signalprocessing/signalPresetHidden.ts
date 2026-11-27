// Which Signal Processing settings the chosen operation HIDES (the hidden-field
// rule of lib/presetHiddenFields.ts). The panel shows only the options of the
// operation picked: the smoothing method for Smooth, the polynomial order for
// Savitzky-Golay, the reference for Normalise to a reference, the spectral
// controls of FFT / Filter / Correlation, the IIR design for an IIR filter,
// the worksheet X range for the correction operations and the spectral one for
// the others. A preset neither validates nor stores what is hidden, so a
// refused value there never blocks Save. Pure: no React, no store.

import { isBandBand, usesAttenuation, usesRipple } from "./iirSettings";
import { DEFAULT_SPECTRAL_SETTINGS } from "./spectralSettings";

const SPECTRAL_OPERATIONS = ["fft", "filter", "correlation"];
const SIGNAL_KEYS = [
  "smoothMethod", "smoothWindow", "smoothPolyOrder", "referenceMode", "referenceValue", "referenceMin", "referenceMax", "detrendOrder", "useRange", "xMin", "xMax",
] as const;

const rec = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The keys of the `signal` object this operation does not show. `operation` and `useAllRows` are always shown. */
export function hiddenSignalKeys(signal: unknown): string[] {
  const s = rec(signal);
  const op = s["operation"];
  const shown = new Set<string>();
  if (op === "smooth") {
    shown.add("smoothMethod").add("smoothWindow");
    if (s["smoothMethod"] === "savitzky-golay") shown.add("smoothPolyOrder");
  }
  if (op === "detrend") shown.add("detrendOrder");
  if (op === "normalize-reference") {
    shown.add("referenceMode");
    if (s["referenceMode"] === "range") shown.add("referenceMin").add("referenceMax");
    else shown.add("referenceValue");
  }
  if (!SPECTRAL_OPERATIONS.includes(op as string)) {
    shown.add("useRange");
    if (s["useRange"] === true) shown.add("xMin").add("xMax");
  }
  return SIGNAL_KEYS.filter((k) => !shown.has(k));
}

/** The keys of the `spectral` object this operation (and its engine, output and band) does not show. */
export function hiddenSpectralKeys(operation: unknown, spectral: unknown): string[] {
  const s = rec(spectral);
  const shown = new Set<string>();
  if (SPECTRAL_OPERATIONS.includes(operation as string)) {
    shown.add("useRange").add("resample");
    if (s["useRange"] === true) shown.add("xMin").add("xMax");
    if (operation === "correlation") shown.add("correlationDemean");
    if (operation === "fft") {
      for (const k of ["outputType", "sided", "welch", "zeroPad", "window", "detrend"]) shown.add(k);
      if (s["outputType"] === "psd") shown.add("psdScaling");
      if (s["welch"] === true) shown.add("segmentLen").add("overlap");
    }
    if (operation === "filter") {
      shown.add("filterEngine").add("order");
      if (s["filterEngine"] === "iir") {
        shown.add("iirFamily").add("iirBand").add("cutoffLow").add("iirZeroPhase");
        const band = s["iirBand"] as Parameters<typeof isBandBand>[0];
        const family = s["iirFamily"] as Parameters<typeof usesRipple>[0];
        if (isBandBand(band)) shown.add("cutoffHigh");
        if (usesRipple(family)) shown.add("iirRp");
        if (usesAttenuation(family)) shown.add("iirRs");
        if (family === "bessel") shown.add("iirBesselNorm");
      } else {
        shown.add("filterType").add("cutoffLow").add("window").add("detrend");
        if (s["filterType"] === "bandpass") shown.add("cutoffHigh");
        if (s["filterType"] === "notch") shown.add("bandwidth");
      }
    }
  }
  return Object.keys(DEFAULT_SPECTRAL_SETTINGS).filter((k) => !shown.has(k));
}
