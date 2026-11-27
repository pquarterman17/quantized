// SIMS depth profile's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend, for the Process tab. A preset is which stages are on
// (calibration, background, normalisation, smoothing) and the options of each
// stage that is on. Settings only (P5): not the profile (a dataset), not the
// background region and the stated time unit of x (both are specific to one
// profile's x range and unit, and the panel itself resets them whenever the
// profile changes). The reference species, the species the background leaves
// alone and the RSF table name SPECIES, so they are stored BY LABEL: a label
// this profile lacks is skipped and named. Options of a stage that is off, or
// of a method that is not chosen, are hidden: neither checked nor stored
// (lib/presetShownFields.ts), so a refused value there never blocks Save.
// Lazy: loaded with the preset bar and after a successful Create.

import {
  checkBoolean, checkNumberText, checkOneOf, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { shownFieldKit } from "../../../lib/presetShownFields";
import { SIMS_LENGTH_UNITS, SIMS_SMOOTH_METHODS, SIMS_TIME_UNITS } from "../../../lib/transformSims";
import { checkLabelList, resolveLabels, skippedColumns } from "../presets/columnLabels";
import { SIMS_CAL_METHOD_OPTIONS, SIMS_SCALE_MODE_OPTIONS } from "./simsOptions";
import { defaultForm, type SimsForm } from "./simsForm";

export type SimsPreset = Omit<SimsForm, "bgLo" | "bgHi" | "timeUnit">;

/** The slice of the Process tab the adapter reads and writes. */
export interface SimsPanelHandle {
  form: SimsForm;
  /** The species of the profile being processed. */
  labels: readonly string[];
  setForm: (patch: Partial<SimsForm>) => void;
}

export const SIMS_WORKSHOP = "sims";
export const SIMS_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const positive = (n: number) => (n > 0 ? null : "must be positive");
const whole = (lo: number) => (n: number) => (Number.isInteger(n) && n >= lo ? null : `must be a whole number of ${lo} or more`);

const rsfCheck: FieldCheck = (v) => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return "must be a table of species and RSF values";
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 200) return "is too large";
  for (const [name, text] of entries) {
    if (!name || name.length > 200) return "must name its species";
    const problem = checkNumberText(positive)(text);
    if (problem) return `has a bad value for '${name}': ${problem}`;
  }
  return null;
};

const STRICT: { [K in keyof SimsPreset]: FieldCheck } = {
  calOn: checkBoolean,
  calMethod: checkOneOf(values(SIMS_CAL_METHOD_OPTIONS)),
  sputterRate: checkNumberText(positive),
  rateLen: checkOneOf(SIMS_LENGTH_UNITS),
  rateTime: checkOneOf(SIMS_TIME_UNITS),
  craterDepth: checkNumberText(positive),
  craterUnit: checkOneOf(SIMS_LENGTH_UNITS),
  totalTime: checkNumberText(positive),
  depthUnit: checkOneOf(SIMS_LENGTH_UNITS),
  scaleMode: checkOneOf(values(SIMS_SCALE_MODE_OPTIONS)),
  scaleValue: checkNumberText(positive),
  offset: checkNumberText(),
  bgOn: checkBoolean,
  bgKeep: checkLabelList(0, 200),
  normOn: checkBoolean,
  reference: (v) => (typeof v === "string" && v.length <= 200 ? null : "must be a species label"),
  rsf: rsfCheck,
  rsfUnit: (v) => (typeof v === "string" && v.length <= 40 ? null : "must be text of at most 40 characters"),
  smoothOn: checkBoolean,
  smoothMethod: checkOneOf(SIMS_SMOOTH_METHODS),
  window: checkNumberText(whole(1)),
  polyOrder: checkNumberText(whole(0)),
};

const DEFAULTS: SimsPreset = presetOf(defaultForm());

export function presetOf(f: SimsForm): SimsPreset {
  const { bgLo: _lo, bgHi: _hi, timeUnit: _t, ...rest } = f;
  void _lo; void _hi; void _t;
  return { ...rest, bgKeep: [...f.bgKeep], rsf: { ...f.rsf } };
}

