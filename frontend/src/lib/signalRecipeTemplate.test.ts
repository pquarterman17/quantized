import { beforeEach, describe, expect, it } from "vitest";

import { inputColumnRefs } from "./recipeExpect";
import { saveSignalRecipeTemplate } from "./signalRecipeTemplate";
import type { SignalCorrectionRecipe } from "./signalTransform";
import { DEFAULT_SPECTRAL_RECIPE, type SpectralAnalysisRecipe } from "./spectralWorkbench";
import { loadTemplates } from "./template";
import { TEMPLATES_KEY } from "./templateKey";
import type { Dataset } from "./types";

const source: Dataset = {
  id: "source",
  name: "scan",
  data: {
    time: [0, 1],
    values: [[1, 2], [3, 4]],
    labels: ["A", "B"],
    units: ["V", "A"],
    metadata: {},
  },
};

const recipe: SignalCorrectionRecipe = {
  kind: "signal-correction",
  version: 1,
      xUnit: "",
  operation: "Detrend",
  channels: [{ index: 1, label: "B", unit: "A" }],
  params: { signalChannels: [1], detrendOrder: 1 },
};

describe("Signal Processing Recipe Library integration", () => {
  beforeEach(() => localStorage.removeItem(TEMPLATES_KEY));

  it("saves a replayable transform with required channel and unit expectations", () => {
    expect(saveSignalRecipeTemplate("  Clean trend  ", source, recipe)).toEqual({ name: "Clean trend", revision: 1 });
    const saved = loadTemplates()[0];
    expect(saved.name).toBe("Clean trend");
    expect(saved.steps).toHaveLength(1);
    expect(saved.steps[0]).toMatchObject({ kind: "transform", params: { op: "signal", recipe } });
    expect(saved.expects?.columns).toEqual([
      { name: "A", unit: "V", required: false },
      { name: "B", unit: "A", required: true },
    ]);
    expect(saved.expects?.signalInputUnit).toBe("");
    expect(inputColumnRefs(saved.steps, source.data.labels).cols).toEqual(new Set([1]));
  });

  it("increments the revision when the same named recipe is saved again", () => {
    saveSignalRecipeTemplate("Clean trend", source, recipe);
    expect(saveSignalRecipeTemplate("Clean trend", source, recipe).revision).toBe(2);
    expect(loadTemplates()).toHaveLength(1);
  });

  it("refuses to save a project-specific cross-worksheet source as a reusable recipe", () => {
    const cross: SpectralAnalysisRecipe = {
      ...DEFAULT_SPECTRAL_RECIPE,
      operation: "correlation",
      channels: [{ index: 0, label: "A", unit: "V" }],
      secondarySource: {
        datasetId: "second", datasetName: "reference", xUnit: "",
        channel: { index: 0, label: "B", unit: "A" },
      },
    };
    expect(() => saveSignalRecipeTemplate("Cross", source, cross)).toThrow("project-specific");
    expect(loadTemplates()).toEqual([]);
  });
});
