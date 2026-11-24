// Baseline over the shared AnalysisSelection contract: the same method and
// settings estimated on every selected worksheet, one result table, no writes.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { baselineALS } from "../../../lib/api/baseline";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import BaselineBatchSection from "./BaselineBatchSection";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));
vi.mock("../../../lib/api/baseline", () => ({
  baselineALS: vi.fn(), baselineAnchor: vi.fn(), baselineEstimate: vi.fn(), baselineModPoly: vi.fn(),
  baselineRegion: vi.fn(), baselineRollingBall: vi.fn(), baselineShirley: vi.fn(), baselineXrdLowAngle: vi.fn(),
}));

const sheet = (id: string, offset: number): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1, 2, 3, 4], values: [[offset], [offset + 1], [offset + 2], [offset + 1], [offset]], labels: ["Y"], units: [""], metadata: {} },
});
const params = { lam: 1e6, p: 0.01, radius: 100, order: 5, maxWindowDeg: 2, regionXMin: NaN, regionXMax: NaN, regionYMin: NaN, regionYMax: NaN, maxIter: 50, anchorMethod: "pchip" };

beforeEach(() => {
  vi.clearAllMocks();
  const datasets = [sheet("a", 10), sheet("b", 20)];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0], seriesOrder: null,
    analysisResults: [], history: [], future: [], resolveDataset: async (id: string) => datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "baseline",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
});

describe("BaselineBatchSection", () => {
  it("states that the batch row rule differs from the single Estimate (excluded rows left out vs every row)", () => {
    render(<BaselineBatchSection b={{ method: "als", params }} />);
    expect(screen.getByTestId("baseline-batch-rows-note")).toHaveTextContent(
      /batch table above leaves out excluded and filtered-out rows.*single Estimate and .Apply to N selected. use every row/,
    );
    expect(screen.getByRole("button", { name: /^Input for batch runs/ })).toBeInTheDocument();
  });

  it("runs the chosen method over each selected worksheet and records one result table", async () => {
    vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map((v) => v - 1) }) as never);
    render(<BaselineBatchSection b={{ method: "als", params }} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Baseline batch" }));
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    expect(register).toHaveBeenCalledOnce();
    expect(vi.mocked(baselineALS).mock.calls.map(([req]) => req.y[0])).toEqual([10, 20]);
    const result = register.mock.calls[0]![0];
    expect(result.parameters).toMatchObject({ toolId: "baseline", method: "als" });
    expect(result.tables[0].columns).toEqual(["Worksheet", "Status", "Rows", "Baseline min", "Baseline max", "Residual RMS", "Warnings"]);
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 5, 9, 11, 1, null],
      ["b.csv", "Completed", 5, 19, 21, 1, null],
    ]);
  });

  it("does not run the hand-placed anchor method and says why", () => {
    render(<BaselineBatchSection b={{ method: "anchor", params }} />);
    expect(screen.getByText(/placed by hand on one curve/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    expect(screen.getByRole("button", { name: "Run Baseline batch" })).toBeDisabled();
    expect(baselineALS).not.toHaveBeenCalled();
  });
});

describe("BaselineBatchSection settings change", () => {
  it("drops the finished table when the method settings change, and keeps it when they do not", async () => {
    vi.mocked(baselineALS).mockImplementation(async ({ y }) => ({ baseline: y.map((v) => v - 1) }) as never);
    const { rerender } = render(<BaselineBatchSection b={{ method: "als", params }} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Baseline batch" }));
    await waitFor(() => expect(screen.getAllByText("Completed")).toHaveLength(2));
    rerender(<BaselineBatchSection b={{ method: "als", params: { ...params } }} />);
    expect(screen.getAllByText("Completed")).toHaveLength(2); // same settings: kept
    rerender(<BaselineBatchSection b={{ method: "als", params: { ...params, lam: 1e3 } }} />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    expect(register).toHaveBeenCalledOnce(); // the saved result itself is untouched
  });
});
