// PR #554 review blocker 2: a result's "Out of date" state must survive
// save -> reopen. `staleDatasets` is session state that hydration resets, so
// the .dwk carries a source fingerprint (and a stale flag) per result and the
// parser re-derives the stale outputs on load.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../../../lib/analysisResult";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";

vi.mock("../../overlays/ToolWindow", () => ({
  default: ({ title, children }: { title: string; children: React.ReactNode }) => <section aria-label={title}>{children}</section>,
}));

import AnalysisResultPanel from "./AnalysisResultPanel";
import { useApp } from "../../../store/useApp";

const data = (v: number): Dataset["data"] => ({ time: [0, 1], values: [[v], [v + 1]], labels: ["Signal"], units: ["V"], metadata: {} });
const source: Dataset = { id: "source", name: "Raw trace", data: data(1) };
const output: Dataset = {
  id: "output",
  name: "Smoothed trace",
  data: data(1),
  derivedFrom: { datasetId: "source", pipeline: "Smooth" },
};
const result: AnalysisResult = {
  version: 1,
  id: "result",
  name: "Smooth · Raw trace",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "source", role: "input" }],
  outputs: [{ datasetId: "output", role: "linked-worksheet" }],
  warnings: [],
  createdAt: "2026-10-08T00:00:00Z",
};

type Doc = { datasets: { id: string; data: unknown }[]; analysisResults: Record<string, unknown>[] };

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

function saveAndReopen(edit?: (doc: Doc) => void): void {
  const doc = JSON.parse(serializeWorkspace({ ...useApp.getState() })) as Doc;
  edit?.(doc);
  useApp.getState().loadWorkspace(parseWorkspace(JSON.stringify(doc)));
  useApp.setState({ openAnalysisResultId: "result" });
}

function editSource(v: number): void {
  useApp.setState((s) => ({ datasets: s.datasets.map((d) => d.id === "source" ? { ...d, data: data(v) } : d) }));
  useApp.getState().touchDataset("source");
}

describe("analysis result staleness across save/reopen", () => {
  it("a manual-mode source edit is still Out of date after save and reopen", () => {
    editSource(5);
    expect(useApp.getState().staleDatasets).toContain("output");

    saveAndReopen();

    expect(useApp.getState().staleDatasets).toEqual(["output"]);
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Out of date")).toBeInTheDocument();
  });

  it("a current result stays Current across save and reopen", () => {
    saveAndReopen();
    expect(useApp.getState().staleDatasets).toEqual([]);
    render(<AnalysisResultPanel />);
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("detects a source changed in the file after it was saved current", () => {
    saveAndReopen((doc) => {
      doc.datasets.find((d) => d.id === "source")!.data = JSON.parse(JSON.stringify(data(9))) as unknown;
    });
    expect(useApp.getState().staleDatasets).toEqual(["output"]);
  });

  it("stays stale through a second save before anyone recalculates", () => {
    editSource(5);
    saveAndReopen();
    saveAndReopen();
    expect(useApp.getState().staleDatasets).toEqual(["output"]);
  });

  it("reads a file saved before fingerprints existed as current, and ignores a malformed one", () => {
    saveAndReopen((doc) => {
      for (const r of doc.analysisResults) delete r.sourceFingerprint;
    });
    expect(useApp.getState().staleDatasets).toEqual([]);
    saveAndReopen((doc) => {
      doc.analysisResults[0].sourceFingerprint = 42;
      doc.analysisResults[0].stale = "yes";
    });
    expect(useApp.getState().staleDatasets).toEqual([]);
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });
});
