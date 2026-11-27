// Hysteresis' preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend. The loop analysis itself has no settings (the field and moment come
// from the plot), so what a preset holds is the comparison's TREND AXIS: the
// series source, its label and its unit, for the "Trend figures" of a batch.
// Settings only (P5): the values typed under a manual axis name worksheets, so
// they are never stored. A series source is a metadata key or a worksheet
// column named by its label; one the selected worksheets lack is skipped and
// named, and its label and unit are not applied without it.
// Lazy: loaded with the preset bar and after a successful batch worksheet.

import {
  parseFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { metadataLabel } from "../../../lib/hysteresisTrend";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { TREND_MANUAL, TREND_NONE } from "./useTrendAxis";

export interface HysteresisSettings {
  /** "" (table only), "__manual__", or a candidate key: `metadata:<key>` or `column:<label slug>`. */
  axisSource: string;
  axisLabel: string;
  axisUnit: string;
}

/** The slice of the batch section the adapter reads and writes. */
export interface HysteresisAxisHandle extends HysteresisSettings {
  /** The keys of the series sources the selected worksheets offer. */
  candidateKeys: readonly string[];
  applyAxis: (source: string, label: string, unit: string) => void;
}

export const HYSTERESIS_WORKSHOP = "hysteresis";
export const HYSTERESIS_SCHEMA = 1;

const sourceCheck: FieldCheck = (v) =>
  typeof v === "string" && (v === TREND_NONE || v === TREND_MANUAL || (/^(metadata|column):./.test(v) && v.length <= 200))
    ? null
    : "must be empty, the manual entry, or a metadata or column source";
const textCheck = (max: number): FieldCheck => (v) => (typeof v === "string" && v.length <= max ? null : `must be text of at most ${max} characters`);

function parseSettings(raw: unknown): HysteresisSettings | { error: string } {
  const r = parseFields<HysteresisSettings>(raw, { axisSource: sourceCheck, axisLabel: textCheck(120), axisUnit: textCheck(40) });
  if ("error" in r && Object.keys(r).length === 1) return r;
  const s = r as HysteresisSettings;
  if (s.axisSource === TREND_NONE && s.axisLabel !== "") return { error: "setting 'axisLabel' must be empty when no series source is chosen" };
  if (s.axisSource === TREND_NONE && s.axisUnit !== "") return { error: "setting 'axisUnit' must be empty when no series source is chosen" };
  return s;
}

/** A source as the user knows it: a metadata field's label, or the column label. */
const sourceName = (key: string): string => (key.startsWith("metadata:") ? metadataLabel(key.slice(9)) : key.slice(7).replace(/-/g, " "));

export function createHysteresisAdapter(axis: HysteresisAxisHandle): PresetAdapter<HysteresisSettings> {
  return {
    workshop: HYSTERESIS_WORKSHOP,
    label: "Hysteresis",
    runLabel: "Run Hysteresis comparison batch",
    schema: HYSTERESIS_SCHEMA,
    fieldNames: { axisSource: "Series source", axisLabel: "Axis label", axisUnit: "Axis unit" },
    defaults: () => ({ axisSource: TREND_NONE, axisLabel: "", axisUnit: "" }),
    parse: parseSettings,
    capture: () => ({ axisSource: axis.axisSource, axisLabel: axis.axisLabel, axisUnit: axis.axisUnit }),
    apply(s): ApplyOutcome {
      const fixed = s.axisSource === TREND_NONE || s.axisSource === TREND_MANUAL;
      if (!fixed && !axis.candidateKeys.includes(s.axisSource)) {
        return {
          ok: true, applied: [],
          skipped: [{ field: "axisSource", reason: `series source '${sourceName(s.axisSource)}' is not on the selected worksheets, so the axis label and unit were not applied either` }],
          notes: [],
        };
      }
      axis.applyAxis(s.axisSource, s.axisLabel, s.axisUnit);
      return { ok: true, applied: Object.keys(s), skipped: [], notes: s.axisSource === TREND_MANUAL ? ["enter the series values for each worksheet: a preset does not store them"] : [] };
    },
    describe: (s) => (s.axisSource === TREND_NONE ? "Table only (no trend figures)" : s.axisSource === TREND_MANUAL ? `Manual values: ${s.axisLabel}${s.axisUnit ? ` (${s.axisUnit})` : ""}` : `${s.axisLabel || sourceName(s.axisSource)}${s.axisUnit ? ` (${s.axisUnit})` : ""}`),
  };
}

/** After a worksheet of a comparison batch ran: remember the trend axis as last used (only if it would read back). */
export function recordHysteresisRun(settings: HysteresisSettings): void {
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: HYSTERESIS_WORKSHOP, schema: HYSTERESIS_SCHEMA }, settings);
}
