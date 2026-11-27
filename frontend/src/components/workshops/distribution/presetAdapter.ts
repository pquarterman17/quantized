// Distribution's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend. The settings are the column (by LABEL, P5), the distribution fit, the
// Compare switch, the percentile and the confidence-interval level and bootstrap
// switch. The By column is not stored (it is a second column pick), and nothing
// that names data is: no dataset ids, no row ranges, no excluded rows.
// The panel screens on its own as settings change (there is no Run button), so
// the "commit" that writes last used is Save result.
// Lazy: loaded with the preset bar and after a successful save.

import {
  checkBoolean, parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { CI_PERCENT_RANGE, DEFAULT_CI_PERCENT } from "../../../lib/distributionAnalysisResult";
import { FIT_PICKS } from "./fitPicks";
import type { DistributionState, FitPick } from "./useDistribution";

export interface DistributionSettings {
  /** The profiled column, by its label (the X column by its name). */
  column: string;
  fitDist: FitPick;
  compareOpen: boolean;
  /** 0-100, exclusive. */
  percentile: number;
  /** The confidence level in percent. */
  ciPercent: number;
  ciBootstrap: boolean;
}

/** The slice of the panel the adapter reads and writes. */
export type DistributionPanelHandle =
  Pick<DistributionState, "columns" | "col" | "setCol" | "byCol" | "fitDist" | "setFitDist" | "compareOpen" | "setCompareOpen" | "percentileInput" | "setPercentileInput"> & {
    ci: Pick<DistributionState["ci"], "percent" | "setPercent" | "bootstrap" | "setBootstrap">;
  };

export const DISTRIBUTION_WORKSHOP = "distribution";
export const DISTRIBUTION_SCHEMA = 1;

const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");
const range = (lo: number, hi: number, inclusive: boolean): FieldCheck => (v) =>
  typeof v === "number" && Number.isFinite(v) && (inclusive ? v >= lo && v <= hi : v > lo && v < hi)
    ? null : `must be a number between ${lo} and ${hi}`;

export const DEFAULT_DISTRIBUTION_SETTINGS: Readonly<DistributionSettings> = Object.freeze({
  column: "", fitDist: "none", compareOpen: false, percentile: 90, ciPercent: DEFAULT_CI_PERCENT, ciBootstrap: false,
});

export function settingsFromPanel(p: Pick<DistributionPanelHandle, "columns" | "col" | "fitDist" | "compareOpen" | "percentileInput"> & { ci: Pick<DistributionPanelHandle["ci"], "percent" | "bootstrap"> }): DistributionSettings {
  return {
    column: p.columns.find((c) => c.index === p.col)?.label ?? "",
    fitDist: p.fitDist, compareOpen: p.compareOpen, percentile: p.percentileInput,
    ciPercent: p.ci.percent, ciBootstrap: p.ci.bootstrap,
  };
}

function parseSettings(raw: unknown): DistributionSettings | { error: string } {
  return parseFields<DistributionSettings>(raw, {
    column: label,
    fitDist: (v) => (typeof v === "string" && FIT_PICKS.includes(v as FitPick) ? null : `must be one of ${FIT_PICKS.join(", ")}`),
    compareOpen: checkBoolean,
    percentile: range(0, 100, false),
    ciPercent: range(CI_PERCENT_RANGE[0], CI_PERCENT_RANGE[1], true),
    ciBootstrap: checkBoolean,
  });
}

export function createDistributionAdapter(panel: DistributionPanelHandle): PresetAdapter<DistributionSettings> {
  const adapter: PresetAdapter<DistributionSettings> = {
    workshop: DISTRIBUTION_WORKSHOP,
    label: "Distribution",
    runLabel: "Save result",
    recomputes: true,
    schema: DISTRIBUTION_SCHEMA,
    columnFields: ["column"],
    fieldNames: { column: "column" },
    defaults: () => ({ ...DEFAULT_DISTRIBUTION_SETTINGS, column: panel.columns[0]?.label ?? "x" }),
    parse: parseSettings,
    capture: () => settingsFromPanel(panel),
    apply(settings): ApplyOutcome {
      const labels = panel.columns.map((c) => c.label);
      const plan = planColumnFields(adapter, settings, labels);
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const matches = panel.columns.filter((c) => c.label === settings.column);
      if (skipped.length === 0 && matches.length > 1) {
        skipped.push({ field: "column", reason: `column '${settings.column}' appears more than once on this sheet, so none was picked` });
      } else if (skipped.length === 0) {
        panel.setCol(matches[0].index);
      }
      panel.setFitDist(settings.fitDist);
      panel.setCompareOpen(settings.compareOpen);
      panel.setPercentileInput(settings.percentile);
      panel.ci.setPercent(settings.ciPercent);
      panel.ci.setBootstrap(settings.ciBootstrap);
      const skippedFields = new Set(skipped.map((s) => s.field));
      const notes = panel.byCol !== null ? ["a By column is on: the fit, Compare and interval settings show when By is set to None"] : [];
      return { ok: true, applied: Object.keys(settings).filter((k) => !skippedFields.has(k)), skipped, notes };
    },
    describe: (s) =>
      `${s.column}, fit ${s.fitDist}${s.compareOpen ? ", compare" : ""}, ${s.percentile}th percentile, ${s.ciPercent}% intervals${s.ciBootstrap ? " with bootstrap" : ""}`,
  };
  return adapter;
}

/** After a successful Save result: remember the panel's settings as last used (only if they would read back). */
export function recordDistributionRun(settings: DistributionSettings): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: DISTRIBUTION_WORKSHOP, schema: DISTRIBUTION_SCHEMA }, settings);
}
