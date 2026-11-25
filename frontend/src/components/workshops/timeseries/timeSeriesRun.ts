// Time series workshop (GAP_AUDIT_9 G13): the option model, the checks that
// fail closed before a request is sent, and the dispatch to the five backend
// tools (routes/timeseries.py). Pure apart from the API call.

import {
  tsArima, tsChangepoint, tsCorrelogram, tsDecompose, tsStationarity,
  type ArimaResult, type ChangepointResult, type CorrelogramResult, type DecomposeResult, type StationarityResult,
} from "../../../lib/api/timeseries";
import { defaultAlpha } from "../../../lib/locale";

export type TsTab = "correlogram" | "stationarity" | "decompose" | "changepoint" | "arima";

export const TS_TABS: readonly { id: TsTab; label: string }[] = [
  { id: "correlogram", label: "ACF / PACF" },
  { id: "stationarity", label: "Stationarity" },
  { id: "decompose", label: "Decompose" },
  { id: "changepoint", label: "Change points" },
  { id: "arima", label: "ARIMA" },
];

export interface TsOptions {
  allowIrregular: boolean;
  corr: { nlags: number; alpha: number };
  stat: { tests: "both" | "adf" | "kpss"; regression: "c" | "ct"; alpha: number };
  decomp: { period: number; model: "additive" | "multiplicative" };
  cp: {
    method: "pelt" | "binseg"; cost: "mean" | "var" | "meanvar"; penalty: "mbic" | "bic" | "aic" | "value";
    penaltyValue: number; minSize: number; maxChanges: number;
  };
  arima: { p: number; d: number; q: number; trend: "auto" | "n" | "c"; steps: number; alpha: number };
}

/** nlags 0 = automatic; maxChanges 0 = no limit (binary segmentation). */
export const DEFAULT_TS_OPTIONS: TsOptions = {
  allowIrregular: false,
  corr: { nlags: 0, alpha: 0.05 },
  stat: { tests: "both", regression: "c", alpha: 0.05 },
  decomp: { period: 12, model: "additive" },
  cp: { method: "pelt", cost: "mean", penalty: "mbic", penaltyValue: 10, minSize: 2, maxChanges: 0 },
  arima: { p: 1, d: 0, q: 0, trend: "auto", steps: 10, alpha: 0.05 },
};

/** The workshop's starting options: DEFAULT_TS_OPTIONS with alpha from Preferences ▸ Numbers (0.05 unless set). */
export function tsDefaultOptions(): TsOptions {
  const alpha = defaultAlpha();
  return { ...DEFAULT_TS_OPTIONS, corr: { ...DEFAULT_TS_OPTIONS.corr, alpha }, stat: { ...DEFAULT_TS_OPTIONS.stat, alpha }, arima: { ...DEFAULT_TS_OPTIONS.arima, alpha } };
}

export type TsResult =
  | { tab: "correlogram"; data: CorrelogramResult }
  | { tab: "stationarity"; data: StationarityResult }
  | { tab: "decompose"; data: DecomposeResult }
  | { tab: "changepoint"; data: ChangepointResult }
  | { tab: "arima"; data: ArimaResult };

const isInt = (v: number, lo: number, hi: number): boolean => Number.isInteger(v) && v >= lo && v <= hi;
const isProb = (v: number): boolean => Number.isFinite(v) && v > 0 && v < 1;

