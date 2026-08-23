import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit, statsAnova, statsChiSquareIndependence, statsFisherExact, statsLevene, statsRecommend, statsRegression, statsTukey } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFitYByX } from "./useFitYByX";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsAnova: vi.fn(),
  statsLevene: vi.fn(),
  statsTukey: vi.fn(),
  statsRecommend: vi.fn(),
  statsRegression: vi.fn(),
  statsChiSquareIndependence: vi.fn(),
  statsFisherExact: vi.fn(),
  reportEmit: vi.fn(),
}));

// 12 rows: col0 "xcat" (2-level nominal, factor), col1 "ycat" (2-level
// nominal), col2 "yval" (continuous response, correlated with xcat's
// grouping), col3 "xval" (continuous, correlated with yval for the
// bivariate leg). Nominal inference needs >=12 samples, <=8 distinct
// levels, each level used >=3x on average.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 0, 10, 1],
    [0, 0, 12, 2],
    [0, 0, 14, 3],
    [0, 1, 16, 4],
    [0, 1, 18, 5],
    [0, 1, 20, 6],
    [1, 0, 30, 7],
    [1, 0, 32, 8],
    [1, 0, 34, 9],
    [1, 1, 36, 10],
    [1, 1, 38, 11],
    [1, 1, 40, 12],
  ],
  labels: ["xcat", "ycat", "yval", "xval"],
  units: ["", "", "", ""],
  metadata: { x_column_name: "T" },
};

const ANOVA = { fStat: 40, df1: 1, df2: 10, pValue: 0.0001, reject: true };
const LEVENE = { W: 0.1, p: 0.8, center: "median", n_groups: 2, method: "Brown-Forsythe" };
const TUKEY = { pairs: [{ i: 0, j: 1, diff: -20, p: 0.0001, ciLow: -25, ciHigh: -15, significant: true }], n_groups: 2, alpha: 0.05 };
const RECOMMEND = {
  recommendation: "One-way ANOVA",
  endpoint: "/api/stats/anova",
  parametric: true,
  n_groups: 2,
  paired: false,
  checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] },
  reasons: ["both groups pass normality"],
};
const REGRESSION = {
  coeffs: [5, 3],
  se: [0.5, 0.2],
  tStats: [10, 15],
  pValues: [0.0001, 0.0001],
  R2: 0.98,
  R2adj: 0.97,
  fStat: 500,
  fPvalue: 0.0001,
  RMSE: 0.5,
  residuals: [0, 0, 0],
  yFit: [8, 11, 14, 17, 20, 23, 26, 29, 32, 35, 38, 41],
  N: 12,
  df: 10,
};
const CHI2 = {
  chi2: 0,
  dof: 1,
  p_value: 1,
  expected: [
    [3, 3],
    [3, 3],
  ],
  n: 12,
  cramers_v: 0,
  low_expected: false,
  low_expected_count: 0,
  shape: [2, 2],
  method: "Pearson chi-square test of independence",
};
const FISHER = { odds_ratio: 1, p_value: 1, alternative: "two-sided", n: 12, method: "Fisher exact test" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsAnova).mockResolvedValue(ANOVA);
  vi.mocked(statsLevene).mockResolvedValue(LEVENE);
  vi.mocked(statsTukey).mockResolvedValue(TUKEY);
  vi.mocked(statsRecommend).mockResolvedValue(RECOMMEND);
  vi.mocked(statsRegression).mockResolvedValue(REGRESSION);
  vi.mocked(statsChiSquareIndependence).mockResolvedValue(CHI2);
  vi.mocked(statsFisherExact).mockResolvedValue(FISHER);
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", status: "", reports: [] });
});

describe("useFitYByX — dispatch + defaults", () => {
  it("defaults X to the first categorical column and Y to a continuous one", () => {
    const { result } = renderHook(() => useFitYByX());
    expect(result.current.xCol).toBe(0);
    expect(result.current.yCol).toBe(2);
    expect(result.current.kind).toBe("oneway");
  });

  it("dispatches bivariate for continuous x continuous", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    expect(result.current.kind).toBe("bivariate");
    await waitFor(() => expect(statsRegression).toHaveBeenCalled());
  });

  it("dispatches contingency for categorical x categorical", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(0);
      result.current.setYCol(1);
    });
    expect(result.current.kind).toBe("contingency");
    await waitFor(() => expect(statsChiSquareIndependence).toHaveBeenCalled());
  });

  it("flags categorical-Y x continuous-X as unsupported (no fetch for that combination)", async () => {
    const { result } = renderHook(() => useFitYByX());
    await waitFor(() => expect(result.current.oneway).not.toBeNull()); // initial default (oneway) settles
    vi.clearAllMocks();
    act(() => {
      result.current.setXCol(2); // continuous
      result.current.setYCol(1); // categorical
    });
    expect(result.current.kind).toBe("unsupported");
    expect(result.current.error).toContain("logistic");
    expect(statsAnova).not.toHaveBeenCalled();
  });
});

