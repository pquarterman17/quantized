import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";

const { rerun, recalculate } = vi.hoisted(() => ({ rerun: vi.fn(), recalculate: vi.fn() }));
vi.mock("../../../store/signalWorksheetCommand", () => ({ createSignalWorksheetFromApp: rerun }));
vi.mock("../../../store/analysisResultActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../store/analysisResultActions")>()),
  recalculateAnalysisResult: recalculate,
}));
vi.mock("../../overlays/ConfirmDialog", () => ({ askConfirm: vi.fn() }));
vi.mock("../../overlays/ParamDialog", () => ({ askParams: vi.fn() }));
vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { useApp } from "../../../store/useApp";

const appState = useApp.getState;

const source: Dataset = {
  id: "source",
  name: "Raw trace",
  data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: ["V"], metadata: { xLabel: "Time" } },
};
const output: Dataset = {
  id: "output",
  name: "Smoothed trace",
  data: { time: [0, 1], values: [[1.1], [1.9]], labels: ["Signal"], units: ["V"], metadata: { xLabel: "Time" } },
  derivedFrom: { datasetId: "source", pipeline: "Smooth" },
  analysisRecipe: {
    kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "s",
    channels: [{ index: 0, label: "Signal", unit: "V" }],
    params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  },
};
const result: AnalysisResult = {
  version: 1,
  id: "result",
  name: "Smooth · Raw trace",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "source", role: "input" }],
  outputs: [{ datasetId: "output", role: "linked-worksheet" }],
  selection: { datasetId: "source", channels: [{ index: 0, label: "Signal", unit: "V" }] },
  settingsRef: { datasetId: "output", field: "analysisRecipe" },
  tableRefs: [{ datasetId: "output", label: "Smoothed trace" }],
  warnings: [],
  createdAt: "2026-10-08T00:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  rerun.mockResolvedValue("copy");
  useApp.setState({
    datasets: [source, output],
    activeId: "source",
    analysisResults: [result],
    openAnalysisResultId: "result",
    staleDatasets: [],
    history: [],
    future: [],
  });
});

describe("AnalysisResultPanel", () => {
  it("opens a durable result with overview, tabular output, and provenance", () => {
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Raw trace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
    expect(screen.getByText("1.9")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Provenance" }));
    expect(screen.getByText("output.analysisRecipe")).toBeInTheDocument();
  });

  it("shows the selection from the output's recipe (the authority), not a stale envelope copy", () => {
    // bindSignalRecipe rewrites output.analysisRecipe when source columns are
    // renamed/rebound; the overview must follow it (PR #554 review).
    const rebound = {
      ...output,
      analysisRecipe: {
        ...output.analysisRecipe!,
        channels: [{ index: 0, label: "Rebound", unit: "V" }],
        params: { ...(output.analysisRecipe as { params: object }).params, xTrimMin: 0.25, xTrimMax: 0.75 },
      },
    } as Dataset;
    useApp.setState({ datasets: [source, rebound] });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Rebound")).toBeInTheDocument();
    expect(screen.queryByText("Signal")).not.toBeInTheDocument();
    expect(screen.getByText("0.25 to 0.75")).toBeInTheDocument();
  });

  it("supports standard arrow-key navigation between result tabs", () => {
    render(<AnalysisResultPanel />);
    const overview = screen.getByRole("tab", { name: "Overview" });
    overview.focus();
    fireEvent.keyDown(overview, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Table" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("columnheader", { name: "Time" })).toBeInTheDocument();
  });

  it("Recalculate runs this result's own recompute, never the project-wide recalcNow", async () => {
    const recalcNow = vi.fn(async () => {});
    useApp.setState({ recalcNow });
    recalculate.mockImplementation(async () => {
      useApp.setState({ status: "recalculated Smooth · Raw trace" });
      return true;
    });
    render(<AnalysisResultPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Recalculate" }));
    await waitFor(() => expect(appState().status).toBe("recalculated Smooth · Raw trace"));
    expect(recalculate).toHaveBeenCalledWith("result");
    expect(recalcNow).not.toHaveBeenCalled();
  });

  it("keeps a broken result inspectable and disables actions that require missing data", () => {
    useApp.setState({ datasets: [], analysisResults: [{ ...result, warnings: ["Saved warning"] }] });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open worksheet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeDisabled();
    fireEvent.click(screen.getByRole("tab", { name: /Diagnostics/ }));
    expect(screen.getByText("Saved warning")).toBeInTheDocument();
    expect(screen.getByText(/Source worksheet source is missing/)).toBeInTheDocument();
  });
});
