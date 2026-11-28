// SIMS depth profile, Compare tab: its preset adapter (plans/PRESET_BAR_CONTRACT.md
// section 6), generic backend. A preset is which species are compared, BY LABEL
// (P5), and the decade stagger. The picked profiles are DATA and are never
// stored: Apply says to pick them. A species no picked profile has is skipped and
// named, and the current choice stays. There are no mode-dependent knobs, so
// nothing is hidden. (The Process tab's adapter is `presetAdapter.ts`, workshop
// "sims"; Align and Region have their own.)
// Lazy: loaded with the preset bar and after a successful Create comparison.

import {
  checkNumberText, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkLabelList, resolveLabels } from "../presets/columnLabels";
import { MAX_STAGGER, parseStagger, type SimsCompareState } from "./useSimsCompare";

export interface SimsComparePreset {
  /** The species compared, by label. */
  species: string[];
  /** Decades per trace, as typed (blank = none). */
  stagger: string;
}

/** The slice of the Compare tab the adapter reads and writes. */
export type SimsCompareHandle = Pick<SimsCompareState, "speciesOptions" | "species" | "setSpecies" | "stagger" | "setStagger">;

export const SIMS_COMPARE_WORKSHOP = "sims-compare";
export const SIMS_COMPARE_SCHEMA = 1;

const stagger: FieldCheck = (v) => {
  const problem = checkNumberText()(v);
  if (problem) return problem;
  return parseStagger(v as string) === null ? `must be a whole number of decades between −${MAX_STAGGER} and ${MAX_STAGGER}` : null;
};

const parseSettings = (raw: unknown): SimsComparePreset | { error: string } =>
  parseFields<SimsComparePreset>(raw, { species: checkLabelList(1, 200), stagger });

export function createSimsCompareAdapter(panel: SimsCompareHandle): PresetAdapter<SimsComparePreset> {
  return {
    workshop: SIMS_COMPARE_WORKSHOP,
    label: "SIMS compare",
    runLabel: "Create comparison",
    schema: SIMS_COMPARE_SCHEMA,
    fieldNames: { species: "species" },
    defaults: () => ({ species: panel.speciesOptions.map((o) => o.name), stagger: "0" }),
    parse: parseSettings,
    capture: () => ({ species: [...panel.species], stagger: panel.stagger }),
    apply(s): ApplyOutcome {
      const options = panel.speciesOptions.map((o, index) => ({ index, label: o.name }));
      const found = resolveLabels(s.species, options);
      const skipped = found.missing.map((name) => ({ field: "species", reason: `species '${name}' is in none of the picked profiles` }));
      if (found.indices.length) panel.setSpecies(found.indices.map((i) => options[i]!.label));
      panel.setStagger(s.stagger);
      const notes = ["pick the profiles to compare: a preset does not store them"];
      return { ok: true, applied: Object.keys(s).filter((k) => k !== "species" || found.indices.length > 0), skipped, notes };
    },
    describe: (s) => `${s.species.join(", ")}, stagger ${s.stagger.trim() || "0"} decades`,
  };
}

/** After a successful Create: remember the settings as last used (only if they would read back). */
export function recordSimsCompareRun(settings: SimsComparePreset): void {
  const stored = { species: [...settings.species], stagger: settings.stagger };
  if ("error" in parseSettings(stored)) return;
  recordLastUsed({ workshop: SIMS_COMPARE_WORKSHOP, schema: SIMS_COMPARE_SCHEMA }, stored);
}
