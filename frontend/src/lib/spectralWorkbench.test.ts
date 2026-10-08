import { describe, expect, it } from "vitest";

import {
  DEFAULT_SPECTRAL_RECIPE,
  rebindSpectralRecipe,
  sanitizeSpectralRecipe,
  spectralRequest,
  type SpectralAnalysisRecipe,
} from "./spectralWorkbench";
import type { DataStruct } from "./types";

const recipe = (over: Partial<SpectralAnalysisRecipe> = {}): SpectralAnalysisRecipe => ({
  ...DEFAULT_SPECTRAL_RECIPE,
  channels: [{ index: 1, label: "signal" }],
  ...over,
});

const data: DataStruct = {
  time: [0, 1],
  values: [[1, 2], [3, 4]],
  labels: ["other", "signal"],
  units: ["", "V"],
  metadata: {},
};

describe("spectral workbench recipe", () => {
  it("maps the durable camel-case recipe onto the backend wire contract", () => {
    expect(spectralRequest(data, recipe({ xMin: 1, xMax: 2, segmentLen: 64 }))).toMatchObject({
      dataset: data,
      operation: "fft",
      channels: [1],
      x_min: 1,
      x_max: 2,
      segment_len: 64,
      correlation_demean: true,
    });
  });

  it("keeps a matching binding and rebinds one uniquely moved label", () => {
    const original = recipe();
    expect(rebindSpectralRecipe(original, data.labels)).toBe(original);
    expect(rebindSpectralRecipe(original, ["signal", "other"])).toMatchObject({
      channels: [{ index: 0, label: "signal" }],
    });
  });

  it("fails closed on missing or ambiguous labels", () => {
    expect(() => rebindSpectralRecipe(recipe(), ["other"])).toThrow("changed or is ambiguous");
    expect(() => rebindSpectralRecipe(recipe(), ["signal", "signal"])).toThrow("ambiguous");
    expect(() => rebindSpectralRecipe(recipe({ channels: [{ index: 0, label: "signal" }] }), ["signal", "signal"]))
      .toThrow("ambiguous");
  });

  it("sanitizes a valid round-trip and drops malformed or future recipes", () => {
    const valid = recipe({ operation: "filter", cutoff: [2] });
    expect(sanitizeSpectralRecipe(structuredClone(valid))).toEqual(valid);
    expect(sanitizeSpectralRecipe({ ...valid, version: 2 })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, channels: [{ index: -1, label: "signal" }] })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, overlap: 1 })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, cutoff: [-1] })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, order: 0 })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, xMin: 4, xMax: 2 })).toBeUndefined();
    expect(sanitizeSpectralRecipe({ ...valid, operation: "correlation" })).toBeUndefined();
  });
});
