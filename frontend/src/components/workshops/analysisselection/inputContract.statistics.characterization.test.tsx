// Characterization of how the remaining statistics tools resolve their inputs,
// pinned BEFORE they moved onto the shared resolver (lib/analysisInputs): Fit Y
// by X, Multivariate, Variability, Statistical tests and the Test chooser.
// Each keeps these defaults; the shared summary only states them.
//
// Fixture: six rows, row 1 manually excluded, row 5 filtered out (time > 4.5),
// rows 0 and 2 selected, and a fit X range over the first half. Variability
// uses a nested 18-row design with row 0 excluded and row 17 filtered out.

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsCorrelation, statsNestedAnova, statsPCA, statsRecommend, statsRegression, statsVarianceComponents, statsVariabilitySummary } from "../../../lib/api";
import { runStatsTest } from "../../../lib/api/statsTests";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useFitYByX } from "../fityx/useFitYByX";
import { useMultivar } from "../multivar/useMultivar";
import { useStatsChooser } from "../statschooser/useStatsChooser";
import { useStatsTests } from "../statstests/useStatsTests";
import { useVariability } from "../variability/useVariability";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsRegression: vi.fn(),
  statsCorrelation: vi.fn(),
  statsPCA: vi.fn(),
  statsRecommend: vi.fn(),
  statsNestedAnova: vi.fn(),
  statsVarianceComponents: vi.fn(),
  statsVariabilitySummary: vi.fn(),
  fetchBookData: vi.fn(() => new Promise(() => {})),
}));
vi.mock("../../../lib/api/statsTests", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/statsTests")>()),
  runStatsTest: vi.fn(),
}));

const SHEET: Dataset = {
  id: "d1",
  name: "run.dat",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[10, 1], [20, 2], [30, 3], [40, 4], [50, 5], [60, 6]],
    labels: ["v", "w"],
    units: ["V", "A"],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [1],
  filter: [{ col: -1, kind: "range", max: 4.5 }],
};

const NESTED: Dataset = {
  id: "d2",
  name: "nested.dat",
  data: {
    time: Array.from({ length: 18 }, (_, i) => i),
    values: [
      [0, 0, 2], [0, 0, 4], [0, 0, 6], [0, 1, 4], [0, 1, 6], [0, 1, 8],
      [1, 0, 6], [1, 0, 8], [1, 0, 10], [1, 1, 8], [1, 1, 10], [1, 1, 12],
      [2, 0, 10], [2, 0, 12], [2, 0, 14], [2, 1, 12], [2, 1, 14], [2, 1, 16],
    ],
    labels: ["lot", "wafer", "measurement"],
    units: ["", "", ""],
    metadata: { x_column_name: "T" },
  },
  excludedRows: [0],
  filter: [{ col: -1, kind: "range", max: 16.5 }],
};

const KEPT = { v: [10, 30, 40, 50], w: [1, 3, 4, 5] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsRegression).mockResolvedValue({ coeffs: [0, 0], R2: 1, yFit: [], residuals: [] } as never);
  vi.mocked(statsCorrelation).mockResolvedValue({ r: [[1, 1], [1, 1]], p: [[1, 0], [0, 1]], N: 4, method: "pearson" } as never);
  vi.mocked(statsPCA).mockResolvedValue({ coeff: [[1, 0], [0, 1]], score: [[0, 0], [0, 0], [0, 0], [0, 0]], singular: [1, 1], latent: [1, 0.5], explained: [66, 34], cumulative: [66, 100], mu: [0, 0], sigma: [1, 1] } as never);
  vi.mocked(statsRecommend).mockResolvedValue({ recommendation: "t", endpoint: "/api/stats/ttest", parametric: true, n_groups: 2, paired: false, checks: {}, reasons: [] } as never);
  vi.mocked(statsNestedAnova).mockResolvedValue({ table: [], b_within_a_estimable: false, error_estimable: false } as never);
  vi.mocked(statsVariabilitySummary).mockResolvedValue({ grand_mean: 1, grand_n: 1 } as never);
  vi.mocked(statsVarianceComponents).mockResolvedValue(null as never);
  vi.mocked(runStatsTest).mockResolvedValue({} as never);
  useApp.setState({
    datasets: [SHEET, NESTED], activeId: "d1", selectedIds: [], xKey: null, yKeys: [0], seriesOrder: null,
    selection: { datasetId: "d1", rows: [0, 2] },
    qfitRoi: [0, 2.5], qfitRoiFor: { datasetId: "d1", xKey: null },
    status: "", reports: [], analysisResults: [], history: [], future: [],
  });
});

describe("input resolution today (characterization): statistics tools", () => {
  it("Fit Y by X: active worksheet, own X/Y picks, exclusions + filters dropped, selection and range ignored", async () => {
    const { result } = renderHook(() => useFitYByX());
    expect(result.current.kind).toBe("bivariate");
    await waitFor(() => expect(result.current.bivariate).not.toBeNull());
    const body = vi.mocked(statsRegression).mock.calls.at(-1)![0] as { x: number[]; y: number[] };
    expect(body.x).toEqual(KEPT.v);
    expect(body.y).toEqual(KEPT.w);
  });

  it("Multivariate: active worksheet, default continuous columns, exclusions + filters dropped, selection and range ignored", async () => {
    const { result } = renderHook(() => useMultivar());
    expect(result.current.selected).toEqual([0, 1]);
    await waitFor(() => expect(vi.mocked(statsCorrelation).mock.calls.length).toBeGreaterThan(0));
    expect(vi.mocked(statsCorrelation).mock.calls.at(-1)![0]).toEqual([KEPT.v, KEPT.w]);
    expect(result.current.rows).toEqual([[10, 1], [30, 3], [40, 4], [50, 5]]);
  });

  it("Variability: active worksheet, own factor/response picks, exclusions + filters dropped", async () => {
    useApp.setState({ activeId: "d2" });
    renderHook(() => useVariability());
    await waitFor(() => expect(vi.mocked(statsNestedAnova).mock.calls.length).toBeGreaterThan(0));
    const groups = vi.mocked(statsNestedAnova).mock.calls.at(-1)![0] as number[][][];
    expect(groups[0]).toEqual([[4, 6], [4, 6, 8]]); // row 0 excluded
    expect(groups[2]).toEqual([[10, 12, 14], [12, 14]]); // row 17 filtered out
  });

  it("Statistical tests: active worksheet, own column picks, exclusions + filters dropped; nothing runs until asked", async () => {
    const { result } = renderHook(() => useStatsTests());
    expect(runStatsTest).not.toHaveBeenCalled();
    await act(async () => { await result.current.run(); });
    expect(vi.mocked(runStatsTest).mock.calls.at(-1)![0]).toMatchObject({ id: "anderson", body: { x: KEPT.v } });
  });

  it("Test chooser: active worksheet, own column picks, exclusions + filters dropped; nothing runs until asked", async () => {
    const { result } = renderHook(() => useStatsChooser());
    expect(statsRecommend).not.toHaveBeenCalled();
    act(() => result.current.toggleCol(1));
    expect(result.current.groups.map((group) => group.values)).toEqual([KEPT.v, KEPT.w]);
    await act(async () => { await result.current.recommend(); });
    expect(vi.mocked(statsRecommend).mock.calls.at(-1)![0]).toMatchObject({ groups: [KEPT.v, KEPT.w] });
  });
});
