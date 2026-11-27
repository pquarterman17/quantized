// Multivariate's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. A preset holds the picked columns (by LABEL, P5), the
// correlation method, the PCA standardize switch and the two score-plot axes.
// The PLS / LDA and Clustering tabs keep their settings in their own tabs and
// are not part of this preset. A label the sheet lacks is skipped and named;
// fewer than two columns left refuses the whole Apply (nothing is written).
// The method list is imported from ./multivarMethods, which the toggle uses.
// Lazy: loaded with the preset bar and after a successful Save result.

import {
  checkBoolean, checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkLabelList, labelsOf, resolveLabels, skippedColumns, type LabeledColumn } from "../presets/columnLabels";
import { CORR_METHODS, CORR_METHOD_LABELS, type CorrMethod } from "./multivarMethods";

export interface MultivarSettings {
  columns: string[];
  method: CorrMethod;
  standardize: boolean;
  /** Zero-based PC on the scores plot's x and y axes. */
  pcX: number;
  pcY: number;
}

/** The slice of the panel the adapter reads and writes. */
export interface MultivarPanelHandle {
  columns(): readonly LabeledColumn[];
  getSelected(): number[];
  setSelected(columns: number[]): void;
  getMethod(): CorrMethod;
  setMethod(m: CorrMethod): void;
  getStandardize(): boolean;
  setStandardize(b: boolean): void;
  getPc(): { pcX: number; pcY: number };
  setPc(pcX: number, pcY: number): void;
}

export const MULTIVAR_WORKSHOP = "multivar";
export const MULTIVAR_SCHEMA = 1;
const MAX_COLUMNS = 200;

const checkPc: FieldCheck = (v) =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 && v < MAX_COLUMNS ? null : "must be a whole number from 0";

export function settingsFrom(columns: readonly LabeledColumn[], selected: readonly number[], method: CorrMethod, standardize: boolean, pcX: number, pcY: number): MultivarSettings {
  return { columns: labelsOf(selected, columns), method, standardize, pcX, pcY };
}

export function createMultivarAdapter(panel: MultivarPanelHandle): PresetAdapter<MultivarSettings> {
  return {
    workshop: MULTIVAR_WORKSHOP,
    label: "Multivariate",
    runLabel: "Save result",
    schema: MULTIVAR_SCHEMA,
    fieldNames: { columns: "columns", method: "correlation method", standardize: "standardize", pcX: "PCA x axis", pcY: "PCA y axis" },
    // Not read by the bar; the first two columns, so the contract's "defaults parse" holds.
    defaults: () => ({ columns: panel.columns().slice(0, 2).map((c) => c.label), method: "pearson", standardize: false, pcX: 0, pcY: 1 }),
    parse(raw) {
      const out = parseFields<MultivarSettings>(raw, {
        columns: checkLabelList(2, MAX_COLUMNS),
        method: checkOneOf(CORR_METHODS),
        standardize: checkBoolean,
        pcX: checkPc,
        pcY: checkPc,
      });
      if ("error" in out) return out;
      for (const key of ["pcX", "pcY"] as const) {
        if (out[key] >= out.columns.length) return { error: `setting '${key}' must be less than the number of columns (${out.columns.length})` };
      }
      return out;
    },
    capture() {
      const { pcX, pcY } = panel.getPc();
      return settingsFrom(panel.columns(), panel.getSelected(), panel.getMethod(), panel.getStandardize(), pcX, pcY);
    },
    apply(settings): ApplyOutcome {
      const { indices, missing } = resolveLabels(settings.columns, panel.columns());
      if (indices.length < 2) {
        return { ok: false, reason: `fewer than 2 of the preset's columns are on this sheet (${missing.map((l) => `'${l}'`).join(", ")} missing)` };
      }
      const sorted = [...indices].sort((a, b) => a - b);
      const skipped = skippedColumns("columns", missing);
      const now = panel.getPc();
      const axis = (key: "pcX" | "pcY") => {
        if (settings[key] < sorted.length) return settings[key];
        skipped.push({ field: key, reason: `component ${settings[key] + 1} does not exist with ${sorted.length} columns` });
        return now[key];
      };
      const pcX = axis("pcX");
      const pcY = axis("pcY");
      panel.setSelected(sorted);
      panel.setMethod(settings.method);
      panel.setStandardize(settings.standardize);
      panel.setPc(pcX, pcY);
      const dropped = new Set(skipped.filter((s) => s.field !== "columns").map((s) => s.field));
      return { ok: true, applied: Object.keys(settings).filter((k) => !dropped.has(k)), skipped, notes: [] };
    },
    describe: (s) => `${s.columns.length} columns (${s.columns.join(", ")}), ${CORR_METHOD_LABELS[s.method]}${s.standardize ? ", standardized" : ""}, PC${s.pcX + 1} vs PC${s.pcY + 1}`,
  };
}

/** After a successful Save result: remember the settings the result was computed with. */
export function recordMultivarRun(settings: MultivarSettings): void {
  recordLastUsed({ workshop: MULTIVAR_WORKSHOP, schema: MULTIVAR_SCHEMA }, settings);
}
