// FitYByXPanel — component tests for the X/Y column pick + per-leg dispatch
// rendering (oneway / bivariate / contingency) and the "→ Report" emission.
// Mirrors TabulatePanel.test.tsx's fetch-mocking style.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DataStruct } from "../../../lib/types";
import { useFitYByXStore } from "../../../store/fitYByX";
import { useApp } from "../../../store/useApp";
import FitYByXPanel from "./FitYByXPanel";

const { emitMock, anovaMock, leveneMock, tukeyMock, recommendMock, regressionMock, chi2Mock, fisherMock } = vi.hoisted(
  () => ({
    emitMock: vi.fn(),
    anovaMock: vi.fn(),
    leveneMock: vi.fn(),
    tukeyMock: vi.fn(),
    recommendMock: vi.fn(),
    regressionMock: vi.fn(),
    chi2Mock: vi.fn(),
    fisherMock: vi.fn(),
  }),
);

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  reportEmit: emitMock,
  statsAnova: anovaMock,
  statsLevene: leveneMock,
  statsTukey: tukeyMock,
  statsRecommend: recommendMock,
  statsRegression: regressionMock,
  statsChiSquareIndependence: chi2Mock,
  statsFisherExact: fisherMock,
}));

// Same fixture as useFitYByX.test.ts: col0 "xcat" (2-level), col1 "ycat"
// (2-level), col2 "yval" (continuous), col3 "xval" (continuous).
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 0, 10, 1], [0, 0, 12, 2], [0, 0, 14, 3],
    [0, 1, 16, 4], [0, 1, 18, 5], [0, 1, 20, 6],
    [1, 0, 30, 7], [1, 0, 32, 8], [1, 0, 34, 9],
    [1, 1, 36, 10], [1, 1, 38, 11], [1, 1, 40, 12],
  ],
  labels: ["xcat", "ycat", "yval", "xval"],
  units: ["", "", "", ""],
  metadata: { x_column_name: "T" },
};

beforeEach(() => {
  vi.clearAllMocks();
  anovaMock.mockResolvedValue({ fStat: 40, df1: 1, df2: 10, pValue: 0.0001, reject: true });
  leveneMock.mockResolvedValue({ W: 0.1, p: 0.8, center: "median", n_groups: 2, method: "Brown-Forsythe" });
  tukeyMock.mockResolvedValue({ pairs: [], n_groups: 2, alpha: 0.05 });
  recommendMock.mockResolvedValue({
    recommendation: "One-way ANOVA",
    endpoint: "/api/stats/anova",
    parametric: true,
    n_groups: 2,
    paired: false,
    checks: { alpha: 0.05, shapiro_p: [0.5, 0.6] },
    reasons: ["both groups pass normality"],
  });
  regressionMock.mockResolvedValue({
    coeffs: [5, 3], se: [0.5, 0.2], tStats: [10, 15], pValues: [0.0001, 0.0001],
    R2: 0.98, R2adj: 0.97, fStat: 500, fPvalue: 0.0001, RMSE: 0.5,
    residuals: [0], yFit: [8, 41], N: 12, df: 10,
  });
  chi2Mock.mockResolvedValue({
    chi2: 0, dof: 1, p_value: 1, expected: [[3, 3], [3, 3]], n: 12,
    cramers_v: 0, low_expected: false, low_expected_count: 0, shape: [2, 2],
    method: "Pearson chi-square test of independence",
  });
  fisherMock.mockResolvedValue({ odds_ratio: 1, p_value: 1, alternative: "two-sided", n: 12, method: "Fisher exact test" });
  useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1", reports: [], status: "" });
  useFitYByXStore.setState({ open: true });
});

describe("FitYByXPanel", () => {
  it("defaults to the oneway leg and renders the ANOVA table", async () => {
    render(<FitYByXPanel />);
    expect(screen.getByText(/Oneway/)).toBeInTheDocument();
    await waitFor(() => expect(anovaMock).toHaveBeenCalled());
    expect(await screen.findByRole("columnheader", { name: "F" })).toBeInTheDocument();
  });

  it("switches to the bivariate leg when both columns are continuous", async () => {
    render(<FitYByXPanel />);
    fireEvent.change(screen.getByLabelText("X (factor)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Y (response)"), { target: { value: "2" } });
    expect(screen.getByText(/Bivariate/)).toBeInTheDocument();
    await waitFor(() => expect(regressionMock).toHaveBeenCalled());
    expect(screen.getByLabelText("bivariate scatter with fit")).toBeInTheDocument();
  });

  it("switches to the contingency leg for two categorical columns", async () => {
    render(<FitYByXPanel />);
    fireEvent.change(screen.getByLabelText("X (factor)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Y (response)"), { target: { value: "1" } });
    expect(screen.getByText(/Contingency/)).toBeInTheDocument();
    await waitFor(() => expect(chi2Mock).toHaveBeenCalled());
    expect(await screen.findByText("Fisher's exact (2x2)")).toBeInTheDocument();
  });

  it("emits a stats_table report for the active leg", async () => {
    emitMock.mockResolvedValue({ report: { title: "t", sections: [] } });
    render(<FitYByXPanel />);
    await waitFor(() => expect(anovaMock).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(emitMock).toHaveBeenCalledWith(expect.objectContaining({ kind: "stats_table" }));
  });

  it("shows the unsupported note for a categorical Y against a continuous X", () => {
    render(<FitYByXPanel />);
    fireEvent.change(screen.getByLabelText("X (factor)"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Y (response)"), { target: { value: "1" } });
    expect(screen.getByText(/logistic/)).toBeInTheDocument();
  });
});