describe("useFitYByX — oneway leg", () => {
  it("groups Y by X's resolved levels and runs ANOVA + Levene + recommend (no Tukey at 2 levels)", async () => {
    const { result } = renderHook(() => useFitYByX());
    await waitFor(() => expect(result.current.oneway).not.toBeNull());
    expect(statsAnova).toHaveBeenCalledWith([[10, 12, 14, 16, 18, 20], [30, 32, 34, 36, 38, 40]]);
    expect(statsLevene).toHaveBeenCalled();
    expect(statsRecommend).toHaveBeenCalled();
    expect(statsTukey).not.toHaveBeenCalled();
    expect(result.current.oneway!.groups.map((g) => g.label)).toEqual(["0", "1"]);
    expect(result.current.oneway!.anova).toEqual(ANOVA);
    expect(result.current.oneway!.levene).toEqual(LEVENE);
    expect(result.current.oneway!.tukey).toBeNull();
  });

  it("runs Tukey when X has more than 2 levels", async () => {
    const DATA3: DataStruct = {
      time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      values: [
        [0, 10], [0, 12], [0, 14], [0, 16],
        [1, 20], [1, 22], [1, 24], [1, 26],
        [2, 30], [2, 32], [2, 34], [2, 36],
      ],
      labels: ["grp3", "val"],
      units: ["", ""],
      metadata: {},
    };
    useApp.setState({ datasets: [{ id: "d2", name: "r3.dat", data: DATA3 }], activeId: "d2", status: "", reports: [] });
    const { result } = renderHook(() => useFitYByX());
    await waitFor(() => expect(result.current.oneway).not.toBeNull());
    expect(statsTukey).toHaveBeenCalledWith([[10, 12, 14, 16], [20, 22, 24, 26], [30, 32, 34, 36]]);
    expect(result.current.oneway!.tukey).toEqual(TUKEY);
  });

  it("honors row exclusion (#50): excluded rows drop from the groups", async () => {
    useApp.setState({
      datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [0, 1, 2] }],
      activeId: "d1",
    });
    renderHook(() => useFitYByX());
    await waitFor(() => expect(statsAnova).toHaveBeenCalled());
    expect(statsAnova).toHaveBeenCalledWith([[16, 18, 20], [30, 32, 34, 36, 38, 40]]);
  });
});

describe("useFitYByX — bivariate leg", () => {
  it("fits x vs y with the chosen order and surfaces the regression table", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect(statsRegression).toHaveBeenCalledWith({
      x: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      y: [10, 12, 14, 16, 18, 20, 30, 32, 34, 36, 38, 40],
      order: 1,
      // JMP_GAP J3 residual: the confidence-band evaluation grid (40 points
      // spanning [min(x), max(x)]) always rides along with the fit request,
      // defaulting to a confidence (not prediction) interval.
      band_x: expect.any(Array),
      band_interval: "confidence",
    });
    expect(result.current.bivariate!.regression).toEqual(REGRESSION);
  });

  it("re-fits when the order changes", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    act(() => result.current.setOrder(2));
    await waitFor(() => expect(statsRegression).toHaveBeenLastCalledWith(expect.objectContaining({ order: 2 })));
  });

  it("re-fits with band_interval=prediction when bandInterval is switched (JMP_GAP J3 residual)", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect(result.current.bandInterval).toBe("confidence");
    act(() => result.current.setBandInterval("prediction"));
    await waitFor(() =>
      expect(statsRegression).toHaveBeenLastCalledWith(expect.objectContaining({ band_interval: "prediction" })),
    );
    expect(result.current.bandInterval).toBe("prediction");
  });

  it("surfaces a confidence band from the response's band field (JMP_GAP J3 residual)", async () => {
    const BAND = { x: [1, 12], yFit: [8, 41], ciLo: [6, 39], ciHi: [10, 43], alpha: 0.05 };
    vi.mocked(statsRegression).mockResolvedValue({ ...REGRESSION, band: BAND });
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect(result.current.bivariate!.band).toEqual(BAND);
  });

  it("band is null when the backend response has no band field", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(3);
      result.current.setYCol(2);
    });
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    expect(result.current.bivariate!.band).toBeNull();
  });
});

