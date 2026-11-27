// Signal Processing's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset holds the main workbench's settings: the operation
// and its options (smoothing, detrend order, the normalisation reference, the
// FFT / PSD / filter / correlation controls with the IIR design) and the row
// and X-range choices. Settings only (P5): no signal columns (they follow the
// plot, and a second worksheet is a dataset), no uncertainty choice (it is a
// choice about one dataset's errors), no dataset or row. The median, despike,
// wavelet and Spectrogram bodies keep their own state and are not covered.
// A preset is not a recipe: it fills this form, a recipe is the replayable
// step that "Save recipe" and "Apply to selected sheets" write.
// Options the chosen operation hides are neither checked nor stored (see
// signalPresetHidden.ts), so a refused value there never blocks Save.
// Lazy: loaded with the preset bar and after a successful Create.

import type { Dispatch, SetStateAction } from "react";

import {
  checkBoolean, checkNumberText, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { looseChecks, storeHidden } from "../../../lib/presetHiddenFields";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkNested, checkWhole } from "../presets/nestedFields";
import {
  BESSEL_NORM_OPTIONS, FILTER_ENGINE_OPTIONS, IIR_BAND_OPTIONS, IIR_FAMILY_OPTIONS, REFERENCE_MODE_OPTIONS, SETTINGS_OPERATIONS,
  SMOOTH_METHOD_OPTIONS, SPECTRAL_DETREND_OPTIONS, SPECTRAL_FILTER_TYPE_OPTIONS, SPECTRAL_OUTPUT_OPTIONS, SPECTRAL_SIDED_OPTIONS,
  SPECTRAL_WINDOW_OPTIONS, psdScalingOptions,
} from "./signalOptions";
import { hiddenSignalKeys, hiddenSpectralKeys } from "./signalPresetHidden";
import { DEFAULT_SIGNAL_SETTINGS, operationLabel, type SignalSettings } from "./signalProcessingModel";
import { DEFAULT_SPECTRAL_SETTINGS, type SpectralUiSettings } from "./spectralSettings";

/** The correction settings a preset holds: everything but the uncertainty choice. */
export type SignalPresetSignal = Omit<SignalSettings, "dropUncertainty">;

export interface SignalPresetSettings {
  signal: SignalPresetSignal;
  spectral: SpectralUiSettings;
}

/** The slice of the panel the adapter reads and writes. */
export interface SignalPanelHandle {
  settings: SignalSettings;
  setSettings: Dispatch<SetStateAction<SignalSettings>>;
  spectral: SpectralUiSettings;
  setSpectral: Dispatch<SetStateAction<SpectralUiSettings>>;
}

export const SIGNAL_WORKSHOP = "signal-processing";
export const SIGNAL_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const numberText = checkNumberText();

/** An X range that is on needs a finite increasing pair; while it is off the limits are hidden (the panel seeds them with the worksheet's extent). */
function rangeProblem(o: { useRange: boolean; xMin: string; xMax: string }): string | null {
  if (!o.useRange) return null;
  const lo = Number(o.xMin);
  const hi = Number(o.xMax);
  return o.xMin.trim() !== "" && o.xMax.trim() !== "" && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi
    ? null
    : "setting 'xMin' must be a number below 'xMax' while the X range is on";
}

const SIGNAL_SPEC: { [K in keyof SignalPresetSignal]: FieldCheck } = {
  operation: checkOneOf(SETTINGS_OPERATIONS),
  smoothMethod: checkOneOf(values(SMOOTH_METHOD_OPTIONS)),
  smoothWindow: checkWhole(1),
  smoothPolyOrder: checkWhole(0),
  referenceMode: checkOneOf(values(REFERENCE_MODE_OPTIONS)),
  referenceValue: numberText, referenceMin: numberText, referenceMax: numberText,
  detrendOrder: checkWhole(0, 5),
  useRange: checkBoolean, xMin: numberText, xMax: numberText,
  useAllRows: checkBoolean,
};

const SPECTRAL_SPEC: { [K in keyof SpectralUiSettings]: FieldCheck } = {
  filterEngine: checkOneOf(values(FILTER_ENGINE_OPTIONS)),
  iirFamily: checkOneOf(values(IIR_FAMILY_OPTIONS)),
  iirBand: checkOneOf(values(IIR_BAND_OPTIONS)),
  iirRp: numberText, iirRs: numberText,
  iirBesselNorm: checkOneOf(values(BESSEL_NORM_OPTIONS)),
  iirZeroPhase: checkBoolean,
  outputType: checkOneOf(values(SPECTRAL_OUTPUT_OPTIONS)),
  sided: checkOneOf(values(SPECTRAL_SIDED_OPTIONS)),
  window: checkOneOf(values(SPECTRAL_WINDOW_OPTIONS)),
  detrend: checkOneOf(values(SPECTRAL_DETREND_OPTIONS)),
  welch: checkBoolean,
  segmentLen: numberText, overlap: numberText,
  psdScaling: checkOneOf(values(psdScalingOptions(""))),
  zeroPad: numberText,
  filterType: checkOneOf(values(SPECTRAL_FILTER_TYPE_OPTIONS)),
  cutoffLow: numberText, cutoffHigh: numberText, bandwidth: numberText, order: numberText,
  useRange: checkBoolean, xMin: numberText, xMax: numberText,
  resample: checkBoolean,
  correlationDemean: checkBoolean,
};

