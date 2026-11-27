// The option lists of the Signal Processing workbench, in ONE place: the
// operation picker, the smoothing and spectral controls render their selects
// from these, and the preset adapter validates against the same lists
// (plans/PRESET_BAR_CONTRACT.md: no second copy of an option list).

import type { BesselNorm, IirBand, IirFamily } from "../../../lib/spectralIir";
import type { SignalOperation, SignalSettings } from "./signalProcessingModel";
import { SIGOP_FILTER_OPTIONS, type SigopFilterMethod } from "./sigopModel";
import type { SpectralUiSettings } from "./spectralSettings";

export type PickerOperation = SignalOperation | SigopFilterMethod | "spectrogram";

/** Everything the Operation select offers. */
export const OPERATION_OPTIONS: { value: PickerOperation; label: string }[] = [
  { value: "smooth", label: "Smooth" },
  { value: "normalize-range", label: "Normalize · 0–1" },
  { value: "normalize-peak", label: "Normalize · peak = 1" },
  { value: "normalize-zscore", label: "Normalize · Z-score" },
  { value: "normalize-area", label: "Normalize · area = 1" },
  { value: "normalize-reference", label: "Normalize · reference" },
  { value: "detrend", label: "Detrend" },
  { value: "derivative-first", label: "Derivative · dY/dX" },
  { value: "derivative-second", label: "Derivative · d²Y/dX²" },
  { value: "integral", label: "Integral · cumulative ∫Y dx" },
  { value: "log-derivative", label: "Derivative · dlog(Y)/dlog(X)" },
  { value: "fft", label: "Spectrum · FFT / PSD / phase" },
  { value: "filter", label: "Filter · frequency domain" },
  { value: "correlation", label: "Cross-correlation" },
  { value: "spectrogram", label: "Spectrogram · short-time FFT" },
  ...SIGOP_FILTER_OPTIONS,
];

/** The operations of the main workbench (the median / despike / wavelet filters and the Spectrogram have their own bodies). */
export const SETTINGS_OPERATIONS: readonly SignalOperation[] = OPERATION_OPTIONS
  .map((o) => o.value)
  .filter((v): v is SignalOperation => v !== "spectrogram" && !SIGOP_FILTER_OPTIONS.some((o) => o.value === v));

export const SMOOTH_METHOD_OPTIONS: { value: SignalSettings["smoothMethod"]; label: string }[] = [
  { value: "moving", label: "Moving average" },
  { value: "gaussian", label: "Gaussian" },
  { value: "savitzky-golay", label: "Savitzky–Golay" },
];

export const REFERENCE_MODE_OPTIONS: { value: SignalSettings["referenceMode"]; label: string }[] = [
  { value: "value", label: "Divide by value" },
  { value: "range", label: "Divide by mean in X range" },
];

export const SPECTRAL_OUTPUT_OPTIONS: { value: SpectralUiSettings["outputType"]; label: string }[] = [
  { value: "magnitude", label: "Magnitude" },
  { value: "psd", label: "Power spectral density" },
  { value: "phase", label: "Phase" },
  { value: "magnitude+phase", label: "Magnitude + phase (for Inverse FFT)" },
];

/** The PSD scaling select (its first label names the frequency unit). */
export const psdScalingOptions = (frequencyUnit: string): { value: SpectralUiSettings["psdScaling"]; label: string }[] => [
  { value: "density", label: `Density (power per ${frequencyUnit})` },
  { value: "spectrum", label: "Power (per bin)" },
];

export const SPECTRAL_SIDED_OPTIONS: { value: SpectralUiSettings["sided"]; label: string }[] = [
  { value: "one", label: "One-sided" },
  { value: "two", label: "Two-sided" },
];

export const FILTER_ENGINE_OPTIONS: { value: SpectralUiSettings["filterEngine"]; label: string }[] = [
  { value: "fft", label: "FFT-domain (Butterworth-shaped)" },
  { value: "iir", label: "IIR design (Butterworth, Chebyshev, elliptic, Bessel)" },
];

export const SPECTRAL_FILTER_TYPE_OPTIONS: { value: SpectralUiSettings["filterType"]; label: string }[] = [
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "bandpass", label: "Band-pass" },
  { value: "notch", label: "Notch" },
];

export const SPECTRAL_WINDOW_OPTIONS: { value: SpectralUiSettings["window"]; label: string }[] = [
  { value: "none", label: "None" },
  { value: "hanning", label: "Hann" },
  { value: "hamming", label: "Hamming" },
  { value: "blackman", label: "Blackman" },
  { value: "flattop", label: "Flat top" },
];

export const SPECTRAL_DETREND_OPTIONS: { value: SpectralUiSettings["detrend"]; label: string }[] = [
  { value: "mean", label: "Remove mean" },
  { value: "linear", label: "Remove linear trend" },
  { value: "none", label: "None" },
];

export const IIR_FAMILY_OPTIONS: { value: IirFamily; label: string }[] = [
  { value: "butter", label: "Butterworth" },
  { value: "cheby1", label: "Chebyshev I" },
  { value: "cheby2", label: "Chebyshev II" },
  { value: "ellip", label: "Elliptic" },
  { value: "bessel", label: "Bessel" },
];

export const IIR_BAND_OPTIONS: { value: IirBand; label: string }[] = [
  { value: "lowpass", label: "Low-pass" },
  { value: "highpass", label: "High-pass" },
  { value: "bandpass", label: "Band-pass" },
  { value: "bandstop", label: "Band-stop" },
];

export const BESSEL_NORM_OPTIONS: { value: BesselNorm; label: string }[] = [
  { value: "phase", label: "Phase (-3 dB point moves)" },
  { value: "delay", label: "Delay (unit group delay)" },
  { value: "mag", label: "Magnitude (-3 dB at cutoff)" },
];

