import { applyCorrections } from "./api";
import { runSpectralWorkbench } from "./api/spectralWorkbench";
import { lit } from "./macro";
import {
  rebindSpectralRecipe,
  sanitizeSpectralRecipe,
  type SpectralAnalysisRecipe,
} from "./spectralWorkbench";
import type { CorrectionParams, DataStruct, Dataset } from "./types";

export interface SignalChannelRef {
  index: number;
  label: string;
  unit: string;
}

/** Versioned recipe for correction-backed Signal Processing operations. */
export interface SignalCorrectionRecipe {
  kind: "signal-correction";
  version: 1;
  operation: string;
  channels: SignalChannelRef[];
  params: CorrectionParams;
}

export type SignalAnalysisRecipe = SignalCorrectionRecipe | SpectralAnalysisRecipe;

export interface SignalTransformParams {
  op: "signal";
  recipe: SignalAnalysisRecipe;
}

export interface SignalTransformResult {
  data: DataStruct;
  name: string;
  recipe: SignalAnalysisRecipe;
  datasetPatch: Partial<Dataset>;
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const CORRECTION_OPERATIONS = new Set([
  "Smooth",
  "Normalize to 0–1",
  "Normalize peak to 1",
  "Z-score",
  "Normalize area to 1",
  "Normalize to reference",
  "Detrend",
  "First derivative",
  "Second derivative",
  "Cumulative integral",
  "Logarithmic derivative",
]);

const OPERATION_PARAMS: Record<string, Readonly<Record<string, unknown>>> = {
  "Normalize to 0–1": { normMethod: "Range [0,1]" },
  "Normalize peak to 1": { normMethod: "Peak (max=1)" },
  "Z-score": { normMethod: "Z-score" },
  "Normalize area to 1": { normMethod: "Area (integral=1)" },
  "First derivative": { derivativeMode: "dY/dX" },
  "Second derivative": { derivativeMode: "d²Y/dX²" },
  "Cumulative integral": { derivativeMode: "∫Y dx" },
  "Logarithmic derivative": { derivativeMode: "dlog/dlog" },
};

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeCorrectionParams(
  raw: Record<string, unknown>,
  operation: string,
  channelIndices: number[],
): CorrectionParams | null {
  const result: CorrectionParams = { signalChannels: channelIndices };
  const allowed = new Set(["signalChannels"]);
  const min = raw.xTrimMin;
  const max = raw.xTrimMax;
  if (min !== undefined || max !== undefined) {
    if (!finiteNumber(min) || !finiteNumber(max) || min >= max) return null;
    result.xTrimMin = min;
    result.xTrimMax = max;
    allowed.add("xTrimMin");
    allowed.add("xTrimMax");
  }
  if (operation === "Smooth") {
    const window = raw.smoothWindow;
    const method = raw.smoothMethod;
    const order = raw.smoothPolyOrder;
    if (raw.smoothEnabled !== true || !Number.isInteger(window) || (window as number) < 1 ||
        !["moving", "gaussian", "savitzky-golay", "savgol"].includes(String(method)) ||
        (order !== undefined && (!Number.isInteger(order) || (order as number) < 0))) return null;
    Object.assign(result, {
      smoothEnabled: true,
      smoothWindow: window as number,
      smoothMethod: method as string,
      ...(order === undefined ? {} : { smoothPolyOrder: order as number }),
    });
    ["smoothEnabled", "smoothWindow", "smoothMethod", "smoothPolyOrder"].forEach((key) => allowed.add(key));
  } else if (operation === "Normalize to reference") {
    const value = raw.normReferenceValue;
    const lower = raw.normReferenceMin;
    const upper = raw.normReferenceMax;
    const byValue = finiteNumber(value) && value !== 0 && lower === undefined && upper === undefined;
    const byRange = value === undefined && finiteNumber(lower) && finiteNumber(upper) && lower < upper;
    if (raw.normMethod !== "Reference" || (!byValue && !byRange)) return null;
    Object.assign(result, {
      normMethod: "Reference",
      ...(byValue ? { normReferenceValue: value } : {
        normReferenceMin: lower as number,
        normReferenceMax: upper as number,
      }),
    });
    ["normMethod", "normReferenceValue", "normReferenceMin", "normReferenceMax"].forEach((key) => allowed.add(key));
  } else if (operation === "Detrend") {
    const order = raw.detrendOrder;
    if (!Number.isInteger(order) || (order as number) < 0 || (order as number) > 5) return null;
    result.detrendOrder = order as number;
    allowed.add("detrendOrder");
  } else {
    const expected = OPERATION_PARAMS[operation];
    if (!expected) return null;
    for (const [key, value] of Object.entries(expected)) {
      if (raw[key] !== value) return null;
      Object.assign(result, { [key]: value });
      allowed.add(key);
    }
  }
  return Object.keys(raw).every((key) => allowed.has(key)) ? result : null;
}

function sanitizeCorrectionRecipe(value: unknown): SignalCorrectionRecipe | null {
  const raw = object(value);
  if (!raw || raw.kind !== "signal-correction" || raw.version !== 1) return null;
  if (typeof raw.operation !== "string" || !CORRECTION_OPERATIONS.has(raw.operation)) return null;
  if (!Array.isArray(raw.channels) || raw.channels.length === 0) return null;
  const channels = raw.channels.flatMap((value): SignalChannelRef[] => {
    const channel = object(value);
    return channel && finiteIndex(channel.index) && typeof channel.label === "string" && typeof channel.unit === "string"
      ? [{ index: channel.index, label: channel.label, unit: channel.unit }]
      : [];
  });
  if (channels.length !== raw.channels.length) return null;
  if (new Set(channels.map((channel) => channel.index)).size !== channels.length) return null;
  const params = object(raw.params);
  if (!params) return null;
  const signalChannels = params.signalChannels;
  if (!Array.isArray(signalChannels) || signalChannels.length !== channels.length ||
      !signalChannels.every((value, index) => value === channels[index].index)) return null;
  const safeParams = sanitizeCorrectionParams(params, raw.operation, channels.map((channel) => channel.index));
  if (!safeParams) return null;
  return {
    kind: "signal-correction",
    version: 1,
    operation: raw.operation,
    channels,
    params: safeParams,
  };
}

/** Validate the user-editable transform payload before replay. */
export function signalTransformParamsOf(raw: Record<string, unknown>): SignalTransformParams {
  const recipe = sanitizeCorrectionRecipe(raw.recipe) ?? sanitizeSpectralRecipe(raw.recipe);
  if (!recipe) throw new Error('transform "signal" has a malformed or unsupported recipe');
  return { op: "signal", recipe };
}

export function signalRecipeChannels(recipe: SignalAnalysisRecipe): readonly SignalChannelRef[] {
  return recipe.channels.map((channel) => ({
    index: channel.index,
    label: channel.label,
    unit: channel.unit ?? "",
  }));
}

/** Resolve a transform recipe against its current input. Label wins; the
 * recorded position is the deliberate Pipeline-template fallback after the
 * Recipe Library has conformed a differently named target to the recording's
 * layout. Linked spectral recalculation remains strict and calls
 * rebindSpectralRecipe directly, without this fallback. */
export function bindSignalRecipe(recipe: SignalAnalysisRecipe, data: DataStruct): SignalAnalysisRecipe {
  const channels = signalRecipeChannels(recipe).map((channel) => {
    const matches = data.labels.flatMap((label, index) => label === channel.label ? [index] : []);
    const index = matches.length === 1
      ? matches[0]
      : matches.length === 0 && channel.index < data.labels.length
        ? channel.index
        : -1;
    if (index < 0) throw new Error(`signal column "${channel.label}" changed or is ambiguous`);
    const expected = channel.unit.trim();
    const actual = (data.units[index] ?? "").trim();
    if (expected && actual && expected !== actual) {
      throw new Error(`signal column "${channel.label}" changed units from ${expected} to ${actual}`);
    }
    return { index, label: data.labels[index], unit: actual };
  });
  if (recipe.kind === "spectral") {
    return {
      ...recipe,
      channels,
    };
  }
  return {
    ...recipe,
    channels,
    params: { ...recipe.params, signalChannels: channels.map((channel) => channel.index) },
  };
}

export function signalRecipeLabel(recipe: SignalAnalysisRecipe): string {
  if (recipe.kind === "spectral") {
    return {
      fft: "Frequency spectrum",
      filter: "Frequency filter",
      correlation: "Cross-correlation",
    }[recipe.operation];
  }
  return recipe.operation;
}

export function signalTransformStepText(params: SignalTransformParams): { label: string; code: string } {
  const label = `${signalRecipeLabel(params.recipe)} · ${params.recipe.channels.map((channel) => channel.label).join(", ")}`;
  return { label, code: `qz.transform("signal", "<active>", ${lit({ recipe: params.recipe })})` };
}

/** One compute path for interactive commit and Pipeline Studio replay. */
export async function computeSignalTransform(
  params: SignalTransformParams,
  source: Dataset,
  signal?: AbortSignal,
): Promise<SignalTransformResult> {
  const recipe = bindSignalRecipe(params.recipe, source.data);
  const label = signalRecipeLabel(recipe);
  if (recipe.kind === "spectral") {
    const data = await runSpectralWorkbench(source.data, recipe, signal);
    return {
      data,
      name: `${source.name} (${recipe.operation})`,
      recipe,
      datasetPatch: {
        raw: source.data,
        analysisRecipe: recipe,
        derivedFrom: { datasetId: source.id, pipeline: label },
        ...(source.workbookId ? { workbookId: source.workbookId } : {}),
        ...(source.folderId ? { folderId: source.folderId } : {}),
      },
    };
  }
  const data = await applyCorrections({
    dataset: source.data,
    params: recipe.params,
    ...(source.errorRoles ? { error_bindings: source.errorRoles } : {}),
  }, signal);
  return {
    data,
    name: `${source.name} (${recipe.operation})`,
    recipe,
    datasetPatch: {
      raw: source.data,
      corrections: recipe.params,
      derivedFrom: { datasetId: source.id, pipeline: label },
      ...(source.errorRoles ? { errorRoles: [...source.errorRoles] } : {}),
      ...(source.workbookId ? { workbookId: source.workbookId } : {}),
      ...(source.folderId ? { folderId: source.folderId } : {}),
    },
  };
}

/** Linked spectral outputs use the strict label+unit path on recalculation. */
export function rebindLinkedSpectralRecipe(recipe: SpectralAnalysisRecipe, data: DataStruct): SpectralAnalysisRecipe {
  return rebindSpectralRecipe(recipe, data.labels, data.units);
}
