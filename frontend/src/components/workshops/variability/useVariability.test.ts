import { renderHook, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsNestedAnova, statsVarianceComponents, statsVariabilitySummary, type NestedAnovaResponse, type VarianceComponentsResponse, type VariabilitySummaryResponse } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useVariability } from "./useVariability";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsNestedAnova: vi.fn(),
  statsVarianceComponents: vi.fn(),
  statsVariabilitySummary: vi.fn(),
  reportEmit: vi.fn(),
}));

// The SAME balanced 2-per-A, 3-per-cell nested design as
// tests/test_api_stats_varcomp.py's _BALANCED fixture: col0 "lot" (3
// A-levels), col1 "wafer" (2 B-levels nested in each lot), col2
// "measurement" (continuous response). Nominal inference needs >=12
// samples, <=8 distinct levels, each level used >=3x on average — lot (3
// distinct / 18 rows) and wafer (2 distinct / 18 rows) both qualify;
// measurement has 8 distinct values over 18 rows (8*3=24 > 18) so it reads
// continuous.
const DATA: DataStruct = {
  time: Array.from({ length: 18 }, (_, i) => i),
  values: [
    [0, 0, 2], [0, 0, 4], [0, 0, 6],
    [0, 1, 4], [0, 1, 6], [0, 1, 8],
    [1, 0, 6], [1, 0, 8], [1, 0, 10],
    [1, 1, 8], [1, 1, 10], [1, 1, 12],
    [2, 0, 10], [2, 0, 12], [2, 0, 14],
    [2, 1, 12], [2, 1, 14], [2, 1, 16],
  ],
  labels: ["lot", "wafer", "measurement"],
  units: ["", "", ""],
  metadata: { x_column_name: "T" },
};

const WIRE_GROUPS = [
  [[2, 4, 6], [4, 6, 8]],
  [[6, 8, 10], [8, 10, 12]],
  [[10, 12, 14], [12, 14, 16]],
];

const ANOVA: NestedAnovaResponse = {
  table: [
    { source: "A", SS: 192, df: 2, MS: 96, F: 32, p: 0.0005 },
    { source: "B(A)", SS: 18, df: 3, MS: 6, F: 0.75, p: 0.55 },
    { source: "Error", SS: 48, df: 12, MS: 4, F: null, p: null },
    { source: "Total", SS: 258, df: 17, MS: null, F: null, p: null },
  ],
  a_levels: 3,
  b_per_a: [2, 2, 2],
  n_per_cell: [[3, 3], [3, 3], [3, 3]],
  n_total: 18,
  grand_mean: 9,
  alpha: 0.05,
  a_tested_against: "B(A)",
  b_within_a_estimable: true,
  error_estimable: true,
  balanced: true,
};

const VARCOMP: VarianceComponentsResponse = {
  sigma2_A: 15,
  sigma2_B_within_A: 2 / 3,
  sigma2_error: 4,
  sigma2_A_raw: 15,
  sigma2_B_within_A_raw: 2 / 3,
  sigma2_error_raw: 4,
  pct_A: 76.3,
  pct_B_within_A: 3.4,
  pct_error: 20.3,
  clamped: { A: false, B_within_A: false, error: false },
  n1_coefficient: 3,
  n2_coefficient: 6,
  ms_a: 96,
  ms_b: 6,
  ms_e: 4,
  balanced: true,
  method: "ANOVA/EMS method (exact closed form, balanced design)",
};

