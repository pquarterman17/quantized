// Resample's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6): the
// settings the form holds, minus anything that names data. The dataset to
// match (`matchId`) is a dataset id, so it is never stored (P5); applying a
// "match" preset keeps the dataset already chosen and says to check it.
// Lazy: loaded with the preset bar and after a successful run.

import {
  checkBoolean, checkNumberText, checkOneOf, parseFields,
  type ApplyOutcome, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { RESAMPLE_METHODS } from "../../../lib/transformResample";
import { MODE_OPTIONS, OUT_OF_RANGE_OPTIONS, type ResampleForm } from "./resampleForm";

export type ResampleSettings = Omit<ResampleForm, "matchId">;

/** The slice of the panel the adapter reads and writes. */
export interface ResamplePanelHandle {
  getForm(): ResampleForm;
  /** Replace the form wholesale (no range defaults are filled in). */
  replaceForm(form: ResampleForm): void;
}

export const RESAMPLE_WORKSHOP = "resample";
export const RESAMPLE_SCHEMA = 1;

export function settingsFromForm(f: ResampleForm): ResampleSettings {
  return {
    mode: f.mode, nPoints: f.nPoints, step: f.step, start: f.start, stop: f.stop, rangeStep: f.rangeStep,
    method: f.method, outOfRange: f.outOfRange, sortUnsorted: f.sortUnsorted,
  };
}

const positive = (n: number) => (n > 0 ? null : "must be positive");
const nonZero = (n: number) => (n !== 0 ? null : "must not be zero");
const wholeFrom2 = (n: number) => (Number.isInteger(n) && n >= 2 ? null : "must be a whole number of 2 or more");

const DEFAULTS: ResampleSettings = settingsFromForm({
  mode: "n_points", nPoints: "500", step: "", start: "", stop: "", rangeStep: "", matchId: "",
  method: "linear", outOfRange: "nan", sortUnsorted: false,
});

export function createResampleAdapter(panel: ResamplePanelHandle): PresetAdapter<ResampleSettings> {
  return {
    workshop: RESAMPLE_WORKSHOP,
    label: "Resample",
    runLabel: "Create",
    schema: RESAMPLE_SCHEMA,
    defaults: () => ({ ...DEFAULTS }),
    parse: (raw) =>
      parseFields<ResampleSettings>(raw, {
        mode: checkOneOf(MODE_OPTIONS.map((o) => o.value)),
        nPoints: checkNumberText(wholeFrom2),
        step: checkNumberText(positive),
        start: checkNumberText(),
        stop: checkNumberText(),
        rangeStep: checkNumberText(nonZero),
        method: checkOneOf(RESAMPLE_METHODS),
        outOfRange: checkOneOf(OUT_OF_RANGE_OPTIONS.map((o) => o.value)),
        sortUnsorted: checkBoolean,
      }),
    capture: () => settingsFromForm(panel.getForm()),
    apply(settings): ApplyOutcome {
      panel.replaceForm({ ...panel.getForm(), ...settings });
      const notes = settings.mode === "match" ? ["pick the dataset whose x to match: a preset does not store datasets"] : [];
      return { ok: true, applied: Object.keys(settings), skipped: [], notes };
    },
    describe: (s) => {
      const grid = s.mode === "n_points" ? `${s.nPoints} points` : s.mode === "step" ? `step ${s.step}` : s.mode === "range" ? `${s.start} : ${s.rangeStep} : ${s.stop}` : "match another dataset";
      return `${grid}, ${s.method}, outside the data: ${s.outOfRange === "nan" ? "blank" : "drop"}${s.sortUnsorted ? ", sort x" : ""}`;
    },
  };
}

/** After a successful Create: remember the form as the last-used settings. */
export function recordResampleRun(form: ResampleForm): void {
  recordLastUsed({ workshop: RESAMPLE_WORKSHOP, schema: RESAMPLE_SCHEMA }, settingsFromForm(form));
}
