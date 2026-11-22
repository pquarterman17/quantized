// Characterization (lane BY, written BEFORE the shared batch/By changes): the
// single-run defaults of the statistics tools that gain batch or By, and the
// existing shared batch / By shells, as they behaved on main. These must keep
// passing unchanged after the migration: new behaviour is opt-in.

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset, DataStruct } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import ByLevelRunSection from "../byrun/ByLevelRunSection";
import AnalysisBatchControls from "./AnalysisBatchControls";

const { register } = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("../../../store/analysisResultActions", () => ({ registerAnalysisResult: register }));

// Column 0 = Group (two levels), column 1 = Signal.
const DATA: DataStruct = {
  time: [0, 1, 2, 3, 4, 5],
  values: [[0, 1], [0, 2], [0, 3], [1, 10], [1, 11], [1, 12]],
  labels: ["Group", "Signal"],
  units: ["", ""],
  metadata: {},
};
const sheet = (id: string): Dataset => ({ id, name: `${id}.csv`, data: DATA, channelTypes: { 0: "nominal" } });

// The run's last act is its status line: wait on that state, then read the result.
const finished = () => waitFor(() => expect(useApp.getState().status).toMatch(/batch finished/));

beforeEach(() => {
  register.mockReset();
  const datasets = [sheet("a"), sheet("b")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [1], seriesOrder: null,
    selection: null, analysisResults: [], history: [], future: [], status: "",
    resolveDataset: async (id: string) => datasets.find((dataset) => dataset.id === id),
  });
  usePendingOps.setState({ ops: [] });
});

describe("shared batch shell (before lane BY)", () => {
  it("narrows each worksheet to its selected rows by default", async () => {
    useAnalysisSelection.setState({
      toolId: "char-test",
      selection: captureAnalysisSelection({
        datasets: useApp.getState().datasets, activeId: "a", selectedIds: ["a", "b"], xKey: null, yKeys: [1],
        seriesOrder: null, errKeys: {}, selection: { datasetId: "a", rows: [0, 1] }, range: null,
      }, "library"),
    });
    const runItem = vi.fn(async () => ({ values: [1] }));
    render(<AnalysisBatchControls toolId="char-test" label="Char" summaryColumns={["N"]} runItem={runItem} />);
    fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
    fireEvent.click(screen.getByRole("button", { name: "Run Char batch" }));
    await finished();
    // Rows: a has 2 selected rows, b every row.
    const saved = register.mock.calls[0]![0] as AnalysisResult;
    expect(saved.tables![0]!.rows.map((row) => row[2])).toEqual([2, 6]);
  });

  it("renders nothing when the tool owns no selection", () => {
    useAnalysisSelection.setState({ toolId: "someone-else", selection: null });
    const { container } = render(<AnalysisBatchControls toolId="char-test" label="Char" summaryColumns={["N"]} runItem={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("shared By section (before lane BY)", () => {
  it("is display-only: one row per level and nothing is recorded", async () => {
    render(
      <ByLevelRunSection
        tool="Char" active={sheet("a")} data={DATA} columns={[{ index: 0, label: "Group" }]}
        headers={["Max"]} runKey="k"
        run={async (level) => [Math.max(...level.data.values.map((row) => row[1]))]}
      />,
    );
    fireEvent.change(screen.getByLabelText("Char By (optional)"), { target: { value: "0" } });
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3));
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });
});
