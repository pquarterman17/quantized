// Outlier screening's preset adapter (plans/PRESET_BAR_CONTRACT.md section 6),
// generic backend. The settings are the method, the MAD threshold, alpha and
// Rosner's k (the number of ESD iterations). The channel is not stored: it is a
// column of one sheet, and the brief for this tool is the screening rule, not
// the data. The screen follows the settings (there is no Run button), so the
// "commit" that writes last used is Save result.
// Lazy: loaded with the preset bar and after a successful save.

import {
  checkOneOf, parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { defaultAlpha } from "../../../lib/locale";
import { OUTLIER_METHODS, type OutlierMethod, type OutlierScreeningState } from "./useOutlierScreening";

export interface OutlierSettings {
  method: OutlierMethod;
  /** MAD only: the modified-z-score flag threshold. */
  threshold: number;
  /** Grubbs, Rosner and Dixon: the significance level. */
  alpha: number;
  /** Rosner only: the most outliers tested for (the ESD iterations). */
  k: number;
}

/** The slice of the panel the adapter reads and writes. */
export type OutlierPanelHandle = Pick<OutlierScreeningState, "method" | "setMethod" | "threshold" | "setThreshold" | "alpha" | "setAlpha" | "k" | "setK">;

export const OUTLIER_WORKSHOP = "outlier-screening";
export const OUTLIER_SCHEMA = 1;

const finite: FieldCheck = (v) => (typeof v === "number" && Number.isFinite(v) ? null : "must be a number");
const threshold: FieldCheck = (v) => finite(v) ?? ((v as number) > 0 ? null : "must be positive");
const alpha: FieldCheck = (v) => finite(v) ?? ((v as number) > 0 && (v as number) < 1 ? null : "must be between 0 and 1");
const k: FieldCheck = (v) => finite(v) ?? (Number.isInteger(v) && (v as number) >= 1 ? null : "must be a whole number of 1 or more");

function parseSettings(raw: unknown): OutlierSettings | { error: string } {
  return parseFields<OutlierSettings>(raw, { method: checkOneOf(OUTLIER_METHODS.map((m) => m.value)), threshold, alpha, k });
}

export const settingsFromPanel = (p: Pick<OutlierPanelHandle, "method" | "threshold" | "alpha" | "k">): OutlierSettings => ({
  method: p.method, threshold: p.threshold, alpha: p.alpha, k: p.k,
});

export function createOutlierAdapter(panel: OutlierPanelHandle): PresetAdapter<OutlierSettings> {
  return {
    workshop: OUTLIER_WORKSHOP,
    label: "Outlier screening",
    runLabel: "Save result",
    schema: OUTLIER_SCHEMA,
    defaults: () => ({ method: "grubbs", threshold: 3.5, alpha: defaultAlpha(), k: 2 }),
    parse: parseSettings,
    capture: () => settingsFromPanel(panel),
    apply(settings): ApplyOutcome {
      panel.setMethod(settings.method);
      panel.setThreshold(settings.threshold);
      panel.setAlpha(settings.alpha);
      panel.setK(settings.k);
      return { ok: true, applied: Object.keys(settings), skipped: [], notes: [] };
    },
    describe: (s) =>
      s.method === "mad" ? `${s.method}, threshold ${s.threshold}` : s.method === "rosner" ? `${s.method}, alpha ${s.alpha}, up to ${s.k} outliers` : `${s.method}, alpha ${s.alpha}`,
  };
}

/** After a successful Save result: remember the screening rule as last used (only if it would read back). */
export function recordOutlierRun(settings: OutlierSettings): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: OUTLIER_WORKSHOP, schema: OUTLIER_SCHEMA }, settings);
}
