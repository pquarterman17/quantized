import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
import type { Dataset } from "../lib/types";

const { recompute } = vi.hoisted(() => ({ recompute: vi.fn() }));
vi.mock("./derivedWorksheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./derivedWorksheets")>()),
  recomputeDerivedSheet: recompute,
}));

import {
  recalculateAnalysisResult,
  registerAnalysisResult,
  removeAnalysisResult,
  renameAnalysisResult,
  updateAnalysisResultNotes,
} from "./analysisResultActions";
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

describe("recalculateAnalysisResult", () => {
  const data = (v: number): Dataset["data"] => ({ time: [0, 1], values: [[v], [v]], labels: ["Y"], units: ["V"], metadata: {} });
  const SOURCE: Dataset = { id: "source", name: "Trace", data: data(1) };
  const OUTPUT: Dataset = { id: "output", name: "Trace (Smooth)", data: data(1), derivedFrom: { datasetId: "source", pipeline: "Smooth" } };
  const OTHER: Dataset = { id: "other", name: "Other", data: data(5), derivedFrom: { datasetId: "source", pipeline: "Smooth" } };

  beforeEach(() => {
    recompute.mockReset();
    useApp.setState({
      datasets: [SOURCE, OUTPUT, OTHER],
      analysisResults: [RESULT],
      staleDatasets: ["output", "other"],
      staleFits: [],
      status: "",
    });
  });

  it("recomputes only this result's output, as one undoable step", async () => {
    const recalcNow = vi.fn(async () => {});
    useApp.setState({ recalcNow });
    recompute.mockResolvedValue({ sheet: { ...OUTPUT, data: data(2) }, shift: null });

    expect(await recalculateAnalysisResult("result-1")).toBe(true);

    expect(recompute).toHaveBeenCalledTimes(1);
    expect(recompute.mock.calls[0][1]).toMatchObject({ id: "output" });
    expect(recalcNow).not.toHaveBeenCalled();
    // The manual-mode stale mark the user kept on another dataset survives.
    expect(useApp.getState().staleDatasets).toEqual(["other"]);
    expect(useApp.getState().datasets.find((d) => d.id === "output")?.data.values[0][0]).toBe(2);
    expect(useApp.getState().analysisResults[0].updatedAt).toBeTruthy();
    expect(useApp.getState().history).toHaveLength(1);

    useApp.getState().undo();
    expect(useApp.getState().datasets.find((d) => d.id === "output")?.data.values[0][0]).toBe(1);
  });

  it("reports a second request while one is running instead of silently dropping it", async () => {
    let finish!: () => void;
    recompute.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ sheet: { ...OUTPUT, data: data(2) }, shift: null });
    }));
    const first = recalculateAnalysisResult("result-1");
    expect(await recalculateAnalysisResult("result-1")).toBe(false);
    expect(useApp.getState().status).toBe(`${RESULT.name} is already recalculating`);
    finish();
    expect(await first).toBe(true);
  });

  it("explains a missing source instead of doing nothing", async () => {
    useApp.setState({ datasets: [OUTPUT] });
    expect(await recalculateAnalysisResult("result-1")).toBe(false);
    expect(useApp.getState().status).toMatch(/source or output worksheet is missing/);
    expect(recompute).not.toHaveBeenCalled();
  });
});
