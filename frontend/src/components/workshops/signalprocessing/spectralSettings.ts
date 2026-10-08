import {
  DEFAULT_SPECTRAL_RECIPE,
  type SpectralAnalysisRecipe,
  type SpectralFilterType,
  type SpectralOperation,
} from "../../../lib/spectralWorkbench";
import type { Dataset } from "../../../lib/types";

export interface SpectralUiSettings {
  outputType: "magnitude" | "psd" | "phase";
  sided: "one" | "two";
  window: SpectralAnalysisRecipe["window"];
  detrend: SpectralAnalysisRecipe["detrend"];
  welch: boolean;
  segmentLen: string;
  overlap: string;
  zeroPad: string;
  filterType: SpectralFilterType;
  cutoffLow: string;
  cutoffHigh: string;
  bandwidth: string;
  order: string;
  useRange: boolean;
  xMin: string;
  xMax: string;
  resample: boolean;
  correlationDemean: boolean;
}

export const DEFAULT_SPECTRAL_SETTINGS: SpectralUiSettings = {
  outputType: DEFAULT_SPECTRAL_RECIPE.outputType,
  sided: DEFAULT_SPECTRAL_RECIPE.sided,
  window: DEFAULT_SPECTRAL_RECIPE.window,
  detrend: DEFAULT_SPECTRAL_RECIPE.detrend,
  welch: false,
  segmentLen: "128",
  overlap: "0.5",
  zeroPad: "0",
  filterType: DEFAULT_SPECTRAL_RECIPE.filterType,
  cutoffLow: "1",
  cutoffHigh: "2",
  bandwidth: "0.1",
  order: String(DEFAULT_SPECTRAL_RECIPE.order),
  useRange: false,
  xMin: "",
  xMax: "",
  resample: false,
  correlationDemean: true,
};

/** Return the reciprocal unit shown for frequency-like spectral controls. */
export function frequencyUnitOf(unit: string): string {
  const clean = unit.trim();
  if (!clean) return "frequency units";
  if (clean.startsWith("1/")) return clean.slice(2);
  if (clean.endsWith("⁻¹")) return clean.slice(0, -2);
  if (clean.endsWith("^-1")) return clean.slice(0, -3);
  return `1/${clean}`;
}

const number = (value: string): number => Number(value.trim());

export function validateSpectralSettings(
  operation: SpectralOperation,
  settings: SpectralUiSettings,
  channels: number[],
): string {
  if (operation === "correlation" ? channels.length !== 2 : channels.length === 0) {
    return operation === "correlation"
      ? "Cross-correlation requires exactly two signal columns."
      : "Select at least one signal column.";
  }
  if (settings.useRange) {
    if (!Number.isFinite(number(settings.xMin)) || !Number.isFinite(number(settings.xMax))) {
      return "Enter finite X-range limits.";
    }
    if (number(settings.xMin) >= number(settings.xMax)) return "X minimum must be less than X maximum.";
  }
  if (operation === "fft") {
    if (!Number.isInteger(number(settings.zeroPad)) || number(settings.zeroPad) < 0) {
      return "Zero-padding length must be a non-negative integer.";
    }
    if (settings.welch) {
      if (settings.outputType !== "psd") return "Welch averaging requires PSD output.";
      if (!Number.isInteger(number(settings.segmentLen)) || number(settings.segmentLen) < 4) {
        return "Welch segment length must be an integer of at least 4.";
      }
      if (!Number.isFinite(number(settings.overlap)) || number(settings.overlap) < 0 || number(settings.overlap) >= 1) {
        return "Welch overlap must be at least 0 and less than 1.";
      }
    }
  }
  if (operation === "filter") {
    const low = number(settings.cutoffLow);
    const high = number(settings.cutoffHigh);
    if (!Number.isFinite(low) || low <= 0) return "Enter a positive cutoff frequency.";
    if (settings.filterType === "bandpass" && (!Number.isFinite(high) || high <= low)) {
      return "Band-pass upper cutoff must be greater than the lower cutoff.";
    }
    if (settings.filterType === "notch" && (!Number.isFinite(number(settings.bandwidth)) || number(settings.bandwidth) <= 0)) {
      return "Notch bandwidth must be positive.";
    }
    if (!Number.isInteger(number(settings.order)) || number(settings.order) < 1 || number(settings.order) > 20) {
      return "Filter order must be an integer from 1 to 20.";
    }
  }
  return "";
}

export function buildSpectralRecipe(
  operation: SpectralOperation,
  settings: SpectralUiSettings,
  channels: number[],
  dataset: Dataset,
): SpectralAnalysisRecipe {
  const recipe: SpectralAnalysisRecipe = {
    ...DEFAULT_SPECTRAL_RECIPE,
    operation,
    channels: channels.map((index) => ({
      index,
      label: dataset.data.labels[index],
      unit: dataset.data.units[index] ?? "",
    })),
    ...(settings.useRange ? { xMin: number(settings.xMin), xMax: number(settings.xMax) } : {}),
    resample: settings.resample,
  };
  if (operation === "fft") {
    return {
      ...recipe,
      outputType: settings.outputType,
      sided: settings.sided,
      window: settings.window,
      detrend: settings.detrend,
      zeroPad: number(settings.zeroPad),
      segmentLen: settings.welch ? number(settings.segmentLen) : 0,
      overlap: settings.welch ? number(settings.overlap) : DEFAULT_SPECTRAL_RECIPE.overlap,
    };
  }
  if (operation === "filter") {
    return {
      ...recipe,
      window: settings.window,
      detrend: settings.detrend,
      filterType: settings.filterType,
      cutoff: settings.filterType === "bandpass"
        ? [number(settings.cutoffLow), number(settings.cutoffHigh)]
        : [number(settings.cutoffLow)],
      ...(settings.filterType === "notch" ? { bandwidth: number(settings.bandwidth) } : {}),
      order: number(settings.order),
    };
  }
  return { ...recipe, correlationDemean: settings.correlationDemean };
}
