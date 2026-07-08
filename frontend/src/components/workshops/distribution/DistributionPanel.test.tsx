import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  statsDescriptive,
  statsFitDistributions,
  statsHistogram,
  statsShapiro,
} from "../../../lib/api";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "./DistributionPanel";

vi.mock("../../../lib/api", () => ({
  statsHistogram: vi.fn(),
  statsDescriptive: vi.fn(),
  statsShapiro: vi.fn(),
  statsFitDistributions: vi.fn(),
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
  useApp.setState({ datasets: [], activeId: null, selection: null, distributionOpen: true });
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
});
