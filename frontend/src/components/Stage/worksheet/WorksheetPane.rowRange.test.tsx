// "Use as row range" (ROW_RANGE_CONTRACT 3.4, slice R1): the worksheet's selected
// rows, when they are ONE contiguous block, become the analysis input's row
// window; a selection with gaps is refused with the reason. Through the real
// pane, the real stores and the resolver.
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { analysisInputSummary, resolveAnalysisInputs, ROW_POLICY } from "../../../lib/analysisInputs";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { useApp } from "../../../store/useApp";
import WorksheetPane from "./WorksheetPane";

const n = 48;
const dataset: Dataset = {
  id: "d",
  name: "run.dat",
  data: {
    time: Array.from({ length: n }, (_v, i) => i),
    values: Array.from({ length: n }, (_v, i) => [i * 10]),
    labels: ["A"], units: ["V"], metadata: {},
  },
  excludedRows: [22, 30, 40],
};

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({
    datasets: [dataset], activeId: "d", worksheetId: null, worksheetSelections: {}, status: "", stageTab: "worksheet",
    selection: { datasetId: "d", rows: Array.from({ length: 24 }, (_v, i) => 20 + i) },
  });
});

describe("worksheet Use as row range", () => {
  it("sets the contiguous selection as the analysis row range and opens the Analysis Center on it", () => {
    render(<WorksheetPane datasetId="d" />);
    fireEvent.click(screen.getByRole("button", { name: "Use as row range" }));
    const state = useAnalysisSelection.getState();
    expect(state.selection?.source).toBe("worksheet");
    const item = state.selection!.items[0];
    expect(item.rowRange).toEqual({ from: 20, to: 43 });
    expect(item.rowIds).toBeNull(); // a window, not a picked set
    expect(useApp.getState().stageTab).toBe("analysis");
    expect(useApp.getState().status).toMatch(/rows 21-44 set as the analysis row range/);
    const inputs = resolveAnalysisInputs({ datasets: [dataset], activeId: "d", selection: item, policy: ROW_POLICY.selection });
    expect(analysisInputSummary(inputs)).toMatch(/rows 21-44 · 21 of 24 rows \(3 excluded\)$/);
  });

  it("is disabled for a selection with gaps and names the gaps", () => {
    useApp.setState({ selection: { datasetId: "d", rows: [2, 3, 4, 5, 6, 7, 8, 13] } });
    render(<WorksheetPane datasetId="d" />);
    const button = screen.getByRole("button", { name: "Use as row range" });
    expect(button).toBeDisabled();
    expect(button.getAttribute("title")).toBe("Use as row range: the selection has gaps (rows 3-9, 14): use Extract rows, or Exclude others");
    expect(useAnalysisSelection.getState().selection).toBeNull();
  });
});
