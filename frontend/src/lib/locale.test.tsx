// The statistics default (alpha / confidence) from Preferences ▸ Numbers reaches
// each tool that takes one as an input default; with the pref untouched every
// tool starts exactly as before (0.05 / 95%). Provisional, owner to confirm.

import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PARAMS } from "./statsTests";
import { ALPHA_MAX, ALPHA_MIN, alphaIn, confidenceIn, defaultAlpha, defaultConfidence, NUMBER_PREF_DEFAULTS, numberPrefsSlot } from "./locale";
import { statsProfile, type ProfilerModel } from "./api/modelEvaluate";
import { DEFAULT_TS_OPTIONS, tsDefaultOptions } from "../components/workshops/timeseries/timeSeriesRun";
import { useOutlierScreening } from "../components/workshops/outliers/useOutlierScreening";
import { useStatsTests } from "../components/workshops/statstests/useStatsTests";
import FitOutputSection from "../components/workshops/curvefit/FitOutputSection";
import { ProfilerPanel } from "../components/workshops/profiler/ProfilerPanel";
import { useProfilerStore } from "../store/profiler";
import { useApp } from "../store/useApp";
import type { Dataset } from "./types";

vi.mock("./api/modelEvaluate", () => ({ statsProfile: vi.fn(), statsContour: vi.fn(), statsDesirability: vi.fn() }));
vi.mock("../store/derivedColumnRun", () => ({ addDerivedColumn: vi.fn(async () => ({ ok: true, message: "" })) }));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

const setAlpha = (alpha: number) => numberPrefsSlot.save({ ...NUMBER_PREF_DEFAULTS, alpha });

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
});
afterEach(() => {
  numberPrefsSlot.reset();
  localStorage.clear();
});

describe("the alpha pref", () => {
  it("defaults to 0.05 / 95% and accepts a value in range only", () => {
    expect(defaultAlpha()).toBe(0.05);
    expect(defaultConfidence()).toBe(0.95);
    setAlpha(0.01);
    expect(defaultAlpha()).toBe(0.01);
    expect(defaultConfidence()).toBe(0.99);
    for (const bad of [0, ALPHA_MIN / 2, ALPHA_MAX + 0.01, -1, NaN, "0.01"]) {
      localStorage.setItem("qz.numberPrefs", JSON.stringify({ alpha: bad }));
      expect(defaultAlpha()).toBe(0.05);
    }
  });

  it("a list that lacks the value keeps today's default", () => {
    setAlpha(0.025);
    expect(alphaIn([0.1, 0.05, 0.01])).toBe(0.05);
    expect(confidenceIn([0.68, 0.9, 0.95, 0.99])).toBe(0.95);
    setAlpha(0.1);
    expect(alphaIn([0.1, 0.05, 0.01])).toBe(0.1);
    expect(confidenceIn([0.68, 0.9, 0.95, 0.99])).toBe(0.9);
  });
});

describe("alpha default reaching each tool", () => {
  it("Time series: all three alpha fields; untouched = DEFAULT_TS_OPTIONS", () => {
    expect(tsDefaultOptions()).toEqual(DEFAULT_TS_OPTIONS);
    setAlpha(0.01);
    const o = tsDefaultOptions();
    expect([o.corr.alpha, o.stat.alpha, o.arima.alpha]).toEqual([0.01, 0.01, 0.01]);
    expect(o.cp).toEqual(DEFAULT_TS_OPTIONS.cp);
  });

  it("Statistical tests: the starting alpha; the rest of the params are untouched", () => {
    expect(renderHook(() => useStatsTests()).result.current.params).toEqual(DEFAULT_PARAMS);
    setAlpha(0.01);
    const { params } = renderHook(() => useStatsTests()).result.current;
    expect(params.alpha).toBe(0.01);
    expect({ ...params, alpha: 0.05 }).toEqual(DEFAULT_PARAMS);
  });

  it("Outlier screening", () => {
    expect(renderHook(() => useOutlierScreening()).result.current.alpha).toBe(0.05);
    setAlpha(0.1);
    expect(renderHook(() => useOutlierScreening()).result.current.alpha).toBe(0.1);
  });

  it("Fit output (band level)", () => {
    const ds: Dataset = {
      id: "d1", name: "run.dat", workbookId: "wb1",
      data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["M"], units: [""], metadata: {} },
      fitSpec: { model: "Linear", params: [2, 1] },
    };
    const result = { params: [2, 1], errors: [0.1, 0.1], covar: [[0.01, 0], [0, 0.01]], yFit: [1, 3, 5], residuals: [0, 0, 0], nPoints: 3, nFree: 2 };
    const level = (): string => {
      useApp.setState({ datasets: [ds], activeId: "d1" });
      const { unmount } = render(<FitOutputSection dataset={ds} model="Linear" paramNames={["m", "b"]} result={result} fitData={{ x: [0, 1, 2], y: [1, 3, 5], xKey: null, yKey: 0, dy: null }} />);
      fireEvent.click(screen.getByText("Output to worksheet"));
      fireEvent.change(screen.getByLabelText("Fit output destination"), { target: { value: "sheet" } });
      fireEvent.click(screen.getByLabelText(/Confidence band/));
      const v = (screen.getByLabelText("Output band level") as HTMLSelectElement).value;
      unmount();
      return v;
    };
    expect(level()).toBe("0.95");
    setAlpha(0.01);
    expect(level()).toBe("0.99");
  });

  it("Profiler: the Confidence select and the request's alpha", async () => {
    const model = {
      response: "a", factors: [{ name: "T", kind: "continuous", mean: 600 }], terms: [["T"]], center_polynomials: true,
      parameters: [], coefficients: [], covariance: [], df_error: 8, rmse: 0.1, ranges: { T: [300, 900] },
    } as unknown as ProfilerModel;
    const profile = {
      response: "a", alpha: 0.01, t_crit: 2, df_error: 8, rmse: 0.1,
      current: { settings: { T: 600 }, predicted: 3.6, se: 0.05, lower: 3.5, upper: 3.7 },
      factors: [{ name: "T", kind: "continuous", x: [300, 900], range: [300, 900], predicted: [3, 4], se: [0.05, 0.05], lower: [2.9, 3.9], upper: [3.1, 4.1] }],
    };
    vi.mocked(statsProfile).mockReset().mockResolvedValue(profile as never);
    setAlpha(0.01);
    useProfilerStore.setState({ open: true, request: { model, label: "a" } });
    render(<ProfilerPanel />);
    await screen.findByText(/a = 3\.6/);
    expect((screen.getByLabelText("Confidence level") as HTMLSelectElement).value).toBe("0.01");
    expect(vi.mocked(statsProfile).mock.calls[0]?.[0]).toMatchObject({ alpha: 0.01 });
    await act(async () => undefined);
  });
});
