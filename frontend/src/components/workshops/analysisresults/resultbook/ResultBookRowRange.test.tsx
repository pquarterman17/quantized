// Acceptance 8 W1: the Result book's input line states the RECORDED row window, like the Overview, not the live sheet.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "../AnalysisResultPanel";
import type { Dataset } from "../../../../lib/types";
import { useAnalysisSelection } from "../../../../store/analysisSelection";
import { publishDistributionResult } from "../../../../store/distributionResults";
import { openWorksheetRowRange } from "../../../../store/worksheetAnalysisHandoff";
import { INPUT_ROW_RANGE_KEY } from "../../../../lib/rowSidecars";
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

describe("Open as worksheet on a saved ranged result", () => {
  it("a second click opens the same sheet (already added), and the sheet records the range", async () => {
    openWorksheetRowRange("d1", [4, 5, 6, 7, 8, 9]);
    publishDistributionResult(SHEET, recipe, snapshot);
    useAnalysisSelection.getState().updateItem("d1", { rowRange: null });
    const id = useApp.getState().analysisResults[0]!.id;
    const open = async () => {
      useApp.setState({ openAnalysisResultId: id });
      render(<AnalysisResultPanel />);
      fireEvent.click(screen.getByRole("tab", { name: "Result book" }));
      const buttons = within(screen.getByRole("tabpanel")).getAllByRole("button", { name: /^Open as worksheet:/ });
      fireEvent.click(buttons.find((b) => !(b as HTMLButtonElement).disabled)!);
      await waitFor(() => expect(useApp.getState().openAnalysisResultId).toBeNull());
      cleanup();
    };
    await open();
    const made = () => useApp.getState().datasets.filter((d) => d.id !== "d1");
    expect(made()).toHaveLength(1);
    expect(made()[0]!.data.metadata).toHaveProperty(INPUT_ROW_RANGE_KEY);
    await open();
    expect(made()).toHaveLength(1);
    expect(useApp.getState().status).toMatch(/already added/);
    expect(useApp.getState().worksheetId).toBe(made()[0]!.id);
  });
});
