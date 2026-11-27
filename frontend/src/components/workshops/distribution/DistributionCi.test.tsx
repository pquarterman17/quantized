// Distribution workshop: the confidence-interval section. The request is built
// from the analysis view (an excluded row is left out), the level and the
// bootstrap switch change it, the exact median coverage is on screen, a refusal
// is shown instead of a table, and Copy table puts the rows on the clipboard.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { reportEmit, statsFitDistributions, statsHistogram, statsShapiro } from "../../../lib/api";
import { statsConfidenceIntervals, type CiResult } from "../../../lib/api/statsCi";
import { statsDescriptive } from "../../../lib/api/statsDescriptive";
import type { DataStruct } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import DistributionPanel from "./DistributionPanel";
import { ciTableText } from "./useDistributionCi";

vi.mock("../../../lib/api", () => ({
  statsHistogram: vi.fn(), statsShapiro: vi.fn(), statsFitDistributions: vi.fn(), reportEmit: vi.fn(),
}));
vi.mock("../../../lib/api/statsDescriptive", () => ({ statsDescriptive: vi.fn() }));
vi.mock("../../../lib/api/statsCi", () => ({ statsConfidenceIntervals: vi.fn() }));

const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5], values: [[10], [20], [30], [40], [50], [999]],
  labels: ["v"], units: [""], metadata: { x_column_name: "T" },
};

const row = (statistic: string, method: string, estimate: number, low: number | null, high: number | null, level: number, note: string | null = null) =>
  ({ statistic, method, estimate, low, high, level, note });
const CI = (bootstrap: boolean): CiResult => ({
  n: 5, n_dropped: 0, level: 0.9, bootstrap: bootstrap ? { seed: 20260101, resamples: 10000 } : null,
  rows: [
    row("mean", "t interval", 30, 15, 45, 0.9, "Assumes the mean is approximately normal (exact for normal data)."),
    row("median", "order statistics (distribution-free)", 30, 10, 50, 0.9375, "Exact coverage 93.75% (rank 1 to 5)."),
    row("variance", "chi-square interval", 250, 100, 1000, 0.9, "Assumes normal data; sensitive to departures from normality."),
    ...(bootstrap ? [row("mean", "bootstrap percentile", 30, 20, 40, 0.9, "Percentile interval from 10000 resamples, seed 20260101.")] : []),
  ],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(statsHistogram).mockResolvedValue({ counts: [2, 3], centers: [15, 35], edges: [10, 30, 50], n_bins: 2, n: 5 });
  vi.mocked(statsDescriptive).mockResolvedValue({ N: 5, mean: 30, median: 30, std: 15, min: 10, max: 50, q1: 20, q3: 40 });
  vi.mocked(statsShapiro).mockResolvedValue({ W: 0.95, p: 0.7, N: 5 });
  vi.mocked(statsFitDistributions).mockResolvedValue({ fits: [], best: "", skipped: [] });
  vi.mocked(reportEmit).mockResolvedValue({ report: { title: "t", sections: [] } });
  vi.mocked(statsConfidenceIntervals).mockImplementation(async (_x, _level, bootstrap) => CI(bootstrap));
  // Row 5 (value 999) is excluded: the intervals must be of the analysis view.
  useApp.setState({
    datasets: [{ id: "d1", name: "run.dat", data: DATA, excludedRows: [5] }], activeId: "d1",
    selection: null, distributionOpen: true, reports: [], status: "", analysisResults: [], history: [], future: [],
  });
});

const lastCall = () => vi.mocked(statsConfidenceIntervals).mock.calls.at(-1)!;

describe("Distribution confidence intervals", () => {
  it("asks for 95% of the analysis view by default and shows the table with exact median coverage", async () => {
    render(<DistributionPanel />);
    expect(await screen.findByText("order statistics (distribution-free)")).toBeInTheDocument();
    const [x, level, bootstrap] = vi.mocked(statsConfidenceIntervals).mock.calls[0]!;
    expect([...x]).toEqual([10, 20, 30, 40, 50]); // 999 is excluded
    expect([level, bootstrap]).toEqual([0.95, false]);
    expect(screen.getByText("93.75%")).toBeInTheDocument();
    expect(screen.getByText(/Exact coverage 93.75%/)).toBeInTheDocument();
    expect(screen.getByText(/Assumes normal data/)).toBeInTheDocument();
  });

  it("re-asks at the typed level and with the bootstrap rows when switched on", async () => {
    render(<DistributionPanel />);
    await screen.findByText("order statistics (distribution-free)");
    const level = screen.getByLabelText("Confidence level");
    fireEvent.change(level, { target: { value: "90" } });
    fireEvent.keyDown(level, { key: "Enter" });
    await waitFor(() => expect(lastCall()[1]).toBeCloseTo(0.9, 12));
    fireEvent.click(screen.getByText("Bootstrap intervals"));
    expect(await screen.findByText("bootstrap percentile")).toBeInTheDocument();
    expect(lastCall()[2]).toBe(true);
    expect(screen.getByText(/seed 20260101/)).toBeInTheDocument();
  });

  it("shows the reason instead of a table when the backend refuses", async () => {
    vi.mocked(statsConfidenceIntervals).mockRejectedValue(new Error("the bootstrap is limited to 20000 values"));
    render(<DistributionPanel />);
    expect(await screen.findByText(/bootstrap is limited to 20000/)).toBeInTheDocument();
    expect(screen.queryByText("t interval")).toBeNull();
  });

  it("copies the table as text", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<DistributionPanel />);
    await screen.findByText("order statistics (distribution-free)");
    fireEvent.click(screen.getByRole("button", { name: "Copy table" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toBe(ciTableText(CI(false).rows, 95));
    expect(text).toContain("median\torder statistics (distribution-free)\t30\t10\t50\t93.75");
    await waitFor(() => expect(useApp.getState().status).toBe("copied the confidence intervals"));
  });
});