/** The settings the stages that are on show (everything else is hidden from the user). */
function shown(s: Record<string, unknown>): string[] {
  return [
    "calOn", "bgOn", "normOn", "smoothOn",
    ...(s["calOn"] === true ? ["calMethod", "depthUnit", ...(s["calMethod"] === "rate" ? ["sputterRate", "rateLen", "rateTime"] : s["calMethod"] === "scale" ? ["scaleMode", "scaleValue", "offset"] : ["craterDepth", "craterUnit", "totalTime"])] : []),
    ...(s["bgOn"] === true ? ["bgKeep"] : []),
    ...(s["normOn"] === true ? ["reference", "rsf", "rsfUnit"] : []),
    ...(s["smoothOn"] === true ? ["smoothMethod", "window", ...(s["smoothMethod"] === "savitzky-golay" ? ["polyOrder"] : [])] : []),
  ];
}

const kit = shownFieldKit<SimsPreset>(STRICT, DEFAULTS, shown);

export function createSimsAdapter(panel: SimsPanelHandle): PresetAdapter<SimsPreset> {
  const adapter: PresetAdapter<SimsPreset> = {
    workshop: SIMS_WORKSHOP,
    label: "SIMS depth profile",
    runLabel: "Create processed dataset",
    schema: SIMS_SCHEMA,
    columnFields: ["reference"],
    fieldNames: { reference: "reference species", bgKeep: "species the background keeps", rsf: "RSF table" },
    defaults: () => ({ ...DEFAULTS, bgKeep: [], rsf: {} }),
    parse: kit.parse,
    capture: () => kit.storable(presetOf(panel.form), DEFAULTS),
    apply(raw): ApplyOutcome {
      const s = kit.storable(raw, presetOf(panel.form)); // a refused hidden value is not written into the form
      const species = panel.labels.map((label, index) => ({ index, label }));
      const skipped: { field: string; reason: string }[] = [];
      const patch: Partial<SimsForm> = { ...s };
      // The reference, by label: a species this profile lacks leaves the current reference.
      const plan = planColumnFields(adapter, s, panel.labels as string[]);
      if ("skipped" in plan) skipped.push(...plan.skipped);
      if (skipped.some((x) => x.field === "reference")) delete patch.reference;
      // The species the background keeps: the ones this profile has.
      const keep = resolveLabels(s.bgKeep, species);
      patch.bgKeep = keep.indices.map((i) => panel.labels[i]!);
      if (keep.missing.length) {
        skipped.push(...skippedColumns("bgKeep", keep.missing));
        if (patch.bgKeep.length === 0) delete patch.bgKeep;
      }
      // The RSF table: the entries for species this profile has.
      const rsfMissing = Object.keys(s.rsf).filter((name) => !panel.labels.includes(name));
      if (rsfMissing.length) {
        skipped.push(...skippedColumns("rsf", rsfMissing));
        patch.rsf = Object.fromEntries(Object.entries(s.rsf).filter(([name]) => panel.labels.includes(name)));
      }
      panel.setForm(patch);
      const skippedFields = new Set(skipped.map((x) => x.field));
      const notes: string[] = [];
      if (s.bgOn) notes.push("enter the background region: a preset does not store it");
      if (s.calOn && s.calMethod !== "scale") notes.push("check the time unit of x: a preset does not store it");
      return { ok: true, applied: Object.keys(raw).filter((k) => !skippedFields.has(k)), skipped, notes };
    },
    describe: (s) => {
      const stages = [
        s.calOn ? `calibrate (${s.calMethod})` : "",
        s.bgOn ? "background" : "",
        s.normOn ? `normalize to ${s.reference || "?"}` : "",
        s.smoothOn ? `smooth (${s.smoothMethod})` : "",
      ].filter(Boolean);
      return stages.length ? stages.join(", ") : "no stage on";
    },
  };
  return adapter;
}

/** After a successful Create: remember the stages as last used (only if they would read back). */
export function recordSimsRun(form: SimsForm): void {
  const settings = presetOf(form);
  if ("error" in kit.parse(settings)) return;
  recordLastUsed({ workshop: SIMS_WORKSHOP, schema: SIMS_SCHEMA }, settings);
}
