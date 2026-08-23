import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import { reportEmit, statsFitDistributions, statsHistogram, statsShapiro } from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "./DistributionPanel";

vi.mock("../../../lib/api", () => ({
  statsHistogram: vi.fn(),
  statsShapiro: vi.fn(),
  statsFitDistributions: vi.fn(),
  reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({
  statsDescriptive: vi.fn(),
}));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[10], [20], [30], [40], [50], [60]],
  labels: ["v"],
  units: [""],
  metadata: { x_column_name: "T" },
};

const HIST = { counts: [2, 2, 2], centers: [15, 35, 55], edges: [10, 30, 50, 70], n_bins: 3, n: 6 };
const DESC = { N: 6, mean: 35, median: 35, std: 18.7, min: 10, max: 60, q1: 20, q3: 50 };
const NORM = { W: 0.95, p: 0.7, N: 6 };
const FITS = {
  fits: [
    { dist: "normal", params: { mu: 35, sigma: 18.7 }, loglike: -10, aic: 24, n_params: 2, ks_d: 0.1, ks_p: 0.9, ks_p_approximate: true, N: 6 },
  ],
  best: "normal",
  skipped: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue(HIST);
  vi.mocked(statsDescriptive).mockResolvedValue(DESC);
  vi.mocked(statsShapiro).mockResolvedValue(NORM);
  vi.mocked(statsFitDistributions).mockResolvedValue(FITS);
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
  useApp.setState({
    datasets: [],
    activeId: null,
    selection: null,
    distributionOpen: true,
    reports: [],
    status: "",
  });
});

describe("DistributionPanel", () => {
  it("prompts to select a dataset when none is active", () => {
    render(<DistributionPanel />);
    expect(screen.getByText("Select a dataset to profile.")).toBeInTheDocument();
  });

  it("renders the histogram, box strip, stats grid, and normality verdict", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    expect(await screen.findByLabelText("histogram")).toBeInTheDocument();
    expect(screen.getByLabelText("box-quantile strip")).toBeInTheDocument();
    expect(screen.getByTitle("median 35")).toBeInTheDocument();
    expect(await screen.findByText(/Shapiro–Wilk/)).toBeInTheDocument();
  });

  it("picking a fit family shows AIC + KS p once the fit lands", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    fireEvent.change(screen.getByDisplayValue("None"), { target: { value: "normal" } });
    await waitFor(() => expect(statsFitDistributions).toHaveBeenCalled());
    expect(await screen.findByText(/AIC 24/)).toBeInTheDocument();
    expect(screen.getByText(/KS p=0.9/)).toBeInTheDocument();
  });

  it("toggling Compare distributions shows a ranked table with the winner highlighted", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    fireEvent.click(screen.getByText("Compare distributions"));
    await waitFor(() => expect(statsFitDistributions).toHaveBeenCalled());
    // "normal" appears both as a <select> option and the table's row button.
    expect(await screen.findAllByText("normal")).not.toHaveLength(0);
    expect(screen.getByText("winner")).toBeInTheDocument();
    // Compare mode auto-selects the winner, which also drives the overlay readout.
    await waitFor(() => expect(screen.getByText(/AIC 24/)).toBeInTheDocument());
  });

  it("shows a percentile readout for the selected fit once it lands", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    fireEvent.change(screen.getByDisplayValue("None"), { target: { value: "normal" } });
    await waitFor(() => expect(statsFitDistributions).toHaveBeenCalled());
    expect(await screen.findByText(/Percentiles \(normal fit\)/)).toBeInTheDocument();
    expect(screen.getAllByText("median").length).toBeGreaterThan(0);
    expect(screen.getByText("q1")).toBeInTheDocument();
  });

  it("clicking a histogram bar writes the shared row selection", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    const { container } = render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    const bar = container.querySelectorAll(".qzk-hist-bar")[0];
    fireEvent.mouseDown(bar);
    fireEvent.mouseUp(window);
    await waitFor(() =>
      expect(useApp.getState().selection).toEqual({ datasetId: "d1", rows: [0, 1] }),
    );
  });

  it("emits a stats_table report for the current column", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    await screen.findByLabelText("histogram");
    fireEvent.click(await screen.findByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(reportEmit).toHaveBeenCalledWith(expect.objectContaining({ kind: "stats_table" }));
  });
});

// 12 rows: col0 "grp" (3-level nominal), col1 "v" (continuous).
const BY_DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  values: [
    [0, 10], [0, 12], [0, 14], [0, 16],
    [1, 20], [1, 22], [1, 24], [1, 26],
    [2, 30], [2, 32], [2, 34], [2, 36],
  ],
  labels: ["grp", "v"],
  units: ["", ""],
  metadata: {},
};

describe("DistributionPanel — By grouping (JMP_GAP_PLAN J7)", () => {
  it("picking a By column renders one collapsible section per level", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=4/)).toHaveLength(3));
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("collapsing a section hides its histogram but keeps the header", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }], activeId: "d1" });
    const { container } = render(<DistributionPanel />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=4/)).toHaveLength(3));
    expect(container.querySelectorAll(".qzk-hist").length).toBeGreaterThan(0);
    const header = container.querySelectorAll("button[aria-expanded]")[0];
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("emits a per-level report keyed by level label", async () => {
    useApp.setState({ datasets: [{ id: "d1", name: "run.dat", data: BY_DATA }], activeId: "d1" });
    render(<DistributionPanel />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(screen.getAllByText(/n=4/)).toHaveLength(3));
    fireEvent.click(await screen.findByRole("button", { name: "→ Report" }));
    await waitFor(() => expect(useApp.getState().reports).toHaveLength(1));
    expect(reportEmit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "stats_table",
        records: expect.arrayContaining([expect.objectContaining({ level: "0" })]),
      }),
    );
  });
});
