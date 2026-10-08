import { describe, expect, it } from "vitest";

import {
  bindSignalRecipe,
  signalTransformParamsOf,
  type SignalCorrectionRecipe,
} from "./signalTransform";
import type { DataStruct } from "./types";

const recipe: SignalCorrectionRecipe = {
  kind: "signal-correction",
  version: 1,
  operation: "Smooth",
  channels: [{ index: 0, label: "Intensity", unit: "counts" }],
  params: { signalChannels: [0], smoothEnabled: true, smoothMethod: "moving", smoothWindow: 2 },
};

const data = (labels: string[], units: string[]): DataStruct => ({
  time: [0, 1],
  values: [labels.map((_, index) => index + 1), labels.map((_, index) => index + 2)],
  labels,
  units,
  metadata: {},
});

describe("signal transform recipe", () => {
  it("rebinds an unambiguous moved label and rewrites the correction indices", () => {
    expect(bindSignalRecipe(recipe, data(["Other", "Intensity"], ["V", "counts"]))).toMatchObject({
      channels: [{ index: 1, label: "Intensity", unit: "counts" }],
      params: { signalChannels: [1] },
    });
  });

  it("uses the recorded position for a Recipe-Library conformed column with a different name", () => {
    expect(bindSignalRecipe(recipe, data(["Detector A"], ["counts"]))).toMatchObject({
      channels: [{ index: 0, label: "Detector A", unit: "counts" }],
      params: { signalChannels: [0] },
    });
  });

  it("fails closed on ambiguous labels and incompatible units", () => {
    expect(() => bindSignalRecipe(recipe, data(["Intensity", "Intensity"], ["counts", "counts"]))).toThrow(/ambiguous/);
    expect(() => bindSignalRecipe(recipe, data(["Intensity"], ["A"]))).toThrow(/changed units/);
  });

  it("rejects malformed user-edited transform payloads", () => {
    expect(() => signalTransformParamsOf({ op: "signal", recipe: { ...recipe, params: { signalChannels: [1] } } })).toThrow(/malformed/);
    expect(() => signalTransformParamsOf({
      op: "signal",
      recipe: { ...recipe, params: { ...recipe.params, yScale: 100 } },
    })).toThrow(/malformed/);
    expect(() => signalTransformParamsOf({
      op: "signal",
      recipe: { ...recipe, params: { signalChannels: [0], normMethod: "Peak (max=1)" } },
    })).toThrow(/malformed/);
    expect(() => signalTransformParamsOf({
      op: "signal",
      recipe: { ...recipe, operation: "Run arbitrary code" },
    })).toThrow(/malformed/);
    expect(() => signalTransformParamsOf({
      op: "signal",
      recipe: {
        ...recipe,
        channels: [recipe.channels[0], recipe.channels[0]],
        params: { ...recipe.params, signalChannels: [0, 0] },
      },
    })).toThrow(/malformed/);
    expect(signalTransformParamsOf({ op: "signal", recipe })).toEqual({ op: "signal", recipe });
  });
});
