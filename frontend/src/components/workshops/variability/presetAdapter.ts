// Variability's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset holds the three column picks (Response, Factor A,
// Factor B), each by LABEL (P5). The chart has no other setting. A label the
// sheet lacks is skipped and named under its user-facing field name and the
// current pick for that field is kept; the shared planColumnFields writes the
// message. Lazy: loaded with the preset bar and after a successful Save result.

import {
  parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { labelsOf, resolveLabels, type LabeledColumn } from "../presets/columnLabels";

export interface VariabilitySettings {
  response: string;
  factorA: string;
  factorB: string;
}

/** The slice of the panel the adapter reads and writes. */
export interface VariabilityPanelHandle {
  columns(): readonly LabeledColumn[];
  getPicks(): { responseCol: number; factorACol: number; factorBCol: number };
  setPicks(picks: { responseCol: number; factorACol: number; factorBCol: number }): void;
}

export const VARIABILITY_WORKSHOP = "variability";
export const VARIABILITY_SCHEMA = 1;

const checkLabel: FieldCheck = (v) =>
  typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label";

export function settingsFrom(columns: readonly LabeledColumn[], p: { responseCol: number; factorACol: number; factorBCol: number }): VariabilitySettings {
  const [response = "", factorA = "", factorB = ""] = [p.responseCol, p.factorACol, p.factorBCol].map((i) => labelsOf([i], columns)[0] ?? "");
  return { response, factorA, factorB };
}

export function createVariabilityAdapter(panel: VariabilityPanelHandle): PresetAdapter<VariabilitySettings> {
  const adapter: PresetAdapter<VariabilitySettings> = {
    workshop: VARIABILITY_WORKSHOP,
    label: "Variability chart",
    runLabel: "Save result",
    schema: VARIABILITY_SCHEMA,
    columnFields: ["response", "factorA", "factorB"],
    fieldNames: { response: "Response (Y)", factorA: "Factor A (outer)", factorB: "Factor B (nested in A)" },
    // Not read by the bar; the first three columns, so the contract's "defaults parse" holds.
    defaults() {
      const [response = "", factorA = "", factorB = ""] = panel.columns().map((c) => c.label);
      return { response, factorA, factorB };
    },
    parse: (raw) => parseFields<VariabilitySettings>(raw, { response: checkLabel, factorA: checkLabel, factorB: checkLabel }),
    capture: () => settingsFrom(panel.columns(), panel.getPicks()),
    apply(settings): ApplyOutcome {
      const columns = panel.columns();
      const plan = planColumnFields(adapter, settings, columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const gone = new Set(plan.skipped.map((s) => s.field));
      const now = panel.getPicks();
      const pick = (field: keyof VariabilitySettings, current: number) =>
        gone.has(field) ? current : (resolveLabels([settings[field]], columns).indices[0] ?? current);
      panel.setPicks({
        responseCol: pick("response", now.responseCol), factorACol: pick("factorA", now.factorACol), factorBCol: pick("factorB", now.factorBCol),
      });
      return { ok: true, applied: Object.keys(settings).filter((k) => !gone.has(k)), skipped: plan.skipped, notes: [] };
    },
    describe: (s) => `${s.response} by ${s.factorA} / ${s.factorB}`,
  };
  return adapter;
}

/** After a successful Save result: remember the picks it was computed with. */
export function recordVariabilityRun(settings: VariabilitySettings): void {
  recordLastUsed({ workshop: VARIABILITY_WORKSHOP, schema: VARIABILITY_SCHEMA }, settings);
}
