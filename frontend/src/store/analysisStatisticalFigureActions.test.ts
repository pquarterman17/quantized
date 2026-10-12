import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
import { statisticalResultFigureDrafts } from "../lib/statisticalResultFigures";
import type { Dataset } from "../lib/types";
import { createAnalysisStatisticalFigure } from "./analysisStatisticalFigureActions";
import { useApp } from "./useApp";

function savedResult(): AnalysisResult {
  return {
    version: 1,
    id: "distribution-1",
    name: "Saved distribution",
    producer: { id: "distribution-analysis", label: "Distribution", version: 1 },
    sources: [{ datasetId: "missing-source", role: "input" }],
    outputs: [],
    scalarValues: { Column: "Signal" },
    tables: [{ title: "Histogram", columns: ["bin left", "center", "bin right", "count"], rows: [[0, 1, 2, 4], [2, 3, 4, 2]] }],
    warnings: [],
    createdAt: "2026-10-11T00:00:00.000Z",
    sourceFingerprint: "saved-fingerprint",
  };
}

const savedDraft = () => statisticalResultFigureDrafts(useApp.getState().analysisResults[0])[0];

beforeEach(() => {
  useApp.setState({
    datasets: [],
    analysisResults: [savedResult()],
    editableFigures: [],
    plotWindows: [],
    focusedWindowId: null,
    history: [],
    future: [],
    status: "",
  });
});

describe("createAnalysisStatisticalFigure", () => {
  it("creates and opens one frozen editable document as one undoable gesture", () => {
    const tables = useApp.getState().analysisResults[0].tables;
    const windowId = createAnalysisStatisticalFigure("distribution-1", savedDraft(), tables);

    expect(windowId).toBeTruthy();
    const state = useApp.getState();
    expect(state.editableFigures).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    const document = state.editableFigures[0];
    expect(document.bindings.datasetId).toBeNull();
    expect(document.data.mode).toBe("frozen");
    expect(document.data.snapshot?.values).toEqual([[4], [2]]);
    expect(document.data.snapshot?.metadata).toMatchObject({
      snapshotResultState: "source-missing", sourceFingerprint: "saved-fingerprint",
    });
    expect(state.plotWindows.find((window) => window.id === windowId)?.document?.id).toBe(document.id);

    state.undo();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().plotWindows).toHaveLength(0);
  });

  it("allows harmless envelope edits when the scientific table reference is unchanged", () => {
    const current = useApp.getState().analysisResults[0];
    const draft = savedDraft();
    useApp.setState({ analysisResults: [{ ...current, notes: "new interpretation" }] });
    expect(createAnalysisStatisticalFigure(current.id, draft, current.tables)).toBeTruthy();
  });

  it("refuses stale lazy actions after tables change without creating history", () => {
    const current = useApp.getState().analysisResults[0];
    const draft = savedDraft();
    const expected = current.tables;
    useApp.setState({ analysisResults: [{ ...current, tables: current.tables?.map((entry) => ({ ...entry })) }] });

    expect(createAnalysisStatisticalFigure(current.id, draft, expected)).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().plotWindows).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toContain("changed while loading");
  });

  it("refuses a draft from another saved result without mutating the workspace", () => {
    const draft = savedDraft();
    const foreign = { ...draft, data: { ...draft.data, metadata: { ...draft.data.metadata, analysisResultId: "other" } } };
    expect(createAnalysisStatisticalFigure("distribution-1", foreign)).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });

  it("refuses an out-of-date result instead of silently freezing stale values", () => {
    const current = useApp.getState().analysisResults[0];
    const source: Dataset = {
      id: "missing-source", name: "Source",
      data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: [""], metadata: {} },
    };
    useApp.setState({ datasets: [source], analysisResults: [{ ...current, stale: true }] });

    expect(createAnalysisStatisticalFigure(current.id, savedDraft(), current.tables)).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().plotWindows).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toContain("recalculate the out-of-date result first");
  });
});
