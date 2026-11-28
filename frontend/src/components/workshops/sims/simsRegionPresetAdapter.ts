// SIMS depth profile, Region tab: its preset adapter (plans/PRESET_BAR_CONTRACT.md
// section 6), generic backend. A preset is which species are measured, BY LABEL
// (P5), and the junction threshold rule (a percent of each species' peak, or an
// absolute value). The profile and the depth REGION (its two limits) are DATA, the
// part of one profile being measured, and are never stored: Apply says to enter
// the region. A species this profile lacks is skipped and named, and the current
// choice stays. There are no mode-dependent knobs (the threshold is shown in both
// modes; only its allowed range depends on the mode), so nothing is hidden.
// The tab recomputes as settings change; the run that counts is "Add to Reports"
// or "Export CSV".
// Lazy: loaded with the preset bar and after a successful report or export.

import {
  checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkLabelList, resolveLabels } from "../presets/columnLabels";
import { SIMS_THRESHOLD_MODE_OPTIONS } from "./simsOptions";
import type { RegionForm, SimsRegionState } from "./useSimsRegion";

export interface SimsRegionPreset {
  /** The species measured, by label. */
  species: string[];
  mode: RegionForm["mode"];
  /** Percent of each species' peak, or an absolute value, as typed. */
  threshold: string;
}

/** The slice of the Region tab the adapter reads and writes. */
export type SimsRegionHandle = Pick<SimsRegionState, "labels" | "form" | "setForm">;

export const SIMS_REGION_WORKSHOP = "sims-region";
export const SIMS_REGION_SCHEMA = 1;

const threshold: FieldCheck = (v) => (typeof v === "string" && v.length <= 40 && v.trim() !== "" && Number.isFinite(Number(v)) ? null : "must be a number");

function parseSettings(raw: unknown): SimsRegionPreset | { error: string } {
  const r = parseFields<SimsRegionPreset>(raw, { species: checkLabelList(1, 200), mode: checkOneOf(SIMS_THRESHOLD_MODE_OPTIONS.map((o) => o.value)), threshold });
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as SimsRegionPreset;
  if (s.mode === "fraction" && !(Number(s.threshold) > 0 && Number(s.threshold) < 100)) return { error: "setting 'threshold' must lie strictly between 0 and 100 percent" };
  return s;
}

const presetFromPanel = (p: SimsRegionHandle): SimsRegionPreset => ({
  species: p.labels.filter((l) => p.form.species.includes(l)),
  mode: p.form.mode,
  threshold: p.form.threshold,
});

export function createSimsRegionAdapter(panel: SimsRegionHandle): PresetAdapter<SimsRegionPreset> {
  return {
    workshop: SIMS_REGION_WORKSHOP,
    label: "SIMS region",
    runLabel: "Add to Reports",
    recomputes: true,
    schema: SIMS_REGION_SCHEMA,
    fieldNames: { species: "species" },
    defaults: () => ({ species: [...panel.labels], mode: "fraction", threshold: "50" }),
    parse: parseSettings,
    capture: () => presetFromPanel(panel),
    apply(s): ApplyOutcome {
      const options = panel.labels.map((label, index) => ({ index, label }));
      const found = resolveLabels(s.species, options);
      const skipped = found.missing.map((name) => ({ field: "species", reason: `species '${name}' is not in this profile` }));
      panel.setForm({ mode: s.mode, threshold: s.threshold, ...(found.indices.length ? { species: found.indices.map((i) => options[i]!.label) } : {}) });
      return {
        ok: true,
        applied: Object.keys(s).filter((k) => k !== "species" || found.indices.length > 0),
        skipped,
        notes: ["enter the depth region: a preset does not store it"],
      };
    },
    describe: (s) => `${s.species.join(", ")}, junction at ${s.threshold}${s.mode === "fraction" ? "% of each peak" : ""}`,
  };
}

/** After a real export or report: remember the settings as last used (only if they would read back). */
export function recordSimsRegionRun(form: RegionForm): void {
  const stored: SimsRegionPreset = { species: [...form.species], mode: form.mode, threshold: form.threshold };
  if ("error" in parseSettings(stored)) return;
  recordLastUsed({ workshop: SIMS_REGION_WORKSHOP, schema: SIMS_REGION_SCHEMA }, stored);
}
