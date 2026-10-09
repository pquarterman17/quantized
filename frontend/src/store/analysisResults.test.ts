import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "../lib/analysisResult";
import type { Dataset } from "../lib/types";

const { recompute, saveBlob, sendFigureToReport } = vi.hoisted(() => ({
  recompute: vi.fn(), saveBlob: vi.fn(), sendFigureToReport: vi.fn(),
}));
vi.mock("./derivedWorksheets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./derivedWorksheets")>()),
  recomputeDerivedSheet: recompute,
}));
vi.mock("../lib/download", () => ({ saveBlob }));
vi.mock("../commands/plotCommands", () => ({ sendFigureToReport }));

import {
  duplicateAnalysisResult,
  exportAnalysisResultTable,
  freezeAnalysisResult,
  prepareAnalysisResultPlot,
  recalculateAnalysisResult,
  registerAnalysisResult,
  removeAnalysisResult,
  renameAnalysisResult,
  resolveAnalysisResultPlot,
  sendAnalysisResultPlotToReport,
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

  it("duplicates the result and its linked output as one undoable edit", async () => {
    const output: Dataset = {
      id: "output", name: "Output",
      data: { time: [0], values: [[2]], labels: ["Y"], units: ["V"], metadata: {} },
      derivedFrom: { datasetId: "source", pipeline: "Smooth" },
    };
    useApp.setState({ datasets: [output], analysisResults: [{ ...RESULT, updatedAt: "old" }] });
    const id = await duplicateAnalysisResult("result-1", "2026-10-09T00:00:00Z");
    expect(id).toMatch(/^analysis-/);
    const clonedOutput = useApp.getState().datasets[1];
    expect(clonedOutput).toMatchObject({ name: "Output (copy)", derivedFrom: output.derivedFrom });
    expect(clonedOutput.id).not.toBe("output");
    expect(useApp.getState().analysisResults[1]).toMatchObject({
      id, name: `${RESULT.name} copy`,
      outputs: [{ datasetId: clonedOutput.id, role: "linked-worksheet" }],
      createdAt: "2026-10-09T00:00:00Z",
    });
    expect(useApp.getState().analysisResults[1].updatedAt).toBe("old");
    useApp.getState().undo();
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().datasets).toEqual([output]);
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
    sendFigureToReport.mockReset();
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

  it("resolves a saved plot for a builder without changing the current surface", async () => {
    const before = { activeId: useApp.getState().activeId, yKeys: useApp.getState().yKeys, stageTab: useApp.getState().stageTab };
    expect(await resolveAnalysisResultPlot("result-1", 0)).toMatchObject({ dataset: { id: "output" }, channels: [1] });
    expect(useApp.getState()).toMatchObject(before);
    expect(useApp.getState().history).toEqual([]);
  });

  it("reports the report command's lazy-load outcome instead of claiming success", async () => {
    sendFigureToReport.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    expect(await sendAnalysisResultPlotToReport("result-1", 0)).toBe(false);
    expect(await sendAnalysisResultPlotToReport("result-1", 0)).toBe(true);
    expect(sendFigureToReport).toHaveBeenCalledTimes(2);
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
    expect(useApp.getState().status).toBe(`${RESULT.name}'s output is already recalculating`);
    finish();
    expect(await first).toBe(true);
  });

  it("serializes legacy records that share an output and refreshes both timestamps", async () => {
    const legacyCopy = { ...RESULT, id: "result-legacy", name: "Legacy copy" };
    useApp.setState({ analysisResults: [RESULT, legacyCopy] });
    let finish!: () => void;
    recompute.mockImplementation(() => new Promise((resolve) => {
      finish = () => resolve({ sheet: { ...OUTPUT, data: data(2) }, shift: null });
    }));
    const first = recalculateAnalysisResult("result-1");
    expect(await recalculateAnalysisResult("result-legacy")).toBe(false);
    finish();
    expect(await first).toBe(true);
    expect(useApp.getState().analysisResults.every((item) => item.updatedAt)).toBe(true);
  });

  it("explains a missing source instead of doing nothing", async () => {
    useApp.setState({ datasets: [OUTPUT] });
    expect(await recalculateAnalysisResult("result-1")).toBe(false);
    expect(useApp.getState().status).toMatch(/source or output worksheet is missing/);
    expect(recompute).not.toHaveBeenCalled();
  });
});
