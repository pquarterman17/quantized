import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsNestedAnova, statsVarianceComponents, statsVariabilitySummary, type NestedAnovaResponse, type VarianceComponentsResponse, type VariabilitySummaryResponse } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import { useResultBookRequest } from "../../../store/resultBookRequest";
import { useVariabilityStore } from "../../../store/variability";
import VariabilityChartPanel from "./VariabilityChartPanel";

vi.mock("../../../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api")>()),
  statsNestedAnova: vi.fn(),
  statsVarianceComponents: vi.fn(),
  statsVariabilitySummary: vi.fn(),
  reportEmit: vi.fn(),
}));

class MockResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

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
  vi.stubGlobal("ResizeObserver", MockResizeObserver);
  vi.mocked(statsNestedAnova).mockResolvedValue(ANOVA);
  vi.mocked(statsVarianceComponents).mockResolvedValue(VARCOMP);
  vi.mocked(statsVariabilitySummary).mockResolvedValue(SUMMARY);
  useApp.setState({ datasets: [], activeId: null, selection: null, analysisResults: [], history: [], future: [] });
  useVariabilityStore.setState({ open: true, request: null });
});

describe("VariabilityChartPanel", () => {
  it("prompts to select a dataset when none is active", () => {
    render(<VariabilityChartPanel />);
    expect(screen.getByText("Select a dataset to analyze.")).toBeInTheDocument();
  });

  it("defaults to lot/wafer/measurement and renders the chart + ANOVA + variance-components tables", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1" });
    render(<VariabilityChartPanel />);
    expect(await screen.findByRole("img", { name: "variability chart" })).toBeInTheDocument();
    expect(statsNestedAnova).toHaveBeenCalledWith([
      [[2, 4, 6], [4, 6, 8]],
      [[6, 8, 10], [8, 10, 12]],
      [[10, 12, 14], [12, 14, 16]],
    ]);
    expect(screen.getByText("Nested ANOVA")).toBeInTheDocument();
    expect(screen.getByText(/Variance components/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report/ })).toBeInTheDocument();
    const save = screen.getByRole("button", { name: "Save result" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(save).toBeDisabled();
    expect(screen.getByText("This variability result is already saved.")).toBeInTheDocument();
  });

  it("shows the result as a result book: sections, table actions fail closed until saved, then route to the saved result", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1" });
    render(<VariabilityChartPanel />);
    await screen.findByRole("img", { name: "variability chart" });
    expect(screen.getByRole("heading", { level: 3 })).toHaveTextContent("Variability: nested ANOVA and variance components");
    const titles = screen.getAllByRole("heading", { level: 4 }).map((heading) => heading.textContent?.replace(/^[▾▸]\s*/, ""));
    expect(titles).toEqual(["Summary", "Nested ANOVA", `Variance components (${VARCOMP.method})`,
      "Cell summaries", "Factor A summaries", "Variability chart"]);
    // The tables the tool did not show before start collapsed; Expand all opens them.
    expect(screen.getByRole("button", { name: /Cell summaries/, expanded: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getByRole("button", { name: /Cell summaries/, expanded: true })).toBeInTheDocument();
    expect(screen.getByText("Not saved", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy table: Nested ANOVA" })).toBeEnabled();
    const send = screen.getByRole("button", { name: "Send to report: Nested ANOVA" });
    expect(send).toBeDisabled();
    expect(send).toHaveAttribute("title", expect.stringMatching(/^Save the result first/));
    expect(screen.getByRole("button", { name: "Open as worksheet: Cell summaries" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open saved result" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save result" }));
    const saved = useApp.getState().analysisResults[0];
    expect(screen.getByText("Saved", { selector: ".qz-analysis-status" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send to report: Nested ANOVA" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Open as worksheet: Cell summaries" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Open saved result" }));
    expect(useApp.getState().openAnalysisResultId).toBe(saved.id);
    expect(useResultBookRequest.getState().bookFor).toBe(saved.id);
  });

  it("shows the not-estimable note instead of a variance-components table when B(A) can't be estimated", async () => {
    vi.mocked(statsNestedAnova).mockResolvedValue({ ...ANOVA, b_within_a_estimable: false, a_tested_against: "Error" });
    useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1" });
    render(<VariabilityChartPanel />);
    expect(await screen.findByText(/variance components need/)).toBeInTheDocument();
    expect(screen.queryByText(/Variance components \(/)).not.toBeInTheDocument();
    expect(statsVarianceComponents).not.toHaveBeenCalled();
  });

  it("switching Factor A re-fetches with the new grouping", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "wafers.dat", data: DATA }], activeId: "d1" });
    render(<VariabilityChartPanel />);
    await screen.findByText(/Variance components \(/); // the first result has landed
    vi.mocked(statsNestedAnova).mockClear();
    // A distinguishable re-fetch result, so the wait is on what it renders.
    vi.mocked(statsNestedAnova).mockResolvedValue({ ...ANOVA, b_within_a_estimable: false, a_tested_against: "Error" });
    fireEvent.change(screen.getByLabelText("Factor A (outer)"), { target: { value: "1" } });
    expect(await screen.findByText(/variance components need/)).toBeInTheDocument();
    expect(statsNestedAnova).toHaveBeenCalled();
  });
});
