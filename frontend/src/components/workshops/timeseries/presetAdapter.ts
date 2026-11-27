// Time series' preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend. A preset is the tool (ACF / PACF, Stationarity, Decompose, Change
// points, ARIMA), the options of all five (so switching tabs after an Apply
// keeps them), the uneven-spacing switch and the series column BY LABEL.
// Settings only (P5): no dataset id, no row range, no excluded rows. A series
// label that this sheet lacks (or has twice) is skipped and named, and the
// current series stays. Options the chosen tool does not show (the other four
// tools' groups, the penalty value unless the penalty is "value", the maximum
// number of changes outside binary segmentation) are neither checked nor
// stored (presetHiddenFields.ts): a refused value there never blocks Save.
// Lazy: loaded with the preset bar and after a successful run.

import {
  checkBoolean, checkOneOf, parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { looseChecks, storeHidden } from "../../../lib/presetHiddenFields";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkAtLeast, checkNested, checkProbability, checkWhole } from "../presets/nestedFields";
import {
  ARIMA_TREND_OPTIONS, CP_COST_OPTIONS, CP_METHOD_OPTIONS, CP_PENALTY_OPTIONS, DECOMP_MODEL_OPTIONS, STAT_REGRESSION_OPTIONS, STAT_TESTS_OPTIONS,
} from "./timeSeriesOptions";
import { DEFAULT_TS_OPTIONS, TS_TABS, tsDefaultOptions, type TsOptions, type TsTab } from "./timeSeriesRun";
import type { TimeSeriesState } from "./useTimeSeries";

export interface TimeSeriesSettings {
  tab: TsTab;
  /** The series channel, by label. */
  series: string;
  allowIrregular: boolean;
  corr: TsOptions["corr"];
  stat: TsOptions["stat"];
  decomp: TsOptions["decomp"];
  cp: TsOptions["cp"];
  arima: TsOptions["arima"];
}

/** The slice of the panel the adapter reads and writes. */
export type TimeSeriesPanelHandle = Pick<TimeSeriesState, "columns" | "col" | "setCol" | "tab" | "setTab" | "opts" | "patch">;

export const TIME_SERIES_WORKSHOP = "time-series";
export const TIME_SERIES_SCHEMA = 1;

const values = (options: readonly { value: string }[]): string[] => options.map((o) => o.value);
const label: FieldCheck = (v) => (typeof v === "string" && v.length > 0 && v.length <= 200 ? null : "must be a column label");

type Group = "corr" | "stat" | "decomp" | "cp" | "arima";
const GROUP_OF: Record<TsTab, Group> = { correlogram: "corr", stationarity: "stat", decompose: "decomp", changepoint: "cp", arima: "arima" };
const GROUPS: readonly Group[] = ["corr", "stat", "decomp", "cp", "arima"];

const STRICT: { [G in Group]: { [K in keyof TsOptions[G] & string]: FieldCheck } } = {
  corr: { nlags: checkWhole(0), alpha: checkProbability },
  stat: { tests: checkOneOf(values(STAT_TESTS_OPTIONS)), regression: checkOneOf(values(STAT_REGRESSION_OPTIONS)), alpha: checkProbability },
  decomp: { period: checkWhole(2), model: checkOneOf(values(DECOMP_MODEL_OPTIONS)) },
  cp: {
    method: checkOneOf(values(CP_METHOD_OPTIONS)), cost: checkOneOf(values(CP_COST_OPTIONS)), penalty: checkOneOf(values(CP_PENALTY_OPTIONS)),
    penaltyValue: checkAtLeast(0), minSize: checkWhole(2), maxChanges: checkWhole(0),
  },
  arima: {
    p: checkWhole(0, 5), d: checkWhole(0, 2), q: checkWhole(0, 5), trend: checkOneOf(values(ARIMA_TREND_OPTIONS)), steps: checkWhole(0), alpha: checkProbability,
  },
};

/** A hidden option still has to be the right kind of value (a number, a piece of text); it is not range checked. */
const typeOf = (sample: unknown): FieldCheck => (v) =>
  typeof v === typeof sample && (typeof v !== "number" || Number.isFinite(v)) ? null : `must be a ${typeof sample === "number" ? "number" : "text"}`;
const looseOf = (group: Group): Record<string, FieldCheck> =>
  Object.fromEntries(Object.keys(STRICT[group]).map((k) => [k, typeOf((DEFAULT_TS_OPTIONS[group] as Record<string, unknown>)[k])]));

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The change-point options its method and penalty hide: the penalty value unless the penalty is "value", the cap outside binary segmentation. */
const hiddenCp = (cp: unknown): ("penaltyValue" | "maxChanges")[] => {
  const o = isRec(cp) ? cp : {};
  return [...(o["penalty"] === "value" ? [] : ["penaltyValue" as const]), ...(o["method"] === "binseg" ? [] : ["maxChanges" as const])];
};