const SUMMARY: VariabilitySummaryResponse = {
  cells: [
    { a_index: 0, b_index: 0, n: 3, mean: 4, sd: 2 },
    { a_index: 0, b_index: 1, n: 3, mean: 6, sd: 2 },
    { a_index: 1, b_index: 0, n: 3, mean: 8, sd: 2 },
    { a_index: 1, b_index: 1, n: 3, mean: 10, sd: 2 },
    { a_index: 2, b_index: 0, n: 3, mean: 12, sd: 2 },
    { a_index: 2, b_index: 1, n: 3, mean: 14, sd: 2 },
  ],
  a_groups: [
    { a_index: 0, n: 6, mean: 5 },
    { a_index: 1, n: 6, mean: 9 },
    { a_index: 2, n: 6, mean: 13 },
  ],
  grand_mean: 9,
  grand_n: 18,
  a_levels: 3,
  balanced: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsNestedAnova).mockResolvedValue(ANOVA);
  vi.mocked(statsVarianceComponents).mockResolvedValue(VARCOMP);
  vi.mocked(statsVariabilitySummary).mockResolvedValue(SUMMARY);
  useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1", selection: null });
});

describe("useVariability — column defaults", () => {
  it("defaults Factor A/B to the two nominal columns and Response to the continuous one", () => {
    const { result } = renderHook(() => useVariability());
    expect(result.current.factorACol).toBe(0);
    expect(result.current.factorBCol).toBe(1);
    expect(result.current.responseCol).toBe(2);
  });
});

describe("useVariability — nested grouping + fetch", () => {
  it("builds the same nested-groups wire shape as the backend's own fixture and fetches all three endpoints", async () => {
    const { result } = renderHook(() => useVariability());
    await waitFor(() => expect(result.current.anova).not.toBeNull());
    expect(statsNestedAnova).toHaveBeenCalledWith(WIRE_GROUPS);
    expect(statsVariabilitySummary).toHaveBeenCalledWith(WIRE_GROUPS);
    expect(statsVarianceComponents).toHaveBeenCalledWith(WIRE_GROUPS);
    expect(result.current.varComp).toEqual(VARCOMP);
    expect(result.current.summary).toEqual(SUMMARY);
    expect(result.current.tooFewLevels).toBe(false);
  });

  it("skips the variance-components call when B(A) isn't estimable", async () => {
    vi.mocked(statsNestedAnova).mockResolvedValue({ ...ANOVA, b_within_a_estimable: false, a_tested_against: "Error" });
    const { result } = renderHook(() => useVariability());
    await waitFor(() => expect(result.current.anova).not.toBeNull());
    expect(statsVarianceComponents).not.toHaveBeenCalled();
    expect(result.current.varComp).toBeNull();
    expect(result.current.varCompNote).toContain("variance components need");
  });

  it("re-fetches when the Factor A column changes", async () => {
    const { result } = renderHook(() => useVariability());
    await waitFor(() => expect(result.current.anova).not.toBeNull());
    vi.mocked(statsNestedAnova).mockClear();
    act(() => result.current.setFactorACol(1));
    await waitFor(() => expect(statsNestedAnova).toHaveBeenCalled());
  });

  it("reports tooFewLevels and skips fetching when Factor A has under 2 levels", async () => {
    const ONE_LEVEL: DataStruct = {
      ...DATA,
      values: DATA.values.map((r) => [0, r[1], r[2]]),
    };
    useApp.setState({ datasets: [{ id: "d2", name: "single.dat", data: ONE_LEVEL }], activeId: "d2", selection: null });
    const { result } = renderHook(() => useVariability());
    await waitFor(() => expect(result.current.tooFewLevels).toBe(true));
    expect(result.current.error).toContain("at least 2");
    expect(statsNestedAnova).not.toHaveBeenCalled();
  });
});

describe("useVariability — dataset switch", () => {
  it("resets column picks when the active dataset changes", async () => {
    const { result, rerender } = renderHook(() => useVariability());
    await waitFor(() => expect(result.current.anova).not.toBeNull());

    const OTHER: DataStruct = { ...DATA, labels: ["site", "tool", "yield"] };
    useApp.setState({ datasets: [{ id: "d2", name: "other.dat", data: OTHER }], activeId: "d2", selection: null });
    rerender();
    expect(result.current.factorACol).toBe(0);
    expect(result.current.factorBCol).toBe(1);
    expect(result.current.responseCol).toBe(2);
  });
});
