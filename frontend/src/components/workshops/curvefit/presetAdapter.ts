// Curve Fit's preset adapter (plans/PRESET_BAR_CONTRACT.md sections 3 and 6).
// Fit templates ARE Curve Fit's presets: the bar reads and writes the same
// records the old "Templates" section did (an analysis template whose one step
// is a "fit" step, lib/fitTemplates.ts), through `fitTemplateBackend`, so a
// preset saved here still travels in the project, still replays as a pipeline
// step and still shows in the Recipe Library, and nothing is migrated.
//
// The adapter's settings (./curveFitSettings) are the template's settings in a FLAT, every-key
// form (an absent optional field becomes "" / true / null), which is what the
// shared strict parser and contract test expect; `toTemplateSettings` and
// `fromTemplateSettings` are the exact inverse pair to the stored shape.
// Settings only: model, parameter table (start / bounds / hold), weighting
// with its error column BY LABEL, and a value-space X range. No dataset ids
// and no row ranges (P5). A start the user did not choose is stored blank.
// Lazy: loaded with the preset bar and after a successful fit.

import { FIT_TEMPLATE_VERSION, FIT_WEIGHTS, sanitizeFitTemplate, type FitTemplateSettings } from "../../../lib/fitTemplates";
import { checkBoolean, checkOneOf, parseFields, type ApplyOutcome, type FieldCheck, type PresetAdapter } from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import type { WeightMode } from "../../../lib/types";
import { fromTemplateSettings, toTemplateSettings, type CurveFitSettings } from "./curveFitSettings";
import type { FitApplyResult } from "./useFitTemplateBinding";
import { fitTemplateBackend } from "./fitTemplateBackend";

/** The slice of the panel the adapter reads and writes (`useFitTemplateBinding`). */
export interface CurveFitPanelHandle {
  current: FitTemplateSettings;
  apply: (t: FitTemplateSettings) => FitApplyResult;
}

export const CURVEFIT_WORKSHOP = "curvefit";
export const CURVEFIT_SCHEMA = FIT_TEMPLATE_VERSION;

const checkModel: FieldCheck = (v) => (typeof v !== "string" || !v.trim() || v.length > 64 ? "must be a model name of 1 to 64 characters" : null);
const checkLabel: FieldCheck = (v) => (typeof v === "string" && v.length <= 64 ? null : "must be a column label of at most 64 characters");
const checkRows: FieldCheck = (v) => {
  if (!Array.isArray(v) || v.length > 64) return "must be a parameter table of at most 64 rows";
  for (const [i, row] of v.entries()) {
    if (sanitizeFitTemplate({ version: 1, model: "m", weight: "none", rows: [row] }) === null) return `row ${i + 1} is not a valid parameter row (name, start, min, max, held)`;
  }
  return null;
};
const checkRange: FieldCheck = (v) => {
  if (v === null) return null;
  const r = v as { lo?: unknown; hi?: unknown } | undefined;
  const ok = typeof v === "object" && r && typeof r.lo === "number" && typeof r.hi === "number" && Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo <= r.hi;
  return ok ? null : "must be null or an X range with lo <= hi";
};

const DEFAULTS: CurveFitSettings = { model: "Linear", weight: "none", manualLabel: "", scaleErrors: true, rows: [], range: null };

const WEIGHT_WORDS: Record<WeightMode, string> = { none: "unweighted", yerr: "Y error column", poisson: "Poisson", manual: "manual error column", direct: "direct weights" };

export function createCurveFitAdapter(panel: CurveFitPanelHandle): PresetAdapter<CurveFitSettings> {
  const adapter: PresetAdapter<CurveFitSettings> = {
    workshop: CURVEFIT_WORKSHOP,
    label: "Curve Fit",
    runLabel: "Fit",
    schema: CURVEFIT_SCHEMA,
    columnFields: ["manualLabel"],
    defaults: () => ({ ...DEFAULTS, rows: [] }),
    parse: (raw) =>
      parseFields<CurveFitSettings>(raw, {
        model: checkModel,
        weight: checkOneOf(FIT_WEIGHTS),
        manualLabel: checkLabel,
        scaleErrors: checkBoolean,
        rows: checkRows,
        range: checkRange,
      }),
    capture: () => fromTemplateSettings(panel.current),
    apply(settings): ApplyOutcome {
      const out = panel.apply(toTemplateSettings(settings));
      if (!out.ok) return out;
      const skipped = new Set(out.skipped.map((s) => s.field));
      return { ok: true, applied: Object.keys(settings).filter((k) => !skipped.has(k)), skipped: out.skipped, notes: [] };
    },
    describe: (s) => {
      const column = s.manualLabel ? ` '${s.manualLabel}'` : "";
      const held = s.rows.filter((r) => r.fixed).length;
      return `${s.model}, ${WEIGHT_WORDS[s.weight]}${column}, ${s.range ? `X ${s.range.lo} to ${s.range.hi}` : "full X range"}, ${s.rows.length} parameters${held ? ` (${held} held)` : ""}`;
    },
  };
  adapter.backend = fitTemplateBackend(adapter);
  return adapter;
}

/** After a successful fit: remember the settings it ran with. */
export function recordCurveFitRun(current: FitTemplateSettings): void {
  recordLastUsed({ workshop: CURVEFIT_WORKSHOP, schema: CURVEFIT_SCHEMA }, fromTemplateSettings(current));
}
