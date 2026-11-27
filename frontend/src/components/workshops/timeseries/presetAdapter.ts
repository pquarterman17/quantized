// Time series' preset adapter (plans/PRESET_BAR_CONTRACT.md section 6), generic
// backend. A preset is the tool (ACF / PACF, Stationarity, Decompose, Change
// points, ARIMA), the options of all five (so switching tabs after an Apply
// keeps them), the uneven-spacing switch and the series column BY LABEL.
// Settings only (P5): no dataset id, no row range, no excluded rows. A series
// label that this sheet lacks (or has twice) is skipped and named, and the
// current series stays.
// Lazy: loaded with the preset bar and after a successful run.

import {
  checkBoolean, checkOneOf, parseFields, planColumnFields,
  type ApplyOutcome, type FieldCheck, type PresetAdapter,
} from "../../../lib/presetAdapter";
import { recordLastUsed } from "../../../lib/presetLastUsed";
import { checkAtLeast, checkNested, checkProbability, checkWhole } from "../presets/nestedFields";
import {
  ARIMA_TREND_OPTIONS, CP_COST_OPTIONS, CP_METHOD_OPTIONS, CP_PENALTY_OPTIONS, DECOMP_MODEL_OPTIONS, STAT_REGRESSION_OPTIONS, STAT_TESTS_OPTIONS,
} from "./timeSeriesOptions";
import { TS_TABS, tsDefaultOptions, type TsOptions, type TsTab } from "./timeSeriesRun";
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

const cpRule = (cp: TsOptions["cp"]): string | null =>
  cp.method === "pelt" && cp.maxChanges !== 0 ? "setting 'maxChanges' applies to binary segmentation only (PELT needs 0)" : null;

function parseSettings(raw: unknown): TimeSeriesSettings | { error: string } {
  return parseFields<TimeSeriesSettings>(raw, {
    tab: checkOneOf(TS_TABS.map((t) => t.id)),
    series: label,
    allowIrregular: checkBoolean,
    corr: checkNested<TsOptions["corr"]>({ nlags: checkWhole(0), alpha: checkProbability }),
    stat: checkNested<TsOptions["stat"]>({ tests: checkOneOf(values(STAT_TESTS_OPTIONS)), regression: checkOneOf(values(STAT_REGRESSION_OPTIONS)), alpha: checkProbability }),
    decomp: checkNested<TsOptions["decomp"]>({ period: checkWhole(2), model: checkOneOf(values(DECOMP_MODEL_OPTIONS)) }),
    cp: checkNested<TsOptions["cp"]>({
      method: checkOneOf(values(CP_METHOD_OPTIONS)), cost: checkOneOf(values(CP_COST_OPTIONS)), penalty: checkOneOf(values(CP_PENALTY_OPTIONS)),
      penaltyValue: checkAtLeast(0), minSize: checkWhole(2), maxChanges: checkWhole(0),
    }, cpRule),
    arima: checkNested<TsOptions["arima"]>({
      p: checkWhole(0, 5), d: checkWhole(0, 2), q: checkWhole(0, 5), trend: checkOneOf(values(ARIMA_TREND_OPTIONS)), steps: checkWhole(0), alpha: checkProbability,
    }),
  });
}

export function settingsFrom(tab: TsTab, series: string, o: TsOptions): TimeSeriesSettings {
  return { tab, series, allowIrregular: o.allowIrregular, corr: { ...o.corr }, stat: { ...o.stat }, decomp: { ...o.decomp }, cp: { ...o.cp }, arima: { ...o.arima } };
}

export function createTimeSeriesAdapter(panel: TimeSeriesPanelHandle): PresetAdapter<TimeSeriesSettings> {
  const seriesLabel = (): string => panel.columns.find((c) => c.index === panel.col)?.label ?? "";
  const adapter: PresetAdapter<TimeSeriesSettings> = {
    workshop: TIME_SERIES_WORKSHOP,
    label: "Time series",
    runLabel: "Run",
    schema: TIME_SERIES_SCHEMA,
    columnFields: ["series"],
    fieldNames: { series: "Series" },
    defaults: () => settingsFrom("correlogram", "series", tsDefaultOptions()),
    parse: parseSettings,
    capture: () => settingsFrom(panel.tab, seriesLabel(), panel.opts),
    apply(s): ApplyOutcome {
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
