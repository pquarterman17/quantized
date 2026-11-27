// OG20: the panel of a committed output worksheet names the source rows its tool read (recorded in the output's
// private metadata key), and shows no such line for an output that read every row.
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));

import { analysisDataFingerprint } from "../../../lib/analysisResultFreshness";
import type { Dataset } from "../../../lib/types";
import { useAnalysisSelection } from "../../../store/analysisSelection";
import { commitComputedOutput } from "../../../store/commitComputedOutput";
import { useApp } from "../../../store/useApp";
import { openWorksheetRowRange } from "../../../store/worksheetAnalysisHandoff";
import AnalysisResultPanel from "./AnalysisResultPanel";

const SHEET: Dataset = {
  id: "d1", name: "run.csv",
  data: { time: [0, 1, 2, 3, 4, 5], values: [[1], [2], [3], [4], [5], [6]], labels: ["v"], units: [""], metadata: {} },
};
const commit = () => commitComputedOutput({
  producer: { id: "tabulate", label: "Tabulate", version: 1 }, sources: [{ id: "d1", computedOn: analysisDataFingerprint(SHEET) }],
  settings: { a: 1 }, name: "out", data: { time: [0], values: [[1]], labels: ["o"], units: [""], metadata: {} },
});

beforeEach(() => {
  useAnalysisSelection.setState({ toolId: null, selection: null });
  useApp.setState({ datasets: [SHEET], activeId: "d1", analysisResults: [], history: [], future: [], status: "", staleDatasets: [], openAnalysisResultId: null });
});

describe("the result panel of a committed output", () => {
  it("says which rows were read when the tool ran on a range", async () => {
    openWorksheetRowRange("d1", [1, 2, 3]);
    expect(commit()).toMatchObject({ kind: "created" });
    useApp.setState({ openAnalysisResultId: useApp.getState().analysisResults[0]!.id });
    render(<AnalysisResultPanel />);
    expect(await screen.findByText("rows 2-4 of 6 (when saved)")).toBeInTheDocument();
  });

  it("shows no input-rows line when the tool read every row", async () => {
    expect(commit()).toMatchObject({ kind: "created" });
    useApp.setState({ openAnalysisResultId: useApp.getState().analysisResults[0]!.id });
    render(<AnalysisResultPanel />);
    await screen.findByText("Source");
    expect(screen.queryByText("Input rows")).toBeNull();
  });
});
