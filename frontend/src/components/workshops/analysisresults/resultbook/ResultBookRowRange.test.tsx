// Acceptance 8 W1: the Result book's input line states the RECORDED row window, like the Overview, not the live sheet.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "../AnalysisResultPanel";
import type { Dataset } from "../../../../lib/types";
import { useAnalysisSelection } from "../../../../store/analysisSelection";
import { publishDistributionResult } from "../../../../store/distributionResults";
import { openWorksheetRowRange } from "../../../../store/worksheetAnalysisHandoff";
import { useApp } from "../../../../store/useApp";

const SHEET: Dataset = {
  id: "d1", name: "st12.csv",
  data: { time: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], values: [[1], [2], [3], [4], [5], [6], [7], [8], [9], [10], [11], [12]], labels: ["v"], units: [""], metadata: {} },
  excludedRows: [5, 6],
};
const recipe = { col: 0, byCol: null, fitDist: "none", compareOpen: false, percentileInput: 90 } as const;
const snapshot = {
  label: "v", byLabel: null, hist: null, desc: null, norm: null, normNote: null, levels: [], rankedFits: [],
  rankingMetric: "aicc", quantiles: null, percentileValue: null, skipped: [], totalLevelCount: 0,
} as never;

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({ datasets: [SHEET], activeId: "d1", analysisResults: [], openAnalysisResultId: null, history: [], future: [], status: "", staleDatasets: [], stageTab: "plot" });
});

describe("result book input line", () => {
  it("names the recorded window and its counts, even after the live range is cleared", () => {
    openWorksheetRowRange("d1", [4, 5, 6, 7, 8, 9]); // rows 5-10
    const saved = publishDistributionResult(SHEET, recipe, snapshot);
    expect(saved).not.toBeNull();
    useAnalysisSelection.getState().updateItem("d1", { rowRange: null });
    useApp.setState({ openAnalysisResultId: useApp.getState().analysisResults[0]!.id });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
    const line = within(screen.getByRole("tabpanel")).getByLabelText("Analysis input");
    expect(line).toHaveTextContent("rows 5-10 · 4 of 6 rows (2 excluded)");
    expect(line).not.toHaveTextContent("10 of 12");
  });
});
