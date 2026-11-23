// An identical re-run of an analysis batch saves no second result (result audit
// row 34, criterion 11); changed data or settings still save a new one.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { captureAnalysisSelection } from "../../../lib/analysisSelection";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { usePendingOps } from "../../../store/pendingOps";
import { useApp } from "../../../store/useApp";
import AnalysisBatchControls from "./AnalysisBatchControls";

const data = (id: string): Dataset => ({
  id, name: `${id}.csv`, data: { time: [0, 1], values: [[1], [2]], labels: ["Y"], units: [""], metadata: {} },
});

beforeEach(() => {
  const datasets = [data("a")];
  useApp.setState({
    datasets, activeId: "a", selectedIds: ["a"], analysisResults: [], openAnalysisResultId: null, history: [], future: [],
    resolveDataset: async (id: string) => useApp.getState().datasets.find((d) => d.id === id) ?? datasets[0],
  });
  useAnalysisSelection.setState({
    toolId: "batch-test",
    selection: captureAnalysisSelection({
      datasets, activeId: "a", selectedIds: ["a"], xKey: null, yKeys: [0], seriesOrder: null, errKeys: {}, selection: null, range: null,
    }, "library"),
  });
  usePendingOps.setState({ ops: [] });
});

async function run(value: number) {
  render(<AnalysisBatchControls toolId="batch-test" label="Test batch" summaryColumns={["N"]} runItem={async () => ({ values: [value] })} />);
  fireEvent.click(screen.getByRole("button", { name: /Batch/ }));
  fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
  await waitFor(() => expect(usePendingOps.getState().ops).toHaveLength(0));
}

describe("AnalysisBatchControls identical re-run", () => {
  it("the second identical run saves nothing new, adds no undo step, and says so", async () => {
    await run(2);
    expect(useApp.getState().analysisResults).toHaveLength(1);
    const history = useApp.getState().history.length;
    fireEvent.click(screen.getByRole("button", { name: "Run Test batch batch" }));
    await waitFor(() => expect(useApp.getState().status).toMatch(/identical to the saved result; nothing was duplicated/));
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().history).toHaveLength(history);
  });

  it("a run with different numbers saves a second result", async () => {
    await run(2);
    cleanup();
    await run(3);
    expect(useApp.getState().analysisResults).toHaveLength(2);
  });
});
