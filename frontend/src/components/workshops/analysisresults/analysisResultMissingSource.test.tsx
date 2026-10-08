// Owner decision (batch 34): a signal result whose SOURCE worksheet is gone is
// KEPT and FLAGGED, never dropped. Two ways to get there must agree:
//   1. an older .dwk (no `analysisResults` key) whose signal output names a
//      source that is not in the file — the legacy migration;
//   2. deleting the source in a live session — and undoing that delete.
// Both show the same missing-source state; the output worksheet stays
// openable; the state is derived from the refs, so it clears the moment the
// source is back, and the record round-trips a save unchanged.

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { useApp } from "../../../store/useApp";

const MISSING = "Source data not found — results can't be recalculated.";
const data = (v: number): Dataset["data"] => ({ time: [0, 1], values: [[v], [v + 1]], labels: ["Signal"], units: ["V"], metadata: {} });
const source: Dataset = { id: "source", name: "Raw trace", data: data(1) };
const output: Dataset = {
  id: "output",
  name: "Smoothed trace",
  data: data(1),
  derivedFrom: { datasetId: "source", pipeline: "Smooth" },
  analysisRecipe: {
    kind: "signal-correction", version: 1, operation: "Smooth", xUnit: "s",
    channels: [{ index: 0, label: "Signal", unit: "V" }],
    params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
  },
};
const result: AnalysisResult = {
  version: 1,
  id: "analysis-output",
  name: "Smooth · Raw trace",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "source", role: "input" }],
  outputs: [{ datasetId: "output", role: "linked-worksheet" }],
  settingsRef: { datasetId: "output", field: "analysisRecipe" },
  warnings: [],
  createdAt: "2026-10-08T00:00:00Z",
};

type Doc = { datasets: { id: string }[]; analysisResults?: unknown; savedAt?: string };

beforeEach(() => {
  useApp.setState({
    datasets: [source, output],
    activeId: "source",
    analysisResults: [result],
    openAnalysisResultId: null,
    staleDatasets: [],
    staleFits: [],
    recalcMode: "manual",
    history: [],
    future: [],
  });
});

function reopen(edit?: (doc: Doc) => void): void {
  const doc = JSON.parse(serializeWorkspace({ ...useApp.getState() })) as Doc;
  edit?.(doc);
  useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
}

/** An older file: written before result envelopes, and missing the source. */
function openLegacyFileWithoutSource(): void {
  reopen((doc) => {
    delete doc.analysisResults;
    doc.datasets = doc.datasets.filter((d) => d.id !== "source");
  });
}

function expectMissingSourcePanel(): void {
  useApp.setState({ openAnalysisResultId: "analysis-output" });
  const view = render(<AnalysisResultPanel />);
  expect(screen.getByText("Source missing")).toBeInTheDocument();
  expect(screen.getByText(MISSING)).toBeInTheDocument();
  const recalc = screen.getByRole("button", { name: "Recalculate" });
  expect(recalc).toBeDisabled();
  expect(recalc).toHaveAttribute("title", MISSING);
  expect(screen.getByRole("button", { name: "Rerun as new" })).toBeDisabled();
  const open = screen.getByRole("button", { name: "Open worksheet" });
  expect(open).toBeEnabled();
  fireEvent.click(open);
  expect(useApp.getState().activeId).toBe("output");
  view.unmount();
}

describe("analysis result with a missing source", () => {
  it("an older file's signal output keeps its result, flagged, when the source is not in the file", () => {
    openLegacyFileWithoutSource();
    const [kept] = useApp.getState().analysisResults;
    expect(kept).toMatchObject({
      id: "analysis-output",
      sources: [{ datasetId: "source", role: "input" }],
      outputs: [{ datasetId: "output", role: "linked-worksheet" }],
      settingsRef: { datasetId: "output", field: "analysisRecipe" },
    });
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["output"]);
    expectMissingSourcePanel();
  });

  it("the kept result saves and reopens unchanged", () => {
    openLegacyFileWithoutSource();
    const before = useApp.getState().analysisResults;
    reopen();
    expect(useApp.getState().analysisResults).toEqual(before);
    reopen();
    expect(useApp.getState().analysisResults).toEqual(before);
    expectMissingSourcePanel();
  });

  it("deleting the source live keeps the result and output, and undo clears the state", () => {
    useApp.getState().removeDataset("source");
    expect(useApp.getState().analysisResults).toEqual([result]);
    expect(useApp.getState().datasets.map((d) => d.id)).toEqual(["output"]);
    expectMissingSourcePanel();

    useApp.getState().undo();
    useApp.setState({ openAnalysisResultId: "analysis-output" });
    render(<AnalysisResultPanel />);
    expect(screen.queryByText("Source missing")).not.toBeInTheDocument();
    expect(screen.queryByText(MISSING)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recalculate" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Recalculate" })).not.toHaveAttribute("title");
  });

  it("a missing OUTPUT is still Incomplete, not the missing-source state", () => {
    useApp.setState({ datasets: [source], openAnalysisResultId: "analysis-output" });
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Incomplete")).toBeInTheDocument();
    expect(screen.queryByText(MISSING)).not.toBeInTheDocument();
  });
});
