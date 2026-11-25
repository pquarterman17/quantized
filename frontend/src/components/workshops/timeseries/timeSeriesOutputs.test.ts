import { describe, expect, it } from "vitest";

import type { ArimaResult, ChangepointResult, CorrelogramResult, DecomposeResult, StationarityResult } from "../../../lib/api/timeseries";
import { extendedX, tsFigures, tsOutput } from "./timeSeriesOutputs";

const x = [0, 2, 4, 6, 8, 10];
const y = [1, 2, 3, 4, 5, 6];
const meta = { dt: 2, irregular: false };

describe("extendedX", () => {
  it("continues the axis by the sampling step", () => expect(extendedX(x, 2, 2)).toEqual([...x, 12, 14]));
});

describe("figures", () => {
  it("ACF/PACF drop lag 0 and carry both bands", () => {
    const d: CorrelogramResult = { ...meta, n: 6, alpha: 0.05, lags: [0, 1, 2], acf: [1, 0.5, -0.2], pacf: [1, 0.5, 0.1],
      white_noise_band: 0.8, acf_bartlett_band: [null, 0.8, 0.9], pacf_band: 0.8, ljung_box: [] };
    const [acf, pacf] = tsFigures({ tab: "correlogram", data: d }, x, y, "p");
    expect(acf.payload.data).toEqual([[1, 2], [0.5, -0.2], [0.8, 0.9], [-0.8, -0.9]]);
    expect(pacf.payload.data[2]).toEqual([0.8, 0.8]);
    expect(acf.refLines?.[0]).toMatchObject({ axis: "y", value: 0 });
  });
  it("stationarity draws nothing", () => {
    expect(tsFigures({ tab: "stationarity", data: { ...meta, alpha: 0.05, verdict: "v" } as StationarityResult }, x, y, "p")).toEqual([]);
  });
  it("change points fill the segment mean and mark the boundary between samples", () => {
    const d: ChangepointResult = { ...meta, method: "pelt", cost: "mean", penalty: "mbic", penalty_used: 1, sigma2: 1, min_size: 2, n: 6,
      changepoints: [3], objective: 0, segments: [{ start: 0, end: 2, n: 3, mean: 2, sd: 1 }, { start: 3, end: 5, n: 3, mean: 5, sd: 1 }] };
    const [f] = tsFigures({ tab: "changepoint", data: d }, x, y, "p");
    expect(f.payload.data[2]).toEqual([2, 2, 2, 5, 5, 5]);
    expect(f.refLines).toEqual([{ id: "cp3", axis: "x", value: 5 }]);
  });
  it("ARIMA pads observed/fitted over the forecast and the forecast over the data", () => {
    const d: ArimaResult = { ...meta, order: [1, 0, 0], trend: "c", n: 6, params: [], sigma2: 1, loglik: 0, aic: 0, bic: 0, alpha: 0.05,
      fitted: [null, 1, 2, 3, 4, 5], residual: [], notes: [], forecast: { mean: [7, 8], lower: [6, 6], upper: [8, 9] } };
    const [f] = tsFigures({ tab: "arima", data: d }, x, y, "p");
    expect(f.payload.data[0]).toEqual([...x, 12, 14]);
    expect(f.payload.data[1]).toEqual([...y, null, null]);
    expect(f.payload.data[2]).toEqual([null, 1, 2, 3, 4, 5, null, null]);
    expect(f.payload.data[3]).toEqual([null, null, null, null, null, null, 7, 8]);
  });
  it("decomposition has observed, seasonal and remainder panels with the right reference", () => {
    const d: DecomposeResult = { ...meta, model: "multiplicative", period: 2, n: 6, trend: [null, 1, 1, 1, 1, null], seasonal: [1, 1, 1, 1, 1, 1],
      residual: [null, 1, 1, 1, 1, null], seasonal_figure: [1, 1], seasonal_strength: 0.5 };
    const figs = tsFigures({ tab: "decompose", data: d }, x, y, "p");
    expect(figs.map((f) => f.key)).toEqual(["trend", "seasonal", "resid"]);
    expect(figs[2].refLines?.[0].value).toBe(1);
  });
});

describe("committed worksheets", () => {
  it("decomposition keeps the source X, writes NaN for the undefined ends", () => {
    const d: DecomposeResult = { ...meta, model: "additive", period: 2, n: 6, trend: [null, 1, 1, 1, 1, null], seasonal: [0, 0, 0, 0, 0, 0],
      residual: [null, 0, 0, 0, 0, null], seasonal_figure: [0, 0], seasonal_strength: 1 };
    const { name, data } = tsOutput({ tab: "decompose", data: d }, x, y, "pressure", "t");
    expect(name).toBe("Decomposition of pressure");
    expect(data.time).toEqual(x);
    expect(data.labels).toEqual(["pressure", "trend", "seasonal", "remainder"]);
    expect(Number.isNaN(data.values[0][1])).toBe(true);
    expect(data.metadata["x_column_name"]).toBe("t");
  });
  it("ARIMA extends X and leaves forecast columns NaN over the data", () => {
    const d: ArimaResult = { ...meta, order: [1, 0, 0], trend: "c", n: 6, params: [], sigma2: 1, loglik: 0, aic: 3, bic: 4, alpha: 0.05,
      fitted: [null, 1, 2, 3, 4, 5], residual: [], notes: [], forecast: { mean: [7], lower: [6], upper: [8] } };
    const { data } = tsOutput({ tab: "arima", data: d }, x, y, "p", "t");
    expect(data.time).toEqual([...x, 12]);
    expect(data.values[6]).toSatisfy((r: number[]) => Number.isNaN(r[0]) && r[2] === 7 && r[3] === 6 && r[4] === 8);
    expect(Number.isNaN(data.values[0][2])).toBe(true);
  });
  it("correlogram and stationarity worksheets are indexed by lag / test", () => {
    const c: CorrelogramResult = { ...meta, n: 6, alpha: 0.05, lags: [0, 1], acf: [1, 0.5], pacf: [1, 0.5], white_noise_band: 0.8,
      acf_bartlett_band: [null, 0.8], pacf_band: 0.8, ljung_box: [] };
    const a = tsOutput({ tab: "correlogram", data: c }, x, y, "p", "t").data;
    expect(a.time).toEqual([0, 1]);
    expect(Number.isNaN(a.values[0][1])).toBe(true);
    const test = (t: "adf" | "kpss") => ({ test: t, regression: "c", statistic: 1, p_value: 0.1, p_bound: "interpolated" as const, lags: 2, n: 6, critical_values: { "10%": 1, "5%": 2, "1%": 3 }, null: "n" });
    const s = tsOutput({ tab: "stationarity", data: { ...meta, alpha: 0.05, verdict: "v", adf: test("adf"), kpss: test("kpss") } }, x, y, "p", "t").data;
    expect(s.time).toEqual([1, 2]);
    expect(s.labels).toContain("p-value");
  });
  it("change-point worksheet numbers the segments", () => {
    const d: ChangepointResult = { ...meta, method: "pelt", cost: "mean", penalty: "mbic", penalty_used: 1, sigma2: 1, min_size: 2, n: 6, changepoints: [3], objective: 0,
      segments: [{ start: 0, end: 2, n: 3, mean: 2, sd: 1 }, { start: 3, end: 5, n: 3, mean: 5, sd: 1 }] };
    const { data } = tsOutput({ tab: "changepoint", data: d }, x, y, "p", "t");
    expect(data.values.map((r) => r[2])).toEqual([1, 1, 1, 2, 2, 2]);
  });
});
