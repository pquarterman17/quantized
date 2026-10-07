import { describe, expect, it } from "vitest";

import type { Dataset } from "../../../lib/types";
import {
  DEFAULT_SPECTRAL_SETTINGS,
  buildSpectralRecipe,
  frequencyUnitOf,
  validateSpectralSettings,
} from "./spectralSettings";

const dataset: Dataset = {
  id: "d",
  name: "scan",
  data: {
    time: [0, 1],
    values: [[1, 2], [3, 4]],
    labels: ["sample", "reference"],
    units: ["V", "V"],
    metadata: { xUnit: "s" },
  },
};

describe("spectral settings", () => {
  it("builds a label-bound recipe with an explicit range", () => {
    const settings = { ...DEFAULT_SPECTRAL_SETTINGS, useRange: true, xMin: "0.2", xMax: "0.8" };
    expect(buildSpectralRecipe("fft", settings, [1], dataset)).toMatchObject({
      operation: "fft",
      channels: [{ index: 1, label: "reference" }],
      xMin: 0.2,
      xMax: 0.8,
      resample: false,
    });
  });

  it("requires two correlation channels and valid filter limits", () => {
    expect(validateSpectralSettings("correlation", DEFAULT_SPECTRAL_SETTINGS, [0])).toMatch(/exactly two/);
    expect(validateSpectralSettings("correlation", DEFAULT_SPECTRAL_SETTINGS, [0, 1])).toBe("");
    const band = { ...DEFAULT_SPECTRAL_SETTINGS, filterType: "bandpass" as const, cutoffLow: "10", cutoffHigh: "5" };
    expect(validateSpectralSettings("filter", band, [0])).toMatch(/upper cutoff/);
  });

  it("makes Welch PSD-only and validates its segment contract", () => {
    const invalid = { ...DEFAULT_SPECTRAL_SETTINGS, welch: true, outputType: "magnitude" as const };
    expect(validateSpectralSettings("fft", invalid, [0])).toMatch(/PSD/);
    const valid = { ...invalid, outputType: "psd" as const, segmentLen: "64", overlap: "0.5" };
    expect(validateSpectralSettings("fft", valid, [0])).toBe("");
  });

  it("does not let a hidden invalid FFT field block another operation", () => {
    const staleFft = { ...DEFAULT_SPECTRAL_SETTINGS, zeroPad: "not-a-number" };
    expect(validateSpectralSettings("fft", staleFft, [0])).toMatch(/Zero-padding/);
    expect(validateSpectralSettings("filter", staleFft, [0])).toBe("");
    expect(validateSpectralSettings("correlation", staleFft, [0, 1])).toBe("");
    expect(buildSpectralRecipe("filter", staleFft, [0], dataset).zeroPad).toBe(0);
    expect(buildSpectralRecipe("correlation", staleFft, [0, 1], dataset).zeroPad).toBe(0);
  });

  it("does not persist irrelevant invalid filter fields in an FFT recipe", () => {
    const staleFilter = { ...DEFAULT_SPECTRAL_SETTINGS, cutoffLow: "bad", order: "bad" };
    const recipe = buildSpectralRecipe("fft", staleFilter, [0], dataset);
    expect(recipe.cutoff).toEqual([1]);
    expect(recipe.order).toBe(4);
  });

  it("simplifies reciprocal axis units for frequency controls", () => {
    expect(frequencyUnitOf("s")).toBe("1/s");
    expect(frequencyUnitOf("1/Ang")).toBe("Ang");
    expect(frequencyUnitOf("Å⁻¹")).toBe("Å");
    expect(frequencyUnitOf("nm^-1")).toBe("nm");
    expect(frequencyUnitOf(" ")).toBe("frequency units");
  });
});
