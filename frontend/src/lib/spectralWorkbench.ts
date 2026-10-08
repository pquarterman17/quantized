import type { DataStruct } from "./types";

export type SpectralOperation = "fft" | "filter" | "correlation";
export type SpectralFilterType = "lowpass" | "highpass" | "bandpass" | "notch";

export interface SpectralChannelRef {
  index: number;
  label: string;
  /** Unit at recipe creation. Optional for pre-0.31 saved worksheets. */
  unit?: string;
}

/** Versioned, JSON-safe recipe stored on a linked spectral worksheet. */
export interface SpectralAnalysisRecipe {
  kind: "spectral";
  version: 1;
  operation: SpectralOperation;
  channels: SpectralChannelRef[];
  xMin?: number;
  xMax?: number;
  resample: boolean;
  outputType: "magnitude" | "psd" | "phase";
  sided: "one" | "two";
  window: "none" | "hanning" | "hamming" | "blackman" | "flattop";
  detrend: "mean" | "linear" | "none";
  zeroPad: number;
  segmentLen: number;
  overlap: number;
  filterType: SpectralFilterType;
  cutoff: number[];
  bandwidth?: number;
  order: number;
  correlationDemean: boolean;
}

export const DEFAULT_SPECTRAL_RECIPE: Omit<SpectralAnalysisRecipe, "channels"> = {
  kind: "spectral",
  version: 1,
  operation: "fft",
  resample: false,
  outputType: "magnitude",
  sided: "one",
  window: "none",
  detrend: "mean",
  zeroPad: 0,
  segmentLen: 0,
  overlap: 0.5,
  filterType: "lowpass",
  cutoff: [1],
  order: 4,
  correlationDemean: true,
};

export function spectralRequest(
  dataset: DataStruct,
  recipe: SpectralAnalysisRecipe,
  includeDiagnostics = false,
) {
  return {
    dataset,
    operation: recipe.operation,
    channels: recipe.channels.map((channel) => channel.index),
    x_min: recipe.xMin,
    x_max: recipe.xMax,
    resample: recipe.resample,
    output_type: recipe.outputType,
    sided: recipe.sided,
    window: recipe.window,
    detrend: recipe.detrend,
    zero_pad: recipe.zeroPad,
    segment_len: recipe.segmentLen,
    overlap: recipe.overlap,
    filter_type: recipe.filterType,
    cutoff: recipe.cutoff,
    bandwidth: recipe.bandwidth,
    order: recipe.order,
    correlation_demean: recipe.correlationDemean,
    include_diagnostics: includeDiagnostics,
  };
}

/** Rebind by stable label after a source schema change; ambiguity fails closed. */
export function rebindSpectralRecipe(
  recipe: SpectralAnalysisRecipe,
  labels: string[],
  units: string[] = [],
): SpectralAnalysisRecipe {
  const channels = recipe.channels.map((channel) => {
    const matches = labels.flatMap((label, index) => label === channel.label ? [index] : []);
    if (matches.length !== 1) throw new Error(`signal column "${channel.label}" changed or is ambiguous`);
    const index = matches[0];
    const actualUnit = (units[index] ?? "").trim();
    const expectedUnit = channel.unit?.trim();
    if (expectedUnit && actualUnit && expectedUnit !== actualUnit) {
      throw new Error(`signal column "${channel.label}" changed units from ${expectedUnit} to ${actualUnit}`);
    }
    if (index === channel.index) return channel;
    return { ...channel, index };
  });
  return channels.every((channel, index) => channel === recipe.channels[index])
    ? recipe
    : { ...recipe, channels };
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Defensive .dwk decoder: malformed or future recipes degrade to absent. */
export function sanitizeSpectralRecipe(value: unknown): SpectralAnalysisRecipe | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (r.kind !== "spectral" || r.version !== 1) return undefined;
  const choices: Record<string, readonly string[]> = {
    operation: ["fft", "filter", "correlation"],
    outputType: ["magnitude", "psd", "phase"],
    sided: ["one", "two"],
    window: ["none", "hanning", "hamming", "blackman", "flattop"],
    detrend: ["mean", "linear", "none"],
    filterType: ["lowpass", "highpass", "bandpass", "notch"],
  };
  if (Object.entries(choices).some(([key, allowed]) => !allowed.includes(String(r[key])))) return undefined;
  if (!Array.isArray(r.channels) || !r.channels.length) return undefined;
  const channels = r.channels.flatMap((entry): SpectralChannelRef[] => {
    if (!entry || typeof entry !== "object") return [];
    const c = entry as Record<string, unknown>;
    return Number.isInteger(c.index) && Number(c.index) >= 0 && typeof c.label === "string"
      ? [{
          index: Number(c.index),
          label: c.label,
          ...(typeof c.unit === "string" ? { unit: c.unit } : {}),
        }]
      : [];
  });
  if (channels.length !== r.channels.length) return undefined;
  if (new Set(channels.map((channel) => channel.index)).size !== channels.length) return undefined;
  if (r.operation === "correlation" ? channels.length !== 2 : channels.length < 1) return undefined;
  if (!Array.isArray(r.cutoff) || !r.cutoff.every((value) => finite(value) && value > 0)) return undefined;
  if ((r.filterType === "bandpass" ? 2 : 1) !== r.cutoff.length) return undefined;
  if (![r.zeroPad, r.segmentLen, r.order].every(Number.isInteger)) return undefined;
  if (Number(r.zeroPad) < 0 || Number(r.segmentLen) < 0 || Number(r.order) < 1 || Number(r.order) > 20) return undefined;
  if (!finite(r.overlap) || r.overlap < 0 || r.overlap >= 1) return undefined;
  if (r.xMin !== undefined && !finite(r.xMin)) return undefined;
  if (r.xMax !== undefined && !finite(r.xMax)) return undefined;
  if (finite(r.xMin) && finite(r.xMax) && r.xMin >= r.xMax) return undefined;
  if (r.bandwidth !== undefined && (!finite(r.bandwidth) || r.bandwidth <= 0)) return undefined;
  return {
    kind: "spectral",
    version: 1,
    operation: r.operation as SpectralOperation,
    channels,
    ...(finite(r.xMin) ? { xMin: r.xMin } : {}),
    ...(finite(r.xMax) ? { xMax: r.xMax } : {}),
    resample: r.resample === true,
    outputType: r.outputType as SpectralAnalysisRecipe["outputType"],
    sided: r.sided as SpectralAnalysisRecipe["sided"],
    window: r.window as SpectralAnalysisRecipe["window"],
    detrend: r.detrend as SpectralAnalysisRecipe["detrend"],
    zeroPad: Number(r.zeroPad),
    segmentLen: Number(r.segmentLen),
    overlap: r.overlap,
    filterType: r.filterType as SpectralFilterType,
    cutoff: [...r.cutoff] as number[],
    ...(finite(r.bandwidth) ? { bandwidth: r.bandwidth } : {}),
    order: Number(r.order),
    correlationDemean: r.correlationDemean !== false,
  };
}
