// Reflectivity FFT's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The Reductions window holds five methods; this adapter is the
// Reflectivity FFT one. A preset is the reflectivity channel BY LABEL (P5), the
// neutron switch, the X-ray wavelength, the 2-theta (or Q) window (a value-space
// range, allowed; empty means the whole scan), the preprocess, the taper window,
// the largest thickness shown and the peak prominence. Nothing that names data:
// no dataset, no row range, no excluded rows. A channel label this sheet lacks
// (or has twice) is skipped and named, and the current channel stays. The
// wavelength is hidden in neutron mode (lib/presetShownFields.ts): neither
// checked nor stored there, and an Apply never writes a refused one.
// Lazy: loaded with the preset bar and after a successful Compute.

import {
  checkBoolean, checkOneOf, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { REFLECTIVITY_FFT_PREPROCESS, REFLECTIVITY_FFT_WINDOWS } from "./reflectivityFftOptions";
import type { ReflectivityFftState } from "./useReflectivityFft";

export interface ReflectivityFftPreset {
  /** The reflectivity channel, by its label. */
  column: string;
  isNeutron: boolean;
  /** X-ray wavelength in angstrom (X-ray mode only). */
  wavelength: number;
  /** null: from the start of the scan. */
  xMin: number | null;
  xMax: number | null;
  windowFn: string;
  preprocess: ReflectivityFftState["preprocess"];
  maxThicknessNm: number;
  peakProminence: number;
}

/** The slice of the section the adapter reads and writes. */
export type ReflectivityFftHandle = Pick<
  ReflectivityFftState,
  "columns" | "col" | "setCol" | "isNeutron" | "setIsNeutron" | "wavelength" | "setWavelength" | "xMin" | "xMax" | "setXMin" | "setXMax" |
  "windowFn" | "setWindowFn" | "preprocess" | "setPreprocess" | "maxThicknessNm" | "setMaxThicknessNm" | "peakProminence" | "setPeakProminence"
>;

export const REFLECTIVITY_FFT_WORKSHOP = "reflectivity-fft";
export const REFLECTIVITY_FFT_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");
const positive: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "must be a positive number");
const edge: FieldCheck = (v) => (v === null || (typeof v === "number" && Number.isFinite(v)) ? null : "must be empty or a number");

const STRICT: { [K in keyof ReflectivityFftPreset]: FieldCheck } = {
  column: label,
  isNeutron: checkBoolean,
  wavelength: positive,
  xMin: edge,
  xMax: edge,
  windowFn: checkOneOf(values(REFLECTIVITY_FFT_WINDOWS)),
  preprocess: checkOneOf(values(REFLECTIVITY_FFT_PREPROCESS)),
  maxThicknessNm: positive,
  peakProminence: positive,
};

const DEFAULTS: ReflectivityFftPreset = {
  column: "R", isNeutron: false, wavelength: 1.5406, xMin: null, xMax: null, windowFn: "hann", preprocess: "logR", maxThicknessNm: 500, peakProminence: 0.05,
};

/** Everything but the wavelength in neutron mode, which has no wavelength field. */
const shown = (s: Record<string, unknown>): string[] =>
  Object.keys(STRICT).filter((k) => !(k === "wavelength" && s["isNeutron"] === true));

const kit = shownFieldKit<ReflectivityFftPreset>(STRICT, DEFAULTS, shown);

function parseSettings(raw: unknown): ReflectivityFftPreset | { error: string } {
  const r = kit.parse(raw);
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as ReflectivityFftPreset;
  if (s.xMin !== null && s.xMax !== null && s.xMin >= s.xMax) return { error: "setting 'xMin' must be below 'xMax'" };
  return s;
}

export function presetFromPanel(
  p: Pick<ReflectivityFftHandle, "columns" | "col" | "isNeutron" | "wavelength" | "xMin" | "xMax" | "windowFn" | "preprocess" | "maxThicknessNm" | "peakProminence">,
): ReflectivityFftPreset {
  return {
    column: p.columns.find((c) => c.index === p.col)?.label ?? "",
    isNeutron: p.isNeutron, wavelength: p.wavelength, xMin: p.xMin, xMax: p.xMax, windowFn: p.windowFn, preprocess: p.preprocess,
    maxThicknessNm: p.maxThicknessNm, peakProminence: p.peakProminence,
  };
}

export function createReflectivityFftAdapter(panel: ReflectivityFftHandle): PresetAdapter<ReflectivityFftPreset> {
  const adapter: PresetAdapter<ReflectivityFftPreset> = {
    workshop: REFLECTIVITY_FFT_WORKSHOP,
    label: "Reflectivity FFT",
    runLabel: "Compute",
    schema: REFLECTIVITY_FFT_SCHEMA,
    columnFields: ["column"],
    fieldNames: { column: "reflectivity channel" },
    defaults: () => ({ ...DEFAULTS, column: panel.columns[0]?.label ?? "R" }),
    parse: parseSettings,
    capture: () => kit.storable(presetFromPanel(panel), DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = kit.storable(raw, presetFromPanel(panel)); // a refused hidden value is not written into the panel
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const same = panel.columns.filter((c) => c.label === s.column);
      if (skipped.length === 0 && same.length === 1) panel.setCol(same[0]!.index);
      else if (skipped.length === 0 && same.length > 1) skipped.push({ field: "column", reason: `column '${s.column}' appears more than once on this sheet, so none was picked` });
      panel.setIsNeutron(s.isNeutron);
      panel.setWavelength(s.wavelength);
      panel.setXMin(s.xMin);
      panel.setXMax(s.xMax);
      panel.setWindowFn(s.windowFn);
      panel.setPreprocess(s.preprocess);
      panel.setMaxThicknessNm(s.maxThicknessNm);
      panel.setPeakProminence(s.peakProminence);
      const skippedFields = new Set(skipped.map((x) => x.field));
      return { ok: true, applied: Object.keys(raw).filter((k) => !skippedFields.has(k)), skipped, notes: [] };
    },
    describe: (s) =>
      `${s.column}, ${s.isNeutron ? "neutron (Q)" : `${s.wavelength} Å`}, ${s.xMin ?? "start"} to ${s.xMax ?? "end"}, ${s.preprocess}, ${s.windowFn} window, up to ${s.maxThicknessNm} nm`,
  };
  return adapter;
}

/** After a successful Compute: remember the settings as last used (only if they would read back). */
export function recordReflectivityFftRun(settings: ReflectivityFftPreset): void {
  const stored = kit.storable(settings, DEFAULTS);
  if ("error" in parseSettings(stored)) return;
  recordLastUsed({ workshop: REFLECTIVITY_FFT_WORKSHOP, schema: REFLECTIVITY_FFT_SCHEMA }, stored);
}
