// Tabulate's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend. A preset holds the layout: the nested group-by columns, the value
// columns (both by LABEL, P5), the statistic set and the grand-total switch.
// A label the sheet lacks is skipped and named; a layout left with no group-by
// or no value column refuses the whole Apply. The statistic list is the
// catalogue the picker offers (lib/tabulate STAT_KEYS), imported, never copied.
// Lazy: loaded with the preset bar and after a successful export or report.

import {
  checkBoolean, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { STAT_KEYS, type StatKey } from "../../../lib/tabulate";
import { checkLabelList, labelsOf, resolveLabels, skippedColumns, type LabeledColumn } from "../presets/columnLabels";
import { MAX_GROUP_COLS, type TabulateLayout } from "./useTabulate";

export interface TabulateSettings {
  groupCols: string[];
  valueCols: string[];
  statKeys: StatKey[];
  grandTotal: boolean;
}

/** The slice of the panel the adapter reads and writes. */
export interface TabulatePanelHandle {
  columns(): readonly LabeledColumn[];
  getLayout(): TabulateLayout;
  setLayout(layout: TabulateLayout): void;
}

export const TABULATE_WORKSHOP = "tabulate";
export const TABULATE_SCHEMA = 1;

const checkStats: FieldCheck = (v) => {
  if (!Array.isArray(v)) return "must be a list of statistics";
  const bad = v.find((k) => typeof k !== "string" || !(STAT_KEYS as readonly string[]).includes(k));
  if (bad !== undefined) return `must only hold statistics from: ${STAT_KEYS.join(", ")}`;
  return new Set(v).size === v.length ? null : "must not repeat a statistic";
};

export function settingsFrom(columns: readonly LabeledColumn[], layout: TabulateLayout): TabulateSettings {
  return {
    groupCols: labelsOf(layout.groupCols, columns), valueCols: labelsOf(layout.valueCols, columns),
    statKeys: [...layout.statKeys], grandTotal: layout.grandTotal,
  };
}

const DEFAULT_STATS: readonly StatKey[] = ["count", "mean", "sd", "min", "max", "median"];

export function createTabulateAdapter(panel: TabulatePanelHandle): PresetAdapter<TabulateSettings> {
  return {
    workshop: TABULATE_WORKSHOP,
    label: "Tabulate",
    runLabel: "Export",
    schema: TABULATE_SCHEMA,
    fieldNames: { groupCols: "group-by columns", valueCols: "value columns", statKeys: "statistics", grandTotal: "grand total row" },
    // Not read by the bar; the layout a fresh panel would show, so the contract's "defaults parse" holds.
    defaults: () => {
      const labels = panel.columns().map((c) => c.label);
      return { groupCols: labels.slice(1, 2), valueCols: labels.slice(2, 3), statKeys: [...DEFAULT_STATS], grandTotal: false };
    },
    parse: (raw) =>
      parseFields<TabulateSettings>(raw, {
        groupCols: checkLabelList(1, MAX_GROUP_COLS),
        valueCols: checkLabelList(1, 100),
        statKeys: checkStats,
        grandTotal: checkBoolean,
      }),
    capture: () => settingsFrom(panel.columns(), panel.getLayout()),
    apply(settings): ApplyOutcome {
      const columns = panel.columns();
      const group = resolveLabels(settings.groupCols, columns);
      const value = resolveLabels(settings.valueCols, columns);
      const gone = (what: string, m: string[]) => `none of the preset's ${what} is on this sheet (${m.map((l) => `'${l}'`).join(", ")})`;
      if (group.indices.length === 0) return { ok: false, reason: gone("group-by columns", group.missing) };
      if (value.indices.length === 0) return { ok: false, reason: gone("value columns", value.missing) };
      panel.setLayout({
        groupCols: group.indices, valueCols: value.indices,
        statKeys: STAT_KEYS.filter((k) => settings.statKeys.includes(k)), grandTotal: settings.grandTotal,
      });
      const skipped = [
        ...skippedColumns("groupCols", group.missing), ...skippedColumns("valueCols", value.missing),
      ];
      const dropped = new Set(skipped.map((s) => s.field));
      return { ok: true, applied: Object.keys(settings).filter((k) => !dropped.has(k)), skipped, notes: [] };
    },
    describe: (s) => `${s.valueCols.join(", ")} by ${s.groupCols.join(" × ")}: ${s.statKeys.join(", ") || "no statistics"}${s.grandTotal ? ", grand total" : ""}`,
  };
}

/** After a successful export or report: remember the layout it used. */
export function recordTabulateRun(columns: readonly LabeledColumn[], layout: TabulateLayout): void {
  recordLastUsed({ workshop: TABULATE_WORKSHOP, schema: TABULATE_SCHEMA }, settingsFrom(columns, layout));
}