function groupCheck(group: Group, tab: unknown): FieldCheck {
  const shown = GROUP_OF[tab as TsTab] === group;
  return (v) => {
    const spec = STRICT[group] as Record<string, FieldCheck>;
    if (!shown) return checkNested(looseOf(group))(v);
    return checkNested(group === "cp" ? looseChecks(spec as never, hiddenCp(v), looseOf("cp") as never) as Record<string, FieldCheck> : spec)(v);
  };
}

function parseSettings(raw: unknown): TimeSeriesSettings | { error: string } {
  const tab = isRec(raw) ? raw["tab"] : undefined;
  return parseFields<TimeSeriesSettings>(raw, {
    tab: checkOneOf(TS_TABS.map((t) => t.id)),
    series: label,
    allowIrregular: checkBoolean,
    corr: groupCheck("corr", tab), stat: groupCheck("stat", tab), decomp: groupCheck("decomp", tab), cp: groupCheck("cp", tab), arima: groupCheck("arima", tab),
  });
}

/** `settings` with every option its tool hides, and which fails its strict check, taken from `fallback` instead. */
function storable(settings: TimeSeriesSettings, fallback: TimeSeriesSettings): TimeSeriesSettings {
  const out: TimeSeriesSettings = { ...settings };
  for (const g of GROUPS) {
    const spec = STRICT[g] as never;
    const keys = Object.keys(STRICT[g]);
    const hidden = (GROUP_OF[settings.tab] !== g ? keys : g === "cp" ? hiddenCp(settings.cp) : []) as never[];
    (out as unknown as Record<string, unknown>)[g] = storeHidden(settings[g] as object, spec, hidden, fallback[g] as object);
  }
  // Binary segmentation's cap is meaningless to PELT, and the run refuses a nonzero one: always 0 there.
  if (out.cp.method === "pelt") out.cp = { ...out.cp, maxChanges: 0 };
  return out;
}

export function settingsFrom(tab: TsTab, series: string, o: TsOptions): TimeSeriesSettings {
  return { tab, series, allowIrregular: o.allowIrregular, corr: { ...o.corr }, stat: { ...o.stat }, decomp: { ...o.decomp }, cp: { ...o.cp }, arima: { ...o.arima } };
}

export function createTimeSeriesAdapter(panel: TimeSeriesPanelHandle): PresetAdapter<TimeSeriesSettings> {
  const seriesLabel = (): string => panel.columns.find((c) => c.index === panel.col)?.label ?? "";
  const current = (): TimeSeriesSettings => settingsFrom(panel.tab, seriesLabel(), panel.opts);
  const adapter: PresetAdapter<TimeSeriesSettings> = {
    workshop: TIME_SERIES_WORKSHOP,
    label: "Time series",
    runLabel: "Run",
    schema: TIME_SERIES_SCHEMA,
    columnFields: ["series"],
    fieldNames: { series: "Series" },
    defaults: () => settingsFrom("correlogram", "series", tsDefaultOptions()),
    parse: parseSettings,
    capture: () => storable(current(), settingsFrom("correlogram", "", tsDefaultOptions())),
    apply(raw): ApplyOutcome {
      const s = storable(raw, current()); // an option the tool hides is not written into the panel when it is refused
      const plan = planColumnFields(adapter, s, panel.columns.map((c) => c.label));
      if ("refuse" in plan) return { ok: false, reason: plan.refuse };
      const skipped = [...plan.skipped];
      const same = panel.columns.filter((c) => c.label === s.series);
      if (same.length === 1) panel.setCol(same[0]!.index);
      else if (same.length > 1) skipped.push({ field: "series", reason: `column '${s.series}' appears more than once on this sheet, so it is not guessed` });
      panel.setTab(s.tab);
      panel.patch("allowIrregular", s.allowIrregular);
      panel.patch("corr", s.corr);
      panel.patch("stat", s.stat);
      panel.patch("decomp", s.decomp);
      panel.patch("cp", s.cp);
      panel.patch("arima", s.arima);
      return { ok: true, applied: Object.keys(s).filter((k) => !skipped.some((x) => x.field === k)), skipped, notes: [] };
    },
    describe: (s) => {
      const name = TS_TABS.find((t) => t.id === s.tab)?.label ?? s.tab;
      const part = s.tab === "arima" ? `(${s.arima.p}, ${s.arima.d}, ${s.arima.q}), ${s.arima.steps} steps`
        : s.tab === "decompose" ? `period ${s.decomp.period}, ${s.decomp.model}`
          : s.tab === "changepoint" ? `${s.cp.method}, ${s.cp.cost}, ${s.cp.penalty}`
            : s.tab === "stationarity" ? `${s.stat.tests}, ${s.stat.regression}`
              : `lags ${s.corr.nlags || "auto"}`;
      return `${name}: ${part}`;
    },
  };
  return adapter;
}

/** After a successful run: remember the settings as last used (only if they would read back). */
export function recordTimeSeriesRun(tab: TsTab, series: string, opts: TsOptions): void {
  const settings = settingsFrom(tab, series, opts);
  if ("error" in parseSettings(settings)) return;
  recordLastUsed({ workshop: TIME_SERIES_WORKSHOP, schema: TIME_SERIES_SCHEMA }, settings);
}
