import type { CorrectionParams, Dataset } from "../../../lib/types";
import type { SignalCorrectionRecipe } from "../../../lib/signalTransform";
import { dataXUnit } from "../../../lib/signalRecipe";
import type { SpectralOperation } from "../../../lib/spectralWorkbench";

export type CorrectionOperation =
  | "smooth"
  | "normalize-range"
  | "normalize-peak"
  | "normalize-zscore"
  | "normalize-area"
  | "normalize-reference"
  | "detrend"
  | "derivative-first"
  | "derivative-second"
  | "integral"
  | "log-derivative";
export type SignalOperation = CorrectionOperation | SpectralOperation;

export interface SignalSettings {
  operation: SignalOperation;
  smoothMethod: "moving" | "gaussian" | "savitzky-golay";
  smoothWindow: number;
  smoothPolyOrder: number;
  referenceMode: "value" | "range";
  referenceValue: string;
  referenceMin: string;
  referenceMax: string;
  detrendOrder: number;
  useRange: boolean;
  xMin: string;
  xMax: string;
}

export const DEFAULT_SIGNAL_SETTINGS: SignalSettings = {
  operation: "smooth",
  smoothMethod: "savitzky-golay",
  smoothWindow: 5,
  smoothPolyOrder: 2,
  referenceMode: "value",
  referenceValue: "1",
  referenceMin: "",
  referenceMax: "",
  detrendOrder: 1,
  useRange: false,
  xMin: "",
  xMax: "",
};

export function measuredChannels(dataset: Dataset): number[] {
  const categorical = new Set(Object.keys(dataset.data.cat_levels ?? {}).map(Number));
  const errors = new Set((dataset.errorRoles ?? []).map((binding) => binding.channel));
  return dataset.data.labels
    .map((_, index) => index)
    .filter((index) => !categorical.has(index) && !errors.has(index));
}

export function settingsToParams(
  settings: SignalSettings,
  channels: number[],
): CorrectionParams {
  const params: CorrectionParams = {
    signalChannels: channels,
    ...(settings.useRange ? { xTrimMin: Number(settings.xMin), xTrimMax: Number(settings.xMax) } : {}),
  };
  switch (settings.operation) {
    case "smooth":
      return {
        ...params,
        smoothEnabled: true,
        smoothMethod: settings.smoothMethod,
        smoothWindow: settings.smoothWindow,
        smoothPolyOrder: settings.smoothPolyOrder,
      };
    case "normalize-range":
      return { ...params, normMethod: "Range [0,1]" };
    case "normalize-peak":
      return { ...params, normMethod: "Peak (max=1)" };
    case "normalize-zscore":
      return { ...params, normMethod: "Z-score" };
    case "normalize-area":
      return { ...params, normMethod: "Area (integral=1)" };
    case "normalize-reference":
      return {
        ...params,
        normMethod: "Reference",
        ...(settings.referenceMode === "value"
          ? { normReferenceValue: Number(settings.referenceValue) }
          : {
              normReferenceMin: Number(settings.referenceMin),
              normReferenceMax: Number(settings.referenceMax),
            }),
      };
    case "detrend":
      return { ...params, detrendOrder: settings.detrendOrder };
    case "derivative-first":
      return { ...params, derivativeMode: "dY/dX" };
    case "derivative-second":
      return { ...params, derivativeMode: "d²Y/dX²" };
    case "integral":
      return { ...params, derivativeMode: "∫Y dx" };
    case "log-derivative":
      return { ...params, derivativeMode: "dlog/dlog" };
    case "fft":
    case "filter":
    case "correlation":
      throw new Error("spectral operations use a spectral recipe");
  }
}

export function buildCorrectionRecipe(
  settings: SignalSettings,
  channels: number[],
  dataset: Dataset,
): SignalCorrectionRecipe {
  if (isSpectralOperation(settings.operation)) {
    throw new Error("spectral operations use a spectral recipe");
  }
  return {
    kind: "signal-correction",
    version: 1,
    operation: operationLabel(settings.operation),
    xUnit: dataXUnit(dataset.data),
    channels: channels.map((index) => ({
      index,
      label: dataset.data.labels[index],
      unit: dataset.data.units[index] ?? "",
    })),
    params: settingsToParams(settings, channels),
  };
}

export function isSpectralOperation(operation: SignalOperation): operation is SpectralOperation {
  return operation === "fft" || operation === "filter" || operation === "correlation";
}

export function operationLabel(operation: SignalOperation): string {
  return {
    smooth: "Smooth",
    "normalize-range": "Normalize to 0–1",
    "normalize-peak": "Normalize peak to 1",
    "normalize-zscore": "Z-score",
    "normalize-area": "Normalize area to 1",
    "normalize-reference": "Normalize to reference",
    detrend: "Detrend",
    "derivative-first": "First derivative",
    "derivative-second": "Second derivative",
    integral: "Cumulative integral",
    "log-derivative": "Logarithmic derivative",
    fft: "Frequency spectrum",
    filter: "Frequency filter",
    correlation: "Cross-correlation",
  }[operation];
}

export function selectedBoundErrorTargets(dataset: Dataset, channels: number[]): number[] {
  const chosen = new Set(channels);
  return [...new Set(
    (dataset.errorRoles ?? [])
      .filter((binding) => binding.axis === "y" && chosen.has(binding.target))
      .map((binding) => binding.target),
  )];
}

export function channelsWithoutFiniteValues(dataset: Dataset["data"], channels: number[]): number[] {
  return channels.filter((channel) => !dataset.values.some((row) => Number.isFinite(row[channel])));
}
