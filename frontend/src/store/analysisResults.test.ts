import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
import { registerAnalysisResult, removeAnalysisResult, renameAnalysisResult, updateAnalysisResultNotes } from "./analysisResultActions";
import { useApp } from "./useApp";

const RESULT: AnalysisResult = {
  version: 1,
  id: "result-1",
  name: "Smooth · Trace",
  producer: { id: "signal-processing", label: "Signal Processing", version: 1 },
  sources: [{ datasetId: "source", role: "input" }],
  outputs: [{ datasetId: "output", role: "linked-worksheet" }],
  warnings: [],
  createdAt: "2026-10-08T00:00:00Z",
};

beforeEach(() => {
  useApp.setState({
    analysisResults: [],
    openAnalysisResultId: null,
    librarySelection: null,
    history: [],
    future: [],
  });
});

describe("analysis result store lifecycle", () => {
  it("registers the transform's result in the same gesture without a second history entry", () => {
    registerAnalysisResult(RESULT);
    registerAnalysisResult(RESULT);
    expect(useApp.getState().analysisResults).toEqual([RESULT]);
    expect(useApp.getState().openAnalysisResultId).toBe("result-1");
    expect(useApp.getState().history).toEqual([]);
  });

  it("renames and deletes through undoable project edits", () => {
    useApp.setState({ analysisResults: [RESULT], openAnalysisResultId: "result-1" });
    renameAnalysisResult("result-1", "Reviewed result");
    expect(useApp.getState().analysisResults[0].name).toBe("Reviewed result");
    useApp.getState().undo();
    expect(useApp.getState().analysisResults[0].name).toBe(RESULT.name);

    useApp.setState({ librarySelection: { kind: "analysis-result", id: "result-1" } });
    removeAnalysisResult("result-1");
    expect(useApp.getState().analysisResults).toEqual([]);
    expect(useApp.getState().openAnalysisResultId).toBeNull();
    expect(useApp.getState().librarySelection).toBeNull();
    useApp.getState().undo();
    expect(useApp.getState().analysisResults).toEqual([RESULT]);
  });

  it("stores notes without erasing whitespace inside the user's text", () => {
    useApp.setState({ analysisResults: [RESULT] });
    updateAnalysisResultNotes("result-1", "first line\n\nsecond line");
    expect(useApp.getState().analysisResults[0].notes).toBe("first line\n\nsecond line");
  });
});