/** A reason the run cannot start (shown beside the Run button), or null. */
export function tsProblem(tab: TsTab, y: readonly number[], o: TsOptions): string | null {
  const bad = y.reduce((n, v) => n + (Number.isFinite(v) ? 0 : 1), 0);
  if (bad) return `${bad} row${bad === 1 ? " is" : "s are"} blank or non-finite: time-series methods need a gap-free series, so clean or interpolate them first.`;
  if (y.length < 20) return `The series has ${y.length} points; at least 20 are needed.`;
  switch (tab) {
    case "correlogram":
      if (o.corr.nlags !== 0 && !isInt(o.corr.nlags, 1, Math.floor(y.length / 2) - 1)) return `Lags must be 0 (automatic) or 1 to ${Math.floor(y.length / 2) - 1}.`;
      return isProb(o.corr.alpha) ? null : "Alpha must be between 0 and 1.";
    case "stationarity":
      return isProb(o.stat.alpha) ? null : "Alpha must be between 0 and 1.";
    case "decompose":
      if (!isInt(o.decomp.period, 2, Math.floor(y.length / 2))) return `The period must be a whole number of samples from 2 to ${Math.floor(y.length / 2)} (two full cycles are needed).`;
      return o.decomp.model === "multiplicative" && y.some((v) => v <= 0) ? "A multiplicative model needs strictly positive values; use additive." : null;
    case "changepoint":
      if (!isInt(o.cp.minSize, 2, Math.floor(y.length / 2))) return "The minimum segment length must be a whole number of at least 2 samples.";
      if (o.cp.penalty === "value" && !(Number.isFinite(o.cp.penaltyValue) && o.cp.penaltyValue >= 0)) return "The penalty must be zero or more.";
      if (o.cp.method === "pelt" && o.cp.maxChanges !== 0) return "A maximum number of changes applies to binary segmentation only.";
      return o.cp.maxChanges !== 0 && !isInt(o.cp.maxChanges, 1, y.length) ? "The maximum number of changes must be 0 (no limit) or a positive whole number." : null;
    case "arima": {
      const a = o.arima;
      if (!isInt(a.p, 0, 5) || !isInt(a.q, 0, 5) || !isInt(a.d, 0, 2)) return "ARIMA orders must be whole numbers: p and q from 0 to 5, d from 0 to 2.";
      if (a.trend === "c" && a.d > 0) return "A constant is only available with d = 0.";
      if (!isInt(a.steps, 0, y.length)) return "The forecast horizon must be a whole number from 0 to the series length.";
      return isProb(a.alpha) ? null : "Alpha must be between 0 and 1.";
    }
  }
}

/** Everything the answer depends on: a changed setting or series makes a shown result stale. */
export function tsRunKey(tab: TsTab, fingerprint: string, col: number, o: TsOptions): string {
  const part = tab === "correlogram" ? o.corr : tab === "stationarity" ? o.stat : tab === "decompose" ? o.decomp : tab === "changepoint" ? o.cp : o.arima;
  return JSON.stringify([tab, fingerprint, col, o.allowIrregular, part]);
}

export async function runTimeSeries(tab: TsTab, y: number[], x: number[], o: TsOptions): Promise<TsResult> {
  const base = { y, x, allow_irregular: o.allowIrregular };
  switch (tab) {
    case "correlogram":
      return { tab, data: await tsCorrelogram({ ...base, alpha: o.corr.alpha, ...(o.corr.nlags ? { nlags: o.corr.nlags } : {}) }) };
    case "stationarity":
      return { tab, data: await tsStationarity({ ...base, tests: o.stat.tests, regression: o.stat.regression, alpha: o.stat.alpha }) };
    case "decompose":
      return { tab, data: await tsDecompose({ ...base, period: o.decomp.period, model: o.decomp.model }) };
    case "changepoint":
      return { tab, data: await tsChangepoint({
        ...base, method: o.cp.method, cost: o.cp.cost, penalty: o.cp.penalty, min_size: o.cp.minSize,
        ...(o.cp.penalty === "value" ? { penalty_value: o.cp.penaltyValue } : {}),
        ...(o.cp.maxChanges ? { max_changes: o.cp.maxChanges } : {}),
      }) };
    case "arima":
      return { tab, data: await tsArima({ ...base, p: o.arima.p, d: o.arima.d, q: o.arima.q, trend: o.arima.trend, steps: o.arima.steps, alpha: o.arima.alpha }) };
  }
}
