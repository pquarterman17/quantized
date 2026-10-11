import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Dataset } from "../../../lib/types";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import { usePendingOps } from "../../../store/pendingOps";
import AnalysisBatchControls from "./AnalysisBatchControls";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));

const data = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});

beforeEach(() => {
  register.mockReset();
  const datasets = [data("a"), data("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], analysisResults: [], openAnalysisResultId: null,
    history: [], future: [], resolveDataset: async (id: string) => datasets.find((dataset) => dataset.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "batch-test",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [0],
      seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
});

describe("AnalysisBatchControls", () => {
  it("shows preflight before running and saves completed and failed inputs together", async () => {
    const runItem = vi.fn(async (dataset: Dataset) => {
      if (dataset.id === "b") throw new Error("bad calibration");
      return { values: [2] };
    });
    render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={runItem} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    expect(screen.getByText("a.csv")).toBeInTheDocument();
    expect(screen.getByText("b.csv")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(register).toHaveBeenCalledOnce();
    const result = register.mock.calls[0][0];
    expect(result.producer.id).toBe("analysis-batch");
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 2, 2, null],
      ["b.csv", "Failed", 2, null, "bad calibration"],
    ]);
    expect(result.warnings).toContain("b.csv: bad calibration");
  });

  it("guards a rapid repeated Run click", async () => {
    let release!: () => void;
    let first = true;
    const runItem = vi.fn(() => {
      if (!first) return Promise.resolve({ values: [1] });
      first = false;
      return new Promise<{ values: number[] }>((resolve) => { release = () => resolve({ values: [1] }); });
    });
    render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={runItem} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    const button = screen.getByRole("button", { name: "Run Test batch batch" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));
    expect(runItem).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(register).toHaveBeenCalledOnce();
    expect(runItem).toHaveBeenCalledTimes(2); // two inputs, one batch — never four from a duplicate start
  });

  it("finishes the in-flight input then cancels every input not yet started", async () => {
    let release!: () => void;
    const runItem = vi.fn(() => new Promise<{ values: number[] }>((resolve) => {
      release = () => resolve({ values: [7] });
    }));
    render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={runItem} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(1));

    usePendingOps.getState().ops[0].cancel?.();
    release();

    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(register).toHaveBeenCalledOnce();
    const result = register.mock.calls[0][0];
    expect(runItem).toHaveBeenCalledTimes(1);
    expect(result.tables[0].rows).toEqual([
      ["a.csv", "Completed", 2, 7, null],
      ["b.csv", "Cancelled", 2, null, null],
    ]);
    expect(result.warnings[0]).toBe("Batch cancelled: 1 of 2 inputs were not started.");
    expect(usePendingOps.getState().ops).toHaveLength(0);
  });

  it("records a lazy-load rejection as one failed input and continues the batch", async () => {
    const datasets = useApp.getState().datasets;
    useApp.setState({
      resolveDataset: async (id: string) => {
        if (id === "a") throw new Error("source drive unavailable");
        return datasets.find((dataset) => dataset.id === id);
      },
    });
    const runItem = vi.fn(async () => ({ values: [9] }));
    render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={runItem} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));

    await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
    expect(register).toHaveBeenCalledOnce();
    expect(runItem).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][0].tables[0].rows).toEqual([
      ["a.csv", "Failed", 2, null, "source drive unavailable"],
      ["b.csv", "Completed", 2, 9, null],
    ]);
  });
});
