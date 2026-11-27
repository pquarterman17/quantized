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
// Lazy: loaded with the preset bar and after a successful Create.

import type { Dispatch, SetStateAction } from "react";

import {
  checkBoolean, checkNumberText, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkNested, checkWhole } from "../presets/nestedFields";
import {
  BESSEL_NORM_OPTIONS, FILTER_ENGINE_OPTIONS, IIR_BAND_OPTIONS, IIR_FAMILY_OPTIONS, REFERENCE_MODE_OPTIONS, SETTINGS_OPERATIONS,
  SMOOTH_METHOD_OPTIONS, SPECTRAL_DETREND_OPTIONS, SPECTRAL_FILTER_TYPE_OPTIONS, SPECTRAL_OUTPUT_OPTIONS, SPECTRAL_SIDED_OPTIONS,
  SPECTRAL_WINDOW_OPTIONS, psdScalingOptions,
} from "./signalOptions";
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

/** An off range stores no limits (they are this worksheet's extent, seeded by the panel); an on range stores a finite increasing pair. */
function rangeProblem(o: { useRange: boolean; xMin: string; xMax: string }): string | null {
  if (!o.useRange) return o.xMin === "" && o.xMax === "" ? null : "setting 'xMin' and 'xMax' must be empty while the X range is off";
  const lo = Number(o.xMin);
  const hi = Number(o.xMax);
  return o.xMin.trim() !== "" && o.xMax.trim() !== "" && Number.isFinite(lo) && Number.isFinite(hi) && lo < hi
    ? null
    : "setting 'xMin' must be a number below 'xMax' while the X range is on";
}

const signalCheck: FieldCheck = checkNested<SignalPresetSignal>({
  operation: checkOneOf(SETTINGS_OPERATIONS),
  smoothMethod: checkOneOf(values(SMOOTH_METHOD_OPTIONS)),
  smoothWindow: checkWhole(1),
  smoothPolyOrder: checkWhole(0),
  referenceMode: checkOneOf(values(REFERENCE_MODE_OPTIONS)),
  referenceValue: numberText, referenceMin: numberText, referenceMax: numberText,
  detrendOrder: checkWhole(0, 5),
  useRange: checkBoolean, xMin: numberText, xMax: numberText,
  useAllRows: checkBoolean,
}, rangeProblem);

const spectralCheck: FieldCheck = checkNested<SpectralUiSettings>({
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
}, rangeProblem);

function parseSettings(raw: unknown): SignalPresetSettings | { error: string } {
  return parseFields<SignalPresetSettings>(raw, { signal: signalCheck, spectral: spectralCheck });
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

export function createSignalAdapter(panel: SignalPanelHandle): PresetAdapter<SignalPresetSettings> {
  return {
    workshop: SIGNAL_WORKSHOP,
    label: "Signal processing",
    runLabel: "Create new worksheet",
    schema: SIGNAL_SCHEMA,
    defaults: () => settingsFromPanel(DEFAULT_SIGNAL_SETTINGS, DEFAULT_SPECTRAL_SETTINGS),
    parse: parseSettings,
    capture: () => settingsFromPanel(panel.settings, panel.spectral),
    apply(s): ApplyOutcome {
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
