import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TS_OPTIONS, runTimeSeries, tsProblem, tsRunKey, type TsOptions } from "./timeSeriesRun";

const api = vi.hoisted(() => ({ tsCorrelogram: vi.fn(), tsStationarity: vi.fn(), tsDecompose: vi.fn(), tsChangepoint: vi.fn(), tsArima: vi.fn() }));
vi.mock("../../../lib/api/timeseries", () => api);

const y = (n: number) => Array.from({ length: n }, (_, i) => Math.sin(i) + 2);
const o = (patch: Partial<TsOptions>): TsOptions => ({ ...DEFAULT_TS_OPTIONS, ...patch });

describe("tsProblem (fail closed before a request)", () => {
  it("refuses blank or non-finite rows and short series", () => {
    expect(tsProblem("correlogram", [...y(30), Number.NaN], DEFAULT_TS_OPTIONS)).toMatch(/1 row is blank or non-finite/);
    expect(tsProblem("correlogram", y(10), DEFAULT_TS_OPTIONS)).toMatch(/at least 20/);
    expect(tsProblem("correlogram", y(40), DEFAULT_TS_OPTIONS)).toBeNull();
  });
  it("checks each tool's own settings", () => {
    const s = y(40);
    expect(tsProblem("correlogram", s, o({ corr: { nlags: 25, alpha: 0.05 } }))).toMatch(/1 to 19/);
    expect(tsProblem("correlogram", s, o({ corr: { nlags: 0, alpha: 1 } }))).toMatch(/Alpha/);
    expect(tsProblem("decompose", s, o({ decomp: { period: 30, model: "additive" } }))).toMatch(/two full cycles/);
    expect(tsProblem("decompose", [...s.slice(1), -1], o({ decomp: { period: 4, model: "multiplicative" } }))).toMatch(/strictly positive/);
    expect(tsProblem("changepoint", s, o({ cp: { ...DEFAULT_TS_OPTIONS.cp, maxChanges: 2 } }))).toMatch(/binary segmentation only/);
    expect(tsProblem("changepoint", s, o({ cp: { ...DEFAULT_TS_OPTIONS.cp, method: "binseg", maxChanges: 2 } }))).toBeNull();
    expect(tsProblem("changepoint", s, o({ cp: { ...DEFAULT_TS_OPTIONS.cp, penalty: "value", penaltyValue: -1 } }))).toMatch(/penalty/);
    expect(tsProblem("arima", s, o({ arima: { ...DEFAULT_TS_OPTIONS.arima, p: 6 } }))).toMatch(/0 to 5/);
    expect(tsProblem("arima", s, o({ arima: { ...DEFAULT_TS_OPTIONS.arima, d: 1, trend: "c" } }))).toMatch(/d = 0/);
    expect(tsProblem("arima", s, o({ arima: { ...DEFAULT_TS_OPTIONS.arima, steps: 99 } }))).toMatch(/horizon/);
    expect(tsProblem("stationarity", s, DEFAULT_TS_OPTIONS)).toBeNull();
  });
});

describe("tsRunKey", () => {
  it("changes with the tool, data, channel and only the active tool's settings", () => {
    const base = tsRunKey("decompose", "fp", 0, DEFAULT_TS_OPTIONS);
    expect(tsRunKey("decompose", "fp", 0, DEFAULT_TS_OPTIONS)).toBe(base);
    expect(tsRunKey("decompose", "fp2", 0, DEFAULT_TS_OPTIONS)).not.toBe(base);
    expect(tsRunKey("decompose", "fp", 1, DEFAULT_TS_OPTIONS)).not.toBe(base);
    expect(tsRunKey("decompose", "fp", 0, o({ decomp: { period: 7, model: "additive" } }))).not.toBe(base);
    expect(tsRunKey("decompose", "fp", 0, o({ allowIrregular: true }))).not.toBe(base);
    expect(tsRunKey("decompose", "fp", 0, o({ arima: { ...DEFAULT_TS_OPTIONS.arima, p: 3 } }))).toBe(base);
    expect(tsRunKey("arima", "fp", 0, DEFAULT_TS_OPTIONS)).not.toBe(base);
  });
});

describe("runTimeSeries dispatch", () => {
  beforeEach(() => vi.clearAllMocks());
  it("sends the series, the axis and each tool's options", async () => {
    const s = y(30), x = s.map((_, i) => i);
    for (const f of Object.values(api)) f.mockResolvedValue({});
    await runTimeSeries("correlogram", s, x, o({ corr: { nlags: 7, alpha: 0.1 } }));
    expect(api.tsCorrelogram).toHaveBeenCalledWith({ y: s, x, allow_irregular: false, alpha: 0.1, nlags: 7 });
    await runTimeSeries("correlogram", s, x, DEFAULT_TS_OPTIONS);
    expect(api.tsCorrelogram.mock.calls[1][0]).not.toHaveProperty("nlags"); // 0 = automatic
    await runTimeSeries("changepoint", s, x, o({ allowIrregular: true, cp: { ...DEFAULT_TS_OPTIONS.cp, method: "binseg", penalty: "value", penaltyValue: 9, maxChanges: 3 } }));
    expect(api.tsChangepoint).toHaveBeenCalledWith({
      y: s, x, allow_irregular: true, method: "binseg", cost: "mean", penalty: "value", min_size: 2, penalty_value: 9, max_changes: 3,
    });
    await runTimeSeries("arima", s, x, o({ arima: { p: 2, d: 1, q: 1, trend: "n", steps: 4, alpha: 0.1 } }));
    expect(api.tsArima).toHaveBeenCalledWith({ y: s, x, allow_irregular: false, p: 2, d: 1, q: 1, trend: "n", steps: 4, alpha: 0.1 });
    await runTimeSeries("decompose", s, x, DEFAULT_TS_OPTIONS);
    expect(api.tsDecompose).toHaveBeenCalledWith({ y: s, x, allow_irregular: false, period: 12, model: "additive" });
    await runTimeSeries("stationarity", s, x, DEFAULT_TS_OPTIONS);
    expect(api.tsStationarity).toHaveBeenCalledWith({ y: s, x, allow_irregular: false, tests: "both", regression: "c", alpha: 0.05 });
  });
});
