import { beforeEach, describe, expect, it } from "vitest";

import { inputColumnRefs } from "./recipeExpect";
import { preflightRecipe } from "./recipePreflight";
import { buildTransformRecipeTemplate, saveSignalRecipeTemplate } from "./signalRecipeTemplate";
import { computeTransform, transformParamsOf } from "./transformRun";
import type { SigopParams } from "./transformSigop";
import type { SpectrogramParams } from "./transformSpectrogram";
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

describe("ranged filter / spectrogram recipes record the X unit", () => {
  const timeSheet = (unit: string): Dataset => ({
    id: "t", name: "t", data: { time: [0, 1, 2], values: [[1], [2], [3]], labels: ["V"], units: ["mV"], metadata: { xUnit: unit } },
  });
  const ranged: SigopParams = { op: "sigop", method: "median", channels: [0], args: { window: 5, xMin: 0, xMax: 2 } };
  const spectro: SpectrogramParams = { op: "spectrogram", channel: 0, segment_len: 16, window: "hann", overlap: 0.5, scaling: "psd", detrend: "mean", resample: false };

  beforeEach(() => localStorage.removeItem(TEMPLATES_KEY));

  it.each([["ranged filter", ranged], ["spectrogram", spectro]])("%s: expectations carry the unit; a different unit is refused, the same replays", async (_n, params) => {
    const t = buildTransformRecipeTemplate("r", timeSheet("s"), params);
    expect(t.expects?.signalInputUnit).toBe("s");
    expect(t.steps[0]!.params.xUnit).toBe("s");
    const ids = new Set(["t"]);
    const bad = preflightRecipe(t, timeSheet("ms"), [0], ids, false);
    expect(bad.blocked).toBe(true);
    expect(bad.issues.some((i) => i.kind === "x-unit-mismatch")).toBe(true);
    expect(preflightRecipe(t, timeSheet("s"), [0], ids, false).blocked).toBe(false);
    // The replay itself (runner) refuses too, without calling the backend.
    const step = transformParamsOf(t.steps[0]!.params);
    await expect(computeTransform(step, timeSheet("ms"), [])).rejects.toThrow(/recorded for X in s/);
  });

  it("an unranged filter without fwhm needs no unit; a convolve (fwhm) does", () => {
    const plain: SigopParams = { op: "sigop", method: "median", channels: [0], args: { window: 5 } };
    expect(buildTransformRecipeTemplate("p", timeSheet("s"), plain).expects?.signalInputUnit).toBeUndefined();
    const conv: SigopParams = { op: "sigop", method: "convolve", channels: [0], args: { kernel: "gaussian", fwhm: 0.3 } };
    expect(buildTransformRecipeTemplate("c", timeSheet("s"), conv).expects?.signalInputUnit).toBe("s");
  });
});
