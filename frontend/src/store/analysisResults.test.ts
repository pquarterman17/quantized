import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
import type { Dataset } from "../lib/types";

const { recompute, saveBlob } = vi.hoisted(() => ({ recompute: vi.fn(), saveBlob: vi.fn() }));
vi.mock("./derivedWorksheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./derivedWorksheets")>()),
  recomputeDerivedSheet: recompute,
}));
vi.mock("../lib/download", () => ({ saveBlob }));

import {
  duplicateAnalysisResult,
  exportAnalysisResultTable,
  freezeAnalysisResult,
  prepareAnalysisResultPlot,
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
    datasets: [],
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

  it("duplicates the result record as one undoable edit without copying its output", () => {
    useApp.setState({ analysisResults: [{ ...RESULT, updatedAt: "old" }] });
    const id = duplicateAnalysisResult("result-1", "2026-10-09T00:00:00Z");
    expect(id).toMatch(/^analysis-/);
    expect(useApp.getState().analysisResults[1]).toMatchObject({
      id, name: `${RESULT.name} copy`, outputs: RESULT.outputs,
      createdAt: "2026-10-09T00:00:00Z",
    });
    expect(useApp.getState().analysisResults[1].updatedAt).toBeUndefined();
    expect(useApp.getState().datasets).toHaveLength(0);
    useApp.getState().undo();
    expect(useApp.getState().analysisResults).toHaveLength(1);
  });
});

describe("analysis result output actions", () => {
  const data: Dataset["data"] = {
    time: [0, 1], values: [[2, 3], [4, 5]], labels: ["A", "B"], units: ["V", "V"], metadata: { xLabel: "Time" },
  };
  const source: Dataset = { id: "source", name: "Source", data };
  const output: Dataset = { id: "output", name: "Output", data, derivedFrom: { datasetId: "source", pipeline: "Smooth" } };
  const rich = { ...RESULT, tableRefs: [{ datasetId: "output", label: "Output" }], plotBindings: [{ datasetId: "output", channels: [1, 99] }] };

  beforeEach(() => {
    saveBlob.mockReset();
    useApp.setState({
      datasets: [source, output], activeId: "source", analysisResults: [rich],
      history: [], future: [], yKeys: null, stageTab: "worksheet",
    });
  });

  it("focuses only valid saved plot channels", async () => {
    expect(await prepareAnalysisResultPlot("result-1", 0)).toMatchObject({ dataset: { id: "output" }, channels: [1] });
    expect(useApp.getState()).toMatchObject({ activeId: "output", yKeys: [1], stageTab: "plot" });
    expect(await prepareAnalysisResultPlot("result-1", 2)).toBeNull();
  });

  it("fails closed when a lazy output cannot load or the result changes during loading", async () => {
    const realResolve = useApp.getState().resolveDataset;
    try {
      useApp.setState({ resolveDataset: () => Promise.reject(new Error("network unavailable")) });
      expect(await prepareAnalysisResultPlot("result-1", 0)).toBeNull();
      expect(useApp.getState()).toMatchObject({ activeId: "source", yKeys: null });
      expect(useApp.getState().status).toContain("network unavailable");

      useApp.setState({
        analysisResults: [rich], status: "", resolveDataset: async () => {
          useApp.setState({ analysisResults: [] });
          return output;
        },
      });
      expect(await prepareAnalysisResultPlot("result-1", 0)).toBeNull();
      expect(useApp.getState()).toMatchObject({ activeId: "source", yKeys: null });
      expect(useApp.getState().status).toContain("changed while loading");
    } finally {
      useApp.setState({ resolveDataset: realResolve });
    }
  });

  it("exports a recorded table and refuses a worksheet the result does not own", async () => {
    expect(await exportAnalysisResultTable("result-1", "source")).toBe(false);
    expect(saveBlob).not.toHaveBeenCalled();
    expect(await exportAnalysisResultTable("result-1", "output")).toBe(true);
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), "Smooth · Trace-Output.csv");
  });

  it("freezes the linked output as independent data and keeps the result", () => {
    const frozenId = freezeAnalysisResult("result-1");
    const frozen = useApp.getState().datasets.find((dataset) => dataset.id === frozenId);
    expect(frozen).toMatchObject({ name: "Output (frozen)" });
    expect(frozen?.derivedFrom).toBeUndefined();
    expect(useApp.getState().analysisResults).toEqual([rich]);
    useApp.getState().undo();
    expect(useApp.getState().datasets.map((dataset) => dataset.id)).toEqual(["source", "output"]);
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
