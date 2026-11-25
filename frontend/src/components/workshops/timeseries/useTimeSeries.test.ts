// Time series hook: Run is explicit, a result lives only while the series and settings match, bad
// input is refused before any request, and the commit follows the result-lifecycle contract.

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useTimeSeries } from "./useTimeSeries";

const api = vi.hoisted(() => ({ tsCorrelogram: vi.fn(), tsStationarity: vi.fn(), tsDecompose: vi.fn(), tsChangepoint: vi.fn(), tsArima: vi.fn() }));
vi.mock("../../../lib/api/timeseries", () => api);

const N = 40;
const data = (values: number[]): DataStruct => ({
  time: values.map((_, i) => i), values: values.map((v) => [v]), labels: ["pressure"], units: ["Pa"], metadata: { x_column_name: "t" },
});
const CORR = { dt: 1, irregular: false, n: N, alpha: 0.05, lags: [0, 1, 2], acf: [1, 0.5, 0.2], pacf: [1, 0.5, 0.1],
  white_noise_band: 0.3, acf_bartlett_band: [null, 0.3, 0.35], pacf_band: 0.3, ljung_box: [] };
const outputs = () => useApp.getState().datasets.filter((d) => d.id !== "d1");

function load(values: number[]) {
  useApp.setState({ datasets: [{ id: "d1", name: "log.dat", data: data(values) }], activeId: "d1", status: "", analysisResults: [],
    history: [], future: [], staleDatasets: [], staleFits: [], recalcMode: "manual" });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.tsCorrelogram.mockResolvedValue(CORR);
  load(Array.from({ length: N }, (_, i) => Math.sin(i / 3)));
});

describe("useTimeSeries", () => {
  it("sends nothing until Run, then shows the result for the matching settings", async () => {
    const { result } = renderHook(() => useTimeSeries());
    expect(api.tsCorrelogram).not.toHaveBeenCalled();
    expect(result.current.problem).toBeNull();
    await act(async () => { await result.current.run(); });
    expect(api.tsCorrelogram).toHaveBeenCalledOnce();
    expect(api.tsCorrelogram.mock.calls[0][0]).toMatchObject({ y: expect.any(Array), x: Array.from({ length: N }, (_, i) => i), allow_irregular: false });
    expect(result.current.result?.tab).toBe("correlogram");
    expect(result.current.figures).toHaveLength(2);
  });

  it("marks a result stale when a setting changes, and keeps each tool's result across tabs", async () => {
    const { result } = renderHook(() => useTimeSeries());
    await act(async () => { await result.current.run(); });
    act(() => result.current.patch("corr", { alpha: 0.1 }));
    expect(result.current.result).toBeNull();
    expect(result.current.stale).toBe(true);
    act(() => result.current.patch("corr", { alpha: 0.05 }));
    expect(result.current.result?.tab).toBe("correlogram");
    act(() => result.current.setTab("decompose"));
    expect(result.current.result).toBeNull();
    expect(result.current.stale).toBe(false);
    act(() => result.current.setTab("correlogram"));
    expect(result.current.result?.tab).toBe("correlogram");
  });

  it("refuses a series with a blank row before any request", async () => {
    load(Array.from({ length: N }, (_, i) => (i === 7 ? Number.NaN : i)));
    const { result } = renderHook(() => useTimeSeries());
    expect(result.current.problem).toMatch(/blank or non-finite/);
    await act(async () => { await result.current.run(); });
    expect(api.tsCorrelogram).not.toHaveBeenCalled();
  });

  it("shows a backend refusal and no result", async () => {
    api.tsCorrelogram.mockRejectedValue(new Error("the time axis is not evenly spaced"));
    const { result } = renderHook(() => useTimeSeries());
    await act(async () => { await result.current.run(); });
    expect(result.current.error).toMatch(/not evenly spaced/);
    expect(result.current.result).toBeNull();
    expect(result.current.canCommit).toBe(false);
  });

  it("an older run cannot land after a newer dataset is selected", async () => {
    let release: (v: unknown) => void = () => undefined;
    api.tsCorrelogram.mockReturnValue(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useTimeSeries());
    let pending: Promise<void> = Promise.resolve();
    act(() => { pending = result.current.run(); });
    act(() => useApp.setState({ datasets: [{ id: "d2", name: "other", data: data(Array.from({ length: N }, (_, i) => i * i)) }], activeId: "d2" }));
    await act(async () => { release(CORR); await pending; });
    expect(result.current.result).toBeNull();
  });

  it("adds a linked worksheet once; a repeat adds nothing; a data change allows a new one", async () => {
    const { result } = renderHook(() => useTimeSeries());
    expect(result.current.canCommit).toBe(false);
    await act(async () => { await result.current.run(); });
    act(() => result.current.commit());
    expect(outputs()).toHaveLength(1);
    expect(outputs()[0].name).toBe("ACF/PACF of pressure");
    expect(useApp.getState().analysisResults[0].producer.id).toBe("time-series");
    act(() => result.current.commit());
    expect(outputs()).toHaveLength(1);
    expect(result.current.done).toContain("already added");
  });
});
