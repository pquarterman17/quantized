import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SignalAnalysisRecipe } from "../lib/signalTransform";
import type { Dataset } from "../lib/types";

vi.mock("../lib/transformRun", () => ({ runTransform: vi.fn() }));

import { runTransform } from "../lib/transformRun";
import { registerSignalResult } from "./analysisResultActions";
import { createSignalWorksheetFromApp } from "./signalWorksheetCommand";
import { useApp } from "./useApp";

const RECIPE: SignalAnalysisRecipe = {
  kind: "signal-correction",
  version: 1,
  operation: "Smooth",
  xUnit: "s",
  channels: [{ index: 0, label: "Signal", unit: "V" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
};

const SOURCE: Dataset = {
  id: "source",
  name: "Trace",
  data: { time: [0, 1], values: [[1], [2]], labels: ["Signal"], units: ["V"], metadata: {} },
};

const OUTPUT: Dataset = {
  ...SOURCE,
  id: "output",
  name: "Trace (Smooth)",
  derivedFrom: { datasetId: "source", pipeline: "Smooth" },
  analysisRecipe: RECIPE,
};

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ datasets: [SOURCE, OUTPUT], analysisResults: [], openAnalysisResultId: null, history: [], future: [] });
  // The real runTransform registers the result for every signal output
  // (lib/signalTransformRun.test.ts covers that); the mock does the same.
  vi.mocked(runTransform).mockImplementation(async () => {
    registerSignalResult("source", "output");
    return { id: "output", name: OUTPUT.name, warnings: [], outputs: [{ id: "output", key: "" }] };
  });
});

describe("createSignalWorksheetFromApp", () => {
  it("opens the durable result runTransform registered for the linked worksheet", async () => {
    expect(await createSignalWorksheetFromApp("source", RECIPE)).toBe("output");
    expect(useApp.getState().analysisResults).toHaveLength(1);
    expect(useApp.getState().analysisResults[0]).toMatchObject({
      producer: { id: "signal-processing" },
      sources: [{ datasetId: "source" }],
      outputs: [{ datasetId: "output" }],
      settingsRef: { datasetId: "output", field: "analysisRecipe" },
    });
    expect(useApp.getState().analysisResults[0].id).toBe("analysis-output");
    expect(useApp.getState().openAnalysisResultId).toBe("analysis-output");
  });

  it("does not invent a result when the transform returned an output absent from the store", async () => {
    useApp.setState({ datasets: [SOURCE] });
    expect(await createSignalWorksheetFromApp("source", RECIPE)).toBe("output");
    expect(useApp.getState().analysisResults).toEqual([]);
    expect(useApp.getState().openAnalysisResultId).toBeNull();
  });
});
