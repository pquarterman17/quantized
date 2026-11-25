// Time series (GAP_AUDIT_9 G13) as a saved snapshot result (owner decision
// 2026-11-25): one result per Run of one tool, on one channel of the source's
// analysis view. The tables a result saves (the in-tool book copies the same
// ones) and the envelope: source, analysis-view fingerprint, recorded inputs
// (channel, included rows, X range), the tool's options and the algorithm
// version. "Add as worksheet" is unchanged and stays a separate committed
// output. Pure; imported by the lazy Time series workshop only.

import type { ArimaResult, ChangepointResult, CorrelogramResult, DecomposeResult, StationarityResult } from "./api/timeseries";
import { ANALYSIS_RESULT_VERSION, type AnalysisResult, type AnalysisResultTable } from "./analysisResult";
import { analysisDataFingerprint } from "./analysisResultFreshness";
import { fmtNum } from "./format";
import { INPUTS_PARAM, recordedInputs } from "./resultInputsRecord";
import { TIME_SERIES_RESULT, type TimeSeriesRecipe, type TimeSeriesTool } from "./toolResultKinds";
import type { Dataset } from "./types";
import { boundedTables } from "./variabilityAnalysisResult";

/** One tool's response (the workshop's TsResult has this shape). */
export type TimeSeriesRun =
  | { tab: "correlogram"; data: CorrelogramResult }
  | { tab: "stationarity"; data: StationarityResult }
  | { tab: "decompose"; data: DecomposeResult }
  | { tab: "changepoint"; data: ChangepointResult }
  | { tab: "arima"; data: ArimaResult };

export interface TimeSeriesSnapshot {
  run: TimeSeriesRun;
  x: readonly number[];
  y: readonly number[];
  yLabel: string;
  xName: string;
}

export const TS_TOOL_LABEL: Readonly<Record<TimeSeriesTool, string>> = {
  correlogram: "ACF / PACF", stationarity: "Stationarity (ADF, KPSS)", decompose: "Classical decomposition",
  changepoint: "Change points", arima: "ARIMA",
};

/** Bumped when a tool's method changes (provisional, owner to confirm). */
export const TS_ALGORITHM_VERSION = 1;

/** Table titles, fixed: the book, the saved result, Copy and the figures key on them. */
export const TS_TABLES = {
  correlogram: "Correlogram", ljungBox: "Ljung–Box", tests: "Stationarity tests",
  decomposition: "Decomposition", seasonalFigure: "Seasonal figure", segments: "Segments",
  segmentMeans: "Series and segment means", params: "Parameter estimates", fitStats: "Fit statistics",
  forecast: "Fit and forecast",
} as const;

const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const extendedX = (x: readonly number[], dt: number, extra: number): number[] => {
  const last = x[x.length - 1] ?? 0;
  return [...x, ...Array.from({ length: extra }, (_, i) => last + (i + 1) * dt)];
};

