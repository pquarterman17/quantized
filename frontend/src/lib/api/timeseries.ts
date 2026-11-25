// /api/timeseries/* wrappers (GAP_AUDIT_9 G13). NOT re-exported by lib/api.ts:
// the only consumer is the lazy Time series workshop, which imports this path
// directly (keeps the eager bundle unchanged).

import { postJSON } from "./http";

interface SeriesBody { y: number[]; x?: number[]; allow_irregular?: boolean }
interface Meta { dt: number; irregular: boolean }

export interface LjungBoxRow { lag: number; q: number; df: number; p: number | null }
export interface CorrelogramResult extends Meta {
  n: number; alpha: number; lags: number[]; acf: number[]; pacf: number[];
  white_noise_band: number; acf_bartlett_band: (number | null)[]; pacf_band: number; ljung_box: LjungBoxRow[];
}
export interface StationarityTest {
  test: "adf" | "kpss"; regression: string; statistic: number; p_value: number;
  /** "greater" / "less": the true p lies beyond the tabulated range. */
  p_bound: "greater" | "less" | "interpolated"; lags: number; n: number;
  critical_values: Record<string, number>; null: string;
}
export interface StationarityResult extends Meta { alpha: number; adf?: StationarityTest; kpss?: StationarityTest; verdict: string }
export interface DecomposeResult extends Meta {
  model: "additive" | "multiplicative"; period: number; n: number;
  trend: (number | null)[]; seasonal: number[]; residual: (number | null)[];
  seasonal_figure: number[]; seasonal_strength: number | null;
}
export interface ChangeSegment { start: number; end: number; n: number; mean: number; sd: number | null }
export interface ChangepointResult extends Meta {
  method: string; cost: string; penalty: string; penalty_used: number; sigma2: number | null;
  min_size: number; n: number; changepoints: number[]; segments: ChangeSegment[]; objective: number;
}
export interface ArimaParam { name: string; estimate: number; se: number; p: number }
export interface ArimaResult extends Meta {
  order: [number, number, number]; trend: string; n: number; params: ArimaParam[]; sigma2: number;
  loglik: number; aic: number; bic: number; alpha: number; fitted: (number | null)[]; residual: (number | null)[];
  notes: string[]; forecast?: { mean: number[]; lower: number[]; upper: number[] };
}

export const tsCorrelogram = (body: SeriesBody & { nlags?: number; alpha?: number }): Promise<CorrelogramResult> =>
  postJSON("/api/timeseries/correlogram", body);
export const tsStationarity = (body: SeriesBody & { tests?: string; regression?: string; alpha?: number }): Promise<StationarityResult> =>
  postJSON("/api/timeseries/stationarity", body);
export const tsDecompose = (body: SeriesBody & { period: number; model: string }): Promise<DecomposeResult> =>
  postJSON("/api/timeseries/decompose", body);
export const tsChangepoint = (body: SeriesBody & {
  method?: string; cost?: string; penalty?: string; penalty_value?: number; min_size?: number; max_changes?: number;
}): Promise<ChangepointResult> => postJSON("/api/timeseries/changepoint", body);
export const tsArima = (body: SeriesBody & {
  p: number; d: number; q: number; trend?: string; steps?: number; alpha?: number;
}): Promise<ArimaResult> => postJSON("/api/timeseries/arima", body);
