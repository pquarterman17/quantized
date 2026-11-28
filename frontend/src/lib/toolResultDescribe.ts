// Result book descriptions for the Time series, DOE and Profiler result kinds
// (lib/toolResultKinds.ts; owner decision 2026-11-25). The labels live here,
// not in the shared registries, so the method and settings text stays in this
// module. Each describer returns null when the saved recipe does not parse: no
// book, the other tabs still show the result (fail closed).

import type { AnalysisResult } from "./analysisResult";
import type { Described, ResultBookSetting } from "./resultBookDescribe";
import {
  CLUSTER_RESULT, DOE_DESIGN_RESULT, DOE_EFFECTS_RESULT, PROFILER_RESULT, TIME_SERIES_RESULT, clusterRecipe, doeDesignRecipe, doeEffectsRecipe,
  profilerRecipe, timeSeriesRecipe, type TimeSeriesTool,
} from "./toolResultKinds";

const TOOL: Readonly<Record<TimeSeriesTool, string>> = {
  correlogram: "ACF / PACF", stationarity: "stationarity (ADF, KPSS)", decompose: "classical decomposition",
  changepoint: "change points", arima: "ARIMA",
};

/** Option keys as the workshop's form names them. */
const OPTION_LABEL: Readonly<Record<string, string>> = {
  nlags: "Lags", alpha: "Alpha", tests: "Tests", regression: "Regression", period: "Period", model: "Model",
  method: "Method", cost: "Cost", penalty: "Penalty", penaltyValue: "Penalty value", minSize: "Minimum segment",
  maxChanges: "Maximum changes", p: "p", d: "d", q: "q", trend: "Trend", steps: "Forecast steps",
};

const shown = (v: unknown): string | null =>
  typeof v === "string" && v ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "boolean" ? (v ? "yes" : "no") : null;

function settingsOf(entries: readonly [string, unknown][]): ResultBookSetting[] {
  return entries.flatMap(([label, value]) => {
    const text = shown(value);
    return text === null ? [] : [{ label, value: text }];
  });
}

function describeTimeSeries(result: AnalysisResult): Described | null {
  const r = timeSeriesRecipe(result);
  if (!r) return null;
  const options = Object.entries(r.options).map(([key, value]): [string, unknown] =>
    [OPTION_LABEL[key] ?? key, key === "nlags" && value === 0 ? "automatic" : key === "maxChanges" && value === 0 ? "no limit" : value]);
  return {
    method: `Time series: ${TOOL[r.tool]}`,
    inputKeys: { xKey: null, yKeys: [r.col] },
    settings: settingsOf([["Series", result.scalarValues?.["Channel"]], ...options, ["Allow uneven spacing", r.allowIrregular]]),
  };
}

function describeDesign(result: AnalysisResult): Described | null {
  const r = doeDesignRecipe(result);
  if (!r) return null;
  const s = r.setup;
  return {
    method: `Design of experiments: ${shown(result.scalarValues?.["Design"]) ?? "generated design"}`,
    inputKeys: null, inputNote: `the generated design worksheet (${r.designColumns.length} design columns; the response is not part of it)`,
    settings: settingsOf([
      ["Factors", Array.isArray(s.factors) ? s.factors.length : null], ["Response", s.responseName],
      ["Run order", s.randomize === true ? "randomized" : s.randomize === false ? "standard" : null], ["Seed", s.seed],
      ["Runs", result.scalarValues?.["Runs"]],
    ]),
  };
}

function describeEffects(result: AnalysisResult): Described | null {
  const r = doeEffectsRecipe(result);
  if (!r) return null;
  return {
    method: "Design of experiments: two-level effects (Lenth)",
    inputKeys: null, inputNote: "the design worksheet's coded factor columns and its response",
    settings: settingsOf([["Response", r.responseLabel], ["Model terms", r.terms.length], ["Design", result.scalarValues?.["Design"]]]),
  };
}

function describeProfiler(result: AnalysisResult): Described | null {
  const r = profilerRecipe(result);
  if (!r) return null;
  const goal = r.goal ? `${r.goal.goal} (${r.goal.lower} to ${r.goal.upper}${r.goal.target !== null ? `, target ${r.goal.target}` : ""})` : null;
  return {
    method: "Prediction profiler",
    inputKeys: null, inputNote: `the saved Fit Model result “${shown(result.scalarValues?.["Fit Model result"]) ?? r.fitResultId}”`,
    settings: settingsOf([
      ["Response", result.scalarValues?.["Response"]], ["Confidence", `${Math.round((1 - r.alpha) * 1000) / 10}%`],
      ...Object.entries(r.settings).map(([name, v]): [string, unknown] => [name, v === null ? "averaged over levels" : v]),
      ["Desirability", goal],
    ]),
  };
}

/** Clustering: the settings the envelope recorded (lib/clusterAnalysisResult.ts), in the order the tab shows them. */
const CLUSTER_SETTINGS = ["Linkage", "Distance", "Clusters", "Cut distance", "Scaling", "Start", "Seed", "Restarts", "Maximum iterations"];

function describeCluster(result: AnalysisResult): Described | null {
  const r = clusterRecipe(result);
  if (!r) return null;
  const s = result.scalarValues ?? {};
  return {
    method: `Clustering: ${shown(s["Method"]) ?? r.tool}`,
    inputKeys: { xKey: null, yKeys: r.columns.filter((c) => c >= 0), noX: true },
    settings: settingsOf(CLUSTER_SETTINGS.map((label): [string, unknown] => [label, s[label]])),
  };
}

export const TOOL_RESULT_DESCRIBERS: Readonly<Record<string, (result: AnalysisResult) => Described | null>> = {
  [TIME_SERIES_RESULT]: describeTimeSeries,
  [DOE_DESIGN_RESULT]: describeDesign,
  [DOE_EFFECTS_RESULT]: describeEffects,
  [PROFILER_RESULT]: describeProfiler,
  [CLUSTER_RESULT]: describeCluster,
};