/** The tables a Time series result saves, in saved order. */
export function timeSeriesResultTables(s: TimeSeriesSnapshot): AnalysisResultTable[] {
  const { run, x, y, yLabel, xName } = s;
  switch (run.tab) {
    case "correlogram": {
      const d = run.data;
      return [
        { title: TS_TABLES.correlogram, columns: ["lag", "ACF", "ACF band (Bartlett)", "PACF", "PACF band"],
          rows: d.lags.map((lag, i) => [lag, nul(d.acf[i]), nul(d.acf_bartlett_band[i]), nul(d.pacf[i]), nul(d.pacf_band)]) },
        { title: TS_TABLES.ljungBox, columns: ["lag", "Q", "df", "p"], rows: d.ljung_box.map((b) => [b.lag, nul(b.q), b.df, nul(b.p)]) },
      ];
    }
    case "stationarity": {
      const tests = [run.data.adf, run.data.kpss].filter((t): t is NonNullable<typeof t> => !!t);
      return [{ title: TS_TABLES.tests,
        columns: ["test", "null hypothesis", "regression", "statistic", "p-value", "p bound", "lags", "n", "crit 10%", "crit 5%", "crit 1%"],
        rows: tests.map((t) => [t.test.toUpperCase(), t.null, t.regression, nul(t.statistic), nul(t.p_value), t.p_bound, t.lags, t.n,
          nul(t.critical_values["10%"]), nul(t.critical_values["5%"]), nul(t.critical_values["1%"])]) }];
    }
    case "decompose": {
      const d = run.data;
      return [
        { title: TS_TABLES.decomposition, columns: [xName, yLabel, "trend", "seasonal", "remainder"],
          rows: x.map((xi, i) => [nul(xi), nul(y[i]), nul(d.trend[i]), nul(d.seasonal[i]), nul(d.residual[i])]) },
        { title: TS_TABLES.seasonalFigure, columns: ["phase", "seasonal"], rows: d.seasonal_figure.map((v, i) => [i + 1, nul(v)]) },
      ];
    }
    case "changepoint": {
      const d = run.data;
      const mean = new Array<number | null>(x.length).fill(null);
      for (const seg of d.segments) for (let i = seg.start; i <= seg.end; i++) mean[i] = nul(seg.mean);
      return [
        { title: TS_TABLES.segments, columns: ["segment", "first row", "last row", "n", "mean", "sd"],
          rows: d.segments.map((seg, k) => [k + 1, seg.start + 1, seg.end + 1, seg.n, nul(seg.mean), nul(seg.sd)]) },
        { title: TS_TABLES.segmentMeans, columns: [xName, yLabel, "segment mean"], rows: x.map((xi, i) => [nul(xi), nul(y[i]), mean[i] ?? null]) },
      ];
    }
    case "arima": {
      const d = run.data;
      const k = d.forecast?.mean.length ?? 0;
      const xs = extendedX(x, d.dt, k);
      return [
        { title: TS_TABLES.params, columns: ["term", "estimate", "s.e.", "p"], rows: d.params.map((p) => [p.name, nul(p.estimate), nul(p.se), nul(p.p)]) },
        { title: TS_TABLES.fitStats, columns: ["statistic", "value"], rows: [
          ["AIC", nul(d.aic)], ["BIC", nul(d.bic)], ["log-likelihood", nul(d.loglik)], ["sigma²", nul(d.sigma2)], ["n", d.n],
        ] },
        { title: TS_TABLES.forecast, columns: [xName, yLabel, "fitted", "forecast", "lower", "upper"],
          rows: xs.map((xi, i) => i < x.length
            ? [nul(xi), nul(y[i]), nul(d.fitted[i]), null, null, null]
            : [nul(xi), null, null, nul(d.forecast?.mean[i - x.length]), nul(d.forecast?.lower[i - x.length]), nul(d.forecast?.upper[i - x.length])]) },
      ];
    }
  }
}

function interpretation(run: TimeSeriesRun): string {
  switch (run.tab) {
    case "correlogram": {
      const lb = run.data.ljung_box.at(-1);
      return lb ? `Ljung–Box Q ${fmtNum(lb.q)} at lag ${lb.lag} (p ${fmtNum(lb.p ?? Number.NaN)}).` : "ACF and PACF with confidence bands.";
    }
    case "stationarity": return run.data.verdict;
    case "decompose": return `Period ${run.data.period}, ${run.data.model}; seasonal strength ${fmtNum(run.data.seasonal_strength ?? Number.NaN)}.`;
    case "changepoint": return `${run.data.changepoints.length} change point${run.data.changepoints.length === 1 ? "" : "s"} (${run.data.method}, ${run.data.cost} cost, ${run.data.penalty} penalty).`;
    case "arima": return `ARIMA(${run.data.order.join(",")}): AIC ${fmtNum(run.data.aic)}, BIC ${fmtNum(run.data.bic)}.`;
  }
}

export function timeSeriesAnalysisResult(
  id: string, source: Dataset, recipe: TimeSeriesRecipe, snapshot: TimeSeriesSnapshot, createdAt = new Date().toISOString(),
): AnalysisResult {
  const { run } = snapshot;
  const bounded = boundedTables(timeSeriesResultTables(snapshot));
  const warnings = [
    ...(run.data.irregular ? ["X is unevenly spaced: points were treated as equally spaced, so results are approximate."] : []),
    ...(run.tab === "arima" ? run.data.notes : []),
    ...bounded.warnings,
  ];
  return {
    version: ANALYSIS_RESULT_VERSION, id,
    name: `${TS_TOOL_LABEL[recipe.tool]} of ${snapshot.yLabel} · ${source.name}`,
    producer: { id: TIME_SERIES_RESULT, label: "Time series", version: 1 },
    sources: [{ datasetId: source.id, role: "input" }], outputs: [],
    selection: { datasetId: source.id, channels: [{ index: recipe.col, label: snapshot.yLabel, unit: source.data.units[recipe.col] ?? "" }] },
    sourceFingerprint: analysisDataFingerprint(source),
    scalarValues: {
      Test: TS_TOOL_LABEL[recipe.tool], Interpretation: interpretation(run), Channel: snapshot.yLabel, X: snapshot.xName,
      N: snapshot.y.length, "Sample spacing": nul(run.data.dt),
    },
    parameters: {
      recipe: { tool: recipe.tool, col: recipe.col, allowIrregular: recipe.allowIrregular, options: recipe.options },
      algorithm: { id: `time-series-${recipe.tool}`, version: TS_ALGORITHM_VERSION },
      [INPUTS_PARAM]: recordedInputs([source], { xKey: null, yChannel: recipe.col }),
    },
    tables: bounded.tables, warnings, createdAt,
  };
}
