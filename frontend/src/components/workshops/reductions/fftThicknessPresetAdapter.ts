// Film thickness (FFT)'s preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The Reductions window holds five methods; this adapter is
// the FFT thickness one. A preset is the intensity channel BY LABEL (P5), the
// X-ray wavelength, the 2-theta window (a value-space range, allowed; empty
// means the whole scan), the taper window and the largest thickness shown.
// Nothing that names data: no dataset, no row range, no excluded rows. A
// channel label this sheet lacks (or has twice) is skipped and named, and the
// current channel stays. There are no mode-dependent knobs, so nothing is hidden.
// Lazy: loaded with the preset bar and after a successful Compute.

import {
  parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { FFT_THICKNESS_WINDOWS } from "./fftThicknessOptions";
import type { FftThicknessState } from "./useFftThickness";

export interface FftThicknessPreset {
  /** The intensity channel, by its label. */
  column: string;
  wavelength: number;
  /** null: from the start of the scan. */
  twoThetaMin: number | null;
  /** null: to the end of the scan. */
  twoThetaMax: number | null;
  windowFn: string;
  maxThicknessNm: number;
}

/** The slice of the section the adapter reads and writes. */
export type FftThicknessHandle = Pick<
  FftThicknessState,
  "columns" | "col" | "setCol" | "wavelength" | "setWavelength" | "twoThetaMin" | "setTwoThetaMin" | "twoThetaMax" | "setTwoThetaMax" |
  "windowFn" | "setWindowFn" | "maxThicknessNm" | "setMaxThicknessNm"
>;

export const FFT_THICKNESS_WORKSHOP = "fft-thickness";
export const FFT_THICKNESS_SCHEMA = 1;

const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");
const positive: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? null : "must be a positive number");
const edge: FieldCheck = (v) => (v === null || (typeof v === "number" && Number.isFinite(v)) ? null : "must be empty or a number");

function parseSettings(raw: unknown): FftThicknessPreset | { error: string } {
  const r = parseFields<FftThicknessPreset>(raw, {
    column: label,
    wavelength: positive,
    twoThetaMin: edge,
    twoThetaMax: edge,
    windowFn: (v) => (typeof v === "string" && FFT_THICKNESS_WINDOWS.some((w) => w.value === v) ? null : `must be one of ${FFT_THICKNESS_WINDOWS.map((w) => w.value).join(", ")}`),
    maxThicknessNm: positive,
  });
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as FftThicknessPreset;
  if (s.twoThetaMin !== null && s.twoThetaMax !== null && s.twoThetaMin >= s.twoThetaMax) return { error: "setting 'twoThetaMin' must be below 'twoThetaMax'" };
  return s;
}

export function presetFromPanel(p: Pick<FftThicknessHandle, "columns" | "col" | "wavelength" | "twoThetaMin" | "twoThetaMax" | "windowFn" | "maxThicknessNm">): FftThicknessPreset {
  return {
    column: p.columns.find((c) => c.index === p.col)?.label ?? "",
    wavelength: p.wavelength, twoThetaMin: p.twoThetaMin, twoThetaMax: p.twoThetaMax, windowFn: p.windowFn, maxThicknessNm: p.maxThicknessNm,
  };
}

export function createFftThicknessAdapter(panel: FftThicknessHandle): PresetAdapter<FftThicknessPreset> {
  const adapter: PresetAdapter<FftThicknessPreset> = {
    workshop: FFT_THICKNESS_WORKSHOP,
    label: "Film thickness (FFT)",
    runLabel: "Compute",
    schema: FFT_THICKNESS_SCHEMA,
    columnFields: ["column"],
    fieldNames: { column: "intensity channel" },
    defaults: () => ({ column: panel.columns[0]?.label ?? "Intensity", wavelength: 1.5406, twoThetaMin: null, twoThetaMax: null, windowFn: "hann", maxThicknessNm: 200 }),
    parse: parseSettings,
    capture: () => presetFromPanel(panel),
    apply(s): ApplyOutcome {
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const same = panel.columns.filter((c) => c.label === s.column);
      if (skipped.length === 0 && same.length === 1) panel.setCol(same[0]!.index);
      else if (skipped.length === 0 && same.length > 1) skipped.push({ field: "column", reason: `column '${s.column}' appears more than once on this sheet, so none was picked` });
      panel.setWavelength(s.wavelength);
      panel.setTwoThetaMin(s.twoThetaMin);
      panel.setTwoThetaMax(s.twoThetaMax);
      panel.setWindowFn(s.windowFn);
      panel.setMaxThicknessNm(s.maxThicknessNm);
      const skippedFields = new Set(skipped.map((x) => x.field));
      return { ok: true, applied: Object.keys(s).filter((k) => !skippedFields.has(k)), skipped, notes: [] };
    },
    describe: (s) => `${s.column}, ${s.wavelength} Å, 2θ ${s.twoThetaMin ?? "start"} to ${s.twoThetaMax ?? "end"}, ${s.windowFn} window, up to ${s.maxThicknessNm} nm`,
  };
  return adapter;
}

/** After a successful Compute: remember the settings as last used (only if they would read back). */
export function recordFftThicknessRun(settings: FftThicknessPreset): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: FFT_THICKNESS_WORKSHOP, schema: FFT_THICKNESS_SCHEMA }, settings);
}
