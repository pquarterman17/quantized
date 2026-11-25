// Time series workshop: a result as drawn figures and as the worksheet that is
// committed (result-lifecycle contract). Pure.

import type { PlotPayload } from "../../../lib/plotdata";
import type { DataStruct, RefLine } from "../../../lib/types";
import type { TsResult } from "./timeSeriesRun";

export interface TsFigure { key: string; title: string; payload: PlotPayload; refLines?: RefLine[] }

const nul = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const nan = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : Number.NaN);
const ZERO: RefLine[] = [{ id: "zero", axis: "y", value: 0 }];

type Spec = PlotPayload["series"][number];
const pts = (label: string): Spec => ({ label, unit: "", kind: "points" });
const line = (label: string, overlay = true): Spec => ({ label, unit: "", kind: "line", overlay });

function figure(key: string, title: string, xLabel: string, xs: number[], cols: [Spec, (number | null)[]][], refLines?: RefLine[]): TsFigure {
  return {
    key, title, ...(refLines ? { refLines } : {}),
    payload: { data: [xs, ...cols.map(([, c]) => c)] as PlotPayload["data"], series: cols.map(([s]) => s), xLabel, xUnit: "" },
  };
}

/** The x values of `n` samples: the worksheet X, extended past its end for `extra` forecast steps. */
export function extendedX(x: readonly number[], dt: number, extra: number): number[] {
  const last = x[x.length - 1] ?? 0;
  return [...x, ...Array.from({ length: extra }, (_, i) => last + (i + 1) * dt)];
}

export function tsFigures(r: TsResult, x: readonly number[], y: readonly number[], yLabel: string, xName = "x"): TsFigure[] {
  switch (r.tab) {
    case "stationarity":
      return [];
    case "correlogram": {
      const d = r.data;
      const lags = d.lags.slice(1);
      const wn = d.pacf_band;
      return [
        figure("acf", "Autocorrelation (ACF), Bartlett band", "lag (samples)", lags, [
          [pts("ACF"), d.acf.slice(1).map(nul)],
          [line("+band"), d.acf_bartlett_band.slice(1).map(nul)],
          [line("-band"), d.acf_bartlett_band.slice(1).map((b) => (b === null ? null : -b))],
        ], ZERO),
        figure("pacf", "Partial autocorrelation (PACF), white-noise band", "lag (samples)", lags, [
          [pts("PACF"), d.pacf.slice(1).map(nul)],
          [line("+band"), lags.map(() => wn)],
          [line("-band"), lags.map(() => -wn)],
        ], ZERO),
      ];
    }
    case "decompose": {
      const d = r.data;
      const xs = [...x];
      return [
        figure("trend", "Observed and trend", xName, xs, [[line(yLabel, false), [...y]], [line("trend"), d.trend.map(nul)]]),
        figure("seasonal", `Seasonal (period ${d.period}, ${d.model})`, xName, xs, [[line("seasonal", false), d.seasonal.map(nul)]]),
        figure("resid", "Remainder", xName, xs, [[pts("remainder"), d.residual.map(nul)]], [{ id: "one", axis: "y", value: d.model === "additive" ? 0 : 1 }]),
      ];
    }
    case "changepoint": {
      const d = r.data;
      const mean = new Array<number | null>(x.length).fill(null);
      for (const s of d.segments) for (let i = s.start; i <= s.end; i++) mean[i] = s.mean;
      const marks: RefLine[] = d.changepoints.map((c) => ({ id: `cp${c}`, axis: "x", value: x[c] - d.dt / 2 }));
      return [figure("cp", `${d.changepoints.length} change point${d.changepoints.length === 1 ? "" : "s"}`, xName, [...x], [
        [line(yLabel, false), [...y]], [line("segment mean"), mean],
      ], marks)];
    }
    case "arima": {
      const d = r.data;
      const f = d.forecast;
      const k = f?.mean.length ?? 0;
      const pad = (v: readonly (number | null)[]) => [...v.map(nul), ...new Array<null>(k).fill(null)];
      const tail = (v: readonly number[] | undefined) => [...new Array<null>(x.length).fill(null), ...(v ?? []).map(nul)];
      return [figure("arima", `ARIMA(${d.order.join(",")}) fit and forecast`, xName, extendedX(x, d.dt, k), [
        [line(yLabel, false), pad(y)], [line("fitted"), pad(d.fitted)],
        ...(f ? [[line("forecast"), tail(f.mean)], [line("lower"), tail(f.lower)], [line("upper"), tail(f.upper)]] as [Spec, (number | null)[]][] : []),
      ])];
    }
  }
}

