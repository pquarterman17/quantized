// The result workspace withholds a dataset-resident record that is not the one
// the result recorded (acceptance C9, audit row 35), and reads a multi-output
// result as out of date when ANY of its outputs is (C13, rows 26/27).

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import { fitAnalysisResult } from "../../../lib/fitAnalysisResultLive";
import { recordChangedText } from "../../../lib/resultInputsRecord";
import type { Dataset, FitSpec } from "../../../lib/types";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { exportAnalysisFitTable } from "../../../store/analysisResultActions";
import { useApp } from "../../../store/useApp";

const SPEC: FitSpec = { model: "Linear", xKey: null, yKey: 0, params: [2, 1], nPoints: 3, range: [0, 2], fittedAt: "2026-11-23T00:00:00Z" };
const source: Dataset = {
  id: "src", name: "Trace", fitSpec: SPEC,
  data: { time: [0, 1, 2], values: [[1], [3], [5]], labels: ["Signal"], units: ["V"], metadata: {} },
};

beforeEach(() => {
  useApp.setState({
    datasets: [source], activeId: "src", analysisResults: [fitAnalysisResult(source, SPEC)], openAnalysisResultId: null,
    staleDatasets: [], staleFits: [], recalcMode: "manual", history: [], future: [],
  });
});

describe("the result workspace and the record it points at", () => {
  it("shows the recorded fit while it is the same record", () => {
    useApp.setState({ openAnalysisResultId: "analysis-fit-src" });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("a different fit on the worksheet is withheld as 'Record changed', with the reason", () => {
    useApp.setState((s) => ({
      datasets: s.datasets.map((d) => ({ ...d, fitSpec: { ...SPEC, params: [9, 9] } })),
      openAnalysisResultId: "analysis-fit-src",
    }));
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Record changed")).toBeInTheDocument();
    expect(screen.queryByText("9")).not.toBeInTheDocument();
    useApp.setState({ openAnalysisResultId: null });
    expect(recordChangedText("fitSpec")).toMatch(/not the one this result recorded/);
  });

  it("the fit-table export refuses a record that is not the recorded one", async () => {
    useApp.setState((s) => ({ datasets: s.datasets.map((d) => ({ ...d, fitSpec: { ...SPEC, params: [9, 9] } })) }));
    expect(await exportAnalysisFitTable("analysis-fit-src")).toBe(false);
    expect(useApp.getState().status).toMatch(/not the one it recorded/);
  });

  it("a multi-output result reads Out of date when a non-primary output is stale", () => {
    const outputs: Dataset[] = ["a", "b"].map((id) => ({ ...source, id, name: `part ${id}`, fitSpec: undefined }));
    const multi: AnalysisResult = {
      version: 1, id: "multi", name: "Curves", producer: { id: "reflectivity-fit-curves", label: "Reflectivity fit curves", version: 1 },
      sources: [{ datasetId: "src", role: "input" }],
      outputs: [{ datasetId: "a", role: "linked-worksheet", part: "model" }, { datasetId: "b", role: "linked-worksheet", part: "sld" }],
      parameters: { commitKey: "k" }, warnings: [], createdAt: "2026-11-23T00:00:00Z",
    };
    useApp.setState((s) => ({ datasets: [...s.datasets, ...outputs], analysisResults: [multi], staleDatasets: ["b"], openAnalysisResultId: "multi" }));
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
  });
});