describe("useFitYByX — contingency leg", () => {
  it("cross-tabs the two categorical columns and runs chi-square + fisher (2x2)", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(0);
      result.current.setYCol(1);
    });
    await waitFor(() => expect(result.current.contingency).not.toBeNull());
    expect(statsChiSquareIndependence).toHaveBeenCalledWith([[3, 3], [3, 3]]);
    expect(statsFisherExact).toHaveBeenCalledWith([[3, 3], [3, 3]]);
    expect(result.current.contingency!.rowLabels).toEqual(["0", "1"]);
    expect(result.current.contingency!.colLabels).toEqual(["0", "1"]);
    expect(result.current.contingency!.fisher).toEqual(FISHER);
  });
});

describe("useFitYByX — report emission", () => {
  it("emits a stats_table report for the oneway leg", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    const { result } = renderHook(() => useFitYByX());
    await waitFor(() => expect(result.current.oneway).not.toBeNull());
    await act(async () => {
      await result.current.toReport();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        title: "yval by xcat — oneway",
        records: [
          expect.objectContaining({ group: "0", n: 6 }),
          expect.objectContaining({ group: "1", n: 6 }),
        ],
      }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
  });

  it("surfaces a report failure instead of throwing", async () => {
    vi.mocked(reportEmit).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useFitYByX());
    await waitFor(() => expect(result.current.oneway).not.toBeNull());
    await act(async () => {
      await result.current.toReport();
    });
    expect(useApp.getState().reports).toHaveLength(0);
    expect(result.current.reportBusy).toBe(false);
  });
});

// 12 rows: col0 "byc" (3-level nominal By column: levels 0/1 have 5 rows
// each with both xcat groups present; level 2 has only 2 rows, both xcat=0
// — too few non-empty x-groups for oneway on that level), col1 "xcat"
// (2-level nominal factor), col2 "yval" (continuous response).
const BY_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 0, 10], [0, 0, 11], [0, 1, 12], [0, 1, 13], [0, 1, 14],
    [1, 0, 15], [1, 0, 16], [1, 0, 17], [1, 1, 18], [1, 1, 19],
    [2, 0, 20], [2, 0, 21],
  ],
  labels: ["byc", "xcat", "yval"],
  units: ["", "", ""],
  metadata: {},
};

describe("useFitYByX — By grouping (JMP_GAP_PLAN J7)", () => {
  beforeEach(() => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }], activeId: "d1", status: "", reports: [] });
  });

  it("offers only the OTHER categorical columns as a By option (not the chosen X)", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(1); // xcat
      result.current.setYCol(2); // yval
    });
    expect(result.current.byOptions).toEqual([{ index: 0, label: "byc" }]);
  });

  it("picking a By column runs the SAME dispatch once per level", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(1);
      result.current.setYCol(2);
    });
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(3));
    expect(statsAnova).toHaveBeenCalledWith([[10, 11], [12, 13, 14]]);
    expect(statsAnova).toHaveBeenCalledWith([[15, 16, 17], [18, 19]]);
    const ok = result.current.byResults.filter((r) => !r.error);
    expect(ok).toHaveLength(2);
    expect(ok.every((r) => r.oneway)).toBe(true);
  });

  it("a level too small for the leg shows 'not enough data (n=…)' instead of erroring", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(1);
      result.current.setYCol(2);
    });
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(3));
    const sparse = result.current.byResults.find((r) => r.label === "2");
    expect(sparse?.error).toBe("not enough data (n=2)");
    expect(sparse?.oneway).toBeUndefined();
  });

  it("switching the dataset resets By to none", async () => {
    const { result } = renderHook(() => useFitYByX());
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byLevels).toHaveLength(3));
    useApp.setState({ datasets: [{ id: "d2", name: "other.dat", data: BY_DATA }], activeId: "d2" });
    await waitFor(() => expect(result.current.byCol).toBeNull());
    expect(result.current.byLevels).toEqual([]);
  });

  it("emits a per-level report keyed by level label, skipping levels with too little data", async () => {
    vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
    const { result } = renderHook(() => useFitYByX());
    act(() => {
      result.current.setXCol(1);
      result.current.setYCol(2);
    });
    act(() => result.current.setByCol(0));
    await waitFor(() => expect(result.current.byResults).toHaveLength(3));
    await act(async () => {
      await result.current.toReport();
    });
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        title: "yval by xcat — oneway — by byc",
        records: [
          expect.objectContaining({ level: "0", group: "0", n: 2 }),
          expect.objectContaining({ level: "0", group: "1", n: 3 }),
          expect.objectContaining({ level: "1", group: "0", n: 3 }),
          expect.objectContaining({ level: "1", group: "1", n: 2 }),
        ],
      }),
    );
    expect(useApp.getState().reports).toHaveLength(1);
  });
});