/** A hidden setting still has to be the right kind of value (text, a number, a switch); it is not range or option checked. */
const typeOf = (sample: unknown): FieldCheck => (v) =>
  typeof v === typeof sample && (typeof v !== "number" || Number.isFinite(v)) ? null : `must be ${typeof sample === "string" ? "text" : typeof sample === "number" ? "a number" : "true or false"}`;
const loose = (spec: Record<string, FieldCheck>, defaults: object, hidden: readonly string[]): Record<string, FieldCheck> =>
  looseChecks(spec as never, hidden as never[], Object.fromEntries(hidden.map((k) => [k, typeOf((defaults as Record<string, unknown>)[k])])) as never) as Record<string, FieldCheck>;

const signalCheck: FieldCheck = (v) => {
  const hidden = hiddenSignalKeys(v);
  return checkNested(loose(SIGNAL_SPEC, DEFAULT_SIGNAL_SETTINGS, hidden), hidden.includes("useRange") ? undefined : (o) => rangeProblem(o as never))(v);
};

const spectralCheck = (operation: unknown): FieldCheck => (v) => {
  const hidden = hiddenSpectralKeys(operation, v);
  return checkNested(loose(SPECTRAL_SPEC, DEFAULT_SPECTRAL_SETTINGS, hidden), hidden.includes("useRange") ? undefined : (o) => rangeProblem(o as never))(v);
};

function parseSettings(raw: unknown): SignalPresetSettings | { error: string } {
  const signal = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["signal"] : undefined;
  const operation = typeof signal === "object" && signal !== null ? (signal as Record<string, unknown>)["operation"] : undefined;
  return parseFields<SignalPresetSettings>(raw, { signal: signalCheck, spectral: spectralCheck(operation) });
}

/** `settings` with every setting its operation hides, and which fails its strict check, taken from `fallback` (defaults on a save, the panel on an Apply). */
function storable(settings: SignalPresetSettings, fallback: SignalPresetSettings): SignalPresetSettings {
  const signal = storeHidden(settings.signal, SIGNAL_SPEC, hiddenSignalKeys(settings.signal) as never[], fallback.signal);
  const spectral = storeHidden(settings.spectral, SPECTRAL_SPEC, hiddenSpectralKeys(settings.signal.operation, settings.spectral) as never[], fallback.spectral);
  return { signal, spectral };
}

const withoutSeed = <T extends { useRange: boolean; xMin: string; xMax: string }>(o: T): T => (o.useRange ? { ...o } : { ...o, xMin: "", xMax: "" });

export function settingsFromPanel(settings: SignalSettings, spectral: SpectralUiSettings): SignalPresetSettings {
  const { dropUncertainty: _drop, ...signal } = settings;
  void _drop;
  return { signal: withoutSeed(signal), spectral: withoutSeed(spectral) };
}

/** The panel's X-range limits are this worksheet's extent while the range is off: an Apply with the range off leaves them. */
const merge = <T extends { useRange: boolean; xMin: string; xMax: string }>(cur: T, next: T): T =>
  ({ ...cur, ...next, ...(next.useRange ? {} : { xMin: cur.xMin, xMax: cur.xMax }) });

const defaultSettings = (): SignalPresetSettings => settingsFromPanel(DEFAULT_SIGNAL_SETTINGS, DEFAULT_SPECTRAL_SETTINGS);

export function createSignalAdapter(panel: SignalPanelHandle): PresetAdapter<SignalPresetSettings> {
  return {
    workshop: SIGNAL_WORKSHOP,
    label: "Signal processing",
    runLabel: "Create new worksheet",
    schema: SIGNAL_SCHEMA,
    defaults: defaultSettings,
    parse: parseSettings,
    capture: () => storable(settingsFromPanel(panel.settings, panel.spectral), defaultSettings()),
    apply(raw): ApplyOutcome {
      const s = storable(raw, settingsFromPanel(panel.settings, panel.spectral)); // a refused hidden value is not written into the panel
      panel.setSettings((cur) => merge(cur, s.signal as SignalSettings));
      panel.setSpectral((cur) => merge(cur, s.spectral));
      return { ok: true, applied: Object.keys(s), skipped: [], notes: ["check the signal columns: a preset does not store them"] };
    },
    describe: (s) => {
      const o = s.signal;
      const detail = o.operation === "smooth" ? `${o.smoothMethod}, half-window ${o.smoothWindow}`
        : o.operation === "detrend" ? `order ${o.detrendOrder}`
          : o.operation === "fft" ? s.spectral.outputType
            : o.operation === "filter" ? (s.spectral.filterEngine === "iir" ? `IIR ${s.spectral.iirFamily} ${s.spectral.iirBand}` : s.spectral.filterType)
              : "";
      return `${operationLabel(o.operation)}${detail ? `: ${detail}` : ""}`;
    },
  };
}

/** After a successful Create: remember the settings as last used (only if they would read back). */
export function recordSignalRun(settings: SignalSettings, spectral: SpectralUiSettings): void {
  const captured = settingsFromPanel(settings, spectral);
  if ("error" in parseSettings(captured)) return;
  recordLastUsed({ workshop: SIGNAL_WORKSHOP, schema: SIGNAL_SCHEMA }, captured);
}
