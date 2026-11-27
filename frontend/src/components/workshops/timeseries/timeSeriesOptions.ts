// The option lists of the Time series workshop, in ONE place: the settings
// forms (TsForms) render their selects from these, and the preset adapter
// validates against the same lists (no second copy).

import type { TsOptions } from "./timeSeriesRun";

type Opts<T extends string> = { value: T; label: string }[];

export const STAT_TESTS_OPTIONS: Opts<TsOptions["stat"]["tests"]> = [
  { value: "both", label: "ADF and KPSS" }, { value: "adf", label: "ADF only" }, { value: "kpss", label: "KPSS only" },
];
export const STAT_REGRESSION_OPTIONS: Opts<TsOptions["stat"]["regression"]> = [
  { value: "c", label: "Constant (level)" }, { value: "ct", label: "Constant + trend" },
];
export const DECOMP_MODEL_OPTIONS: Opts<TsOptions["decomp"]["model"]> = [
  { value: "additive", label: "Additive (T + S + R)" }, { value: "multiplicative", label: "Multiplicative (T x S x R)" },
];
export const CP_METHOD_OPTIONS: Opts<TsOptions["cp"]["method"]> = [
  { value: "pelt", label: "PELT (exact)" }, { value: "binseg", label: "Binary segmentation" },
];
export const CP_COST_OPTIONS: Opts<TsOptions["cp"]["cost"]> = [
  { value: "mean", label: "Mean" }, { value: "var", label: "Variance" }, { value: "meanvar", label: "Mean and variance" },
];
export const CP_PENALTY_OPTIONS: Opts<TsOptions["cp"]["penalty"]> = [
  { value: "mbic", label: "Modified BIC" }, { value: "bic", label: "BIC" }, { value: "aic", label: "AIC" }, { value: "value", label: "Value" },
];
export const ARIMA_TREND_OPTIONS: Opts<TsOptions["arima"]["trend"]> = [
  { value: "auto", label: "Automatic (d = 0 only)" }, { value: "c", label: "Include (d = 0)" }, { value: "n", label: "None" },
];