function struct(time: number[], cols: [string, number[]][], xName: string, meta: Record<string, unknown>): DataStruct {
  return {
    time, values: time.map((_, i) => cols.map(([, c]) => c[i])),
    labels: cols.map(([n]) => n), units: cols.map(() => ""),
    metadata: { x_column_name: xName, technique: "time-series", ...meta },
  };
}

/** The worksheet a result commits as; its X is the source worksheet's. */
export function tsOutput(r: TsResult, x: readonly number[], y: readonly number[], yLabel: string, xName: string): { name: string; data: DataStruct } {
  switch (r.tab) {
    case "correlogram": {
      const d = r.data;
      return { name: `ACF/PACF of ${yLabel}`, data: struct(d.lags, [
        ["ACF", d.acf], ["ACF band (Bartlett)", d.acf_bartlett_band.map(nan)],
        ["PACF", d.pacf], ["PACF band", d.lags.map(() => d.pacf_band)],
      ], "lag", { timeSeries: { tool: "correlogram", n: d.n, alpha: d.alpha, ljungBox: d.ljung_box } }) };
    }
    case "stationarity": {
      const rows = [r.data.adf, r.data.kpss].filter((t): t is NonNullable<typeof t> => !!t);
      const crit = (k: string) => rows.map((t) => t.critical_values[k] ?? Number.NaN);
      return { name: `Stationarity of ${yLabel}`, data: struct(rows.map((t) => (t.test === "adf" ? 1 : 2)), [
        ["statistic", rows.map((t) => t.statistic)], ["p-value", rows.map((t) => t.p_value)], ["lags", rows.map((t) => t.lags)],
        ["crit 10%", crit("10%")], ["crit 5%", crit("5%")], ["crit 1%", crit("1%")],
      ], "test (1 = ADF, 2 = KPSS)", { timeSeries: { tool: "stationarity", verdict: r.data.verdict, alpha: r.data.alpha, pBound: rows.map((t) => t.p_bound) } }) };
    }
    case "decompose": {
      const d = r.data;
      return { name: `Decomposition of ${yLabel}`, data: struct([...x], [
        [yLabel, [...y]], ["trend", d.trend.map(nan)], ["seasonal", d.seasonal.map(nan)], ["remainder", d.residual.map(nan)],
      ], xName, { timeSeries: { tool: "decompose", period: d.period, model: d.model, seasonalStrength: d.seasonal_strength } }) };
    }
    case "changepoint": {
      const d = r.data;
      const mean = new Array<number>(x.length).fill(Number.NaN);
      const seg = new Array<number>(x.length).fill(Number.NaN);
      d.segments.forEach((s, k) => { for (let i = s.start; i <= s.end; i++) { mean[i] = s.mean; seg[i] = k + 1; } });
      return { name: `Change points of ${yLabel}`, data: struct([...x], [[yLabel, [...y]], ["segment mean", mean], ["segment", seg]], xName, {
        timeSeries: { tool: "changepoint", method: d.method, cost: d.cost, penalty: d.penalty, penaltyUsed: d.penalty_used, changepoints: d.changepoints, minSize: d.min_size },
      }) };
    }
    case "arima": {
      const d = r.data;
      const k = d.forecast?.mean.length ?? 0;
      const head = (v: readonly (number | null)[]) => [...v.map(nan), ...new Array<number>(k).fill(Number.NaN)];
      const tail = (v: readonly number[] | undefined) => [...new Array<number>(x.length).fill(Number.NaN), ...(v ?? [])];
      return { name: `ARIMA(${d.order.join(",")}) of ${yLabel}`, data: struct(extendedX(x, d.dt, k), [
        [yLabel, head(y)], ["fitted", head(d.fitted)], ["forecast", tail(d.forecast?.mean)], ["lower", tail(d.forecast?.lower)], ["upper", tail(d.forecast?.upper)],
      ], xName, { timeSeries: { tool: "arima", order: d.order, aic: d.aic, bic: d.bic, loglik: d.loglik, params: d.params } }) };
    }
  }
}
