// Batch shell, lane WB5: a finished table says "Out of date" once the
// worksheets asked for, the data of a worksheet that ran, or (settingsChange
// "mark") the tool's settings change, and withholds the summary worksheet and
// the tool's follow-ups until the batch is run again.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import AnalysisBatchControls from "./AnalysisBatchControls";

vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: vi.fn() }));

const data = (id: string): Dataset => ({
  id, name: `${id}.csv`,
  data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});

function seed(ids: string[]) {
  const datasets = [data("a"), data("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ids, analysisResults: [], openAnalysisResultId: null,
    history: [], future: [], resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id),
  });
  useAnalysisSelection.setState({
    toolId: "batch-test",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ids, xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
}

beforeEach(() => {
  seed(["a", "b"]);
  usePendingOps.setState({ ops: [] });
});

const props = { toolId: "batch-test", label: "Test batch", summaryColumns: ["N"], runItem: async () => ({ values: [1] }) };

async function ran(extra: Partial<Parameters<typeof AnalysisBatchControls>[0]> = {}) {
  const onSummarySheet = vi.fn();
  const view = render(<AnalysisBatchControls {...props} onSummarySheet={onSummarySheet} afterRun={() => <p>after run</p>} {...extra} />);
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
  await screen.findByRole("button", { name: "Create summary worksheet" });
  return { onSummarySheet, ...view };
}

describe("AnalysisBatchControls out of date", () => {
  it("characterization: a fresh table offers the summary and the follow-ups, with no marker", async () => {
    await ran();
    expect(screen.queryByText(/Out of date/)).toBeNull();
    expect(screen.getByText("after run")).toBeInTheDocument();
  });

  it("an edit to a worksheet that ran marks the table and withholds the summary and follow-ups", async () => {
    await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? { ...d, excludedRows: [0] } : d)) })));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create summary worksheet" })).toBeNull();
    expect(screen.queryByText("after run")).toBeNull();
  });

  it("a different worksheet selection marks the table", async () => {
    await ran();
    act(() => useAnalysisSelection.setState((s) => ({
      selection: { ...s.selection!, items: s.selection!.items.filter((i) => i.datasetId === "a") },
    })));
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create summary worksheet" })).toBeNull();
  });

  it("an unrelated edit (a rename) is not an input", async () => {
    await ran();
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "b" ? { ...d, name: "renamed.csv" } : d)) })));
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("settingsChange mark: a settings change keeps the table, marks it, and running again clears the mark", async () => {
    const { rerender } = await ran({ settingsKey: "m1", settingsChange: "mark" });
    rerender(<AnalysisBatchControls {...props} settingsKey="m2" settingsChange="mark" onSummarySheet={vi.fn()} />);
    expect(screen.getByText(/Out of date/)).toBeInTheDocument();
    expect(screen.getAllByText("Completed").length).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await waitFor(() => expect(screen.queryByText(/Out of date/)).toBeNull());
  });

  it("the default drop still drops the table on a settings change (unchanged)", async () => {
    const { rerender } = await ran({ settingsKey: "m1" });
    rerender(<AnalysisBatchControls {...props} settingsKey="m2" />);
    expect(screen.queryByText("Completed")).toBeNull();
    expect(screen.queryByText(/Out of date/)).toBeNull();
  });

  it("forced race: a worksheet edited while the batch runs leaves the finished table out of date", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let began!: () => void;
    const started = new Promise<void>((r) => { began = r; });
    const runItem = async () => { began(); await gate; return { values: [1] }; };
    render(<AnalysisBatchControls {...props} runItem={runItem} onSummarySheet={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await started;
    act(() => useApp.setState((s) => ({ datasets: s.datasets.map((d) => (d.id === "a" ? { ...d, excludedRows: [1] } : d)) })));
    release();
    await waitFor(() => expect(screen.getByText(/Out of date/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Create summary worksheet" })).toBeNull();
  });
});
