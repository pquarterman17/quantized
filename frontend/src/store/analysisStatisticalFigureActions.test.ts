import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
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
  };
}

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
    const windowId = createAnalysisStatisticalFigure("distribution-1", "distribution-histogram-0", tables);

    expect(windowId).toBeTruthy();
    const state = useApp.getState();
    expect(state.editableFigures).toHaveLength(1);
    expect(state.history).toHaveLength(1);
    const document = state.editableFigures[0];
    expect(document.bindings.datasetId).toBeNull();
    expect(document.data.mode).toBe("frozen");
    expect(document.data.snapshot?.values).toEqual([[4], [2]]);
    expect(state.plotWindows.find((window) => window.id === windowId)?.document?.id).toBe(document.id);

    state.undo();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().plotWindows).toHaveLength(0);
  });

  it("allows harmless envelope edits when the scientific table reference is unchanged", () => {
    const current = useApp.getState().analysisResults[0];
    useApp.setState({ analysisResults: [{ ...current, notes: "new interpretation" }] });
    expect(createAnalysisStatisticalFigure(current.id, "distribution-histogram-0", current.tables)).toBeTruthy();
  });

  it("refuses stale lazy actions after tables change without creating history", () => {
    const current = useApp.getState().analysisResults[0];
    const expected = current.tables;
    useApp.setState({ analysisResults: [{ ...current, tables: current.tables?.map((entry) => ({ ...entry })) }] });

    expect(createAnalysisStatisticalFigure(current.id, "distribution-histogram-0", expected)).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().plotWindows).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
    expect(useApp.getState().status).toContain("changed while loading");
  });

  it("refuses an unknown draft key without mutating the workspace", () => {
    expect(createAnalysisStatisticalFigure("distribution-1", "missing")).toBeNull();
    expect(useApp.getState().editableFigures).toHaveLength(0);
    expect(useApp.getState().history).toHaveLength(0);
  });
});
