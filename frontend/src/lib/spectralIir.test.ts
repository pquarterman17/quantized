import { describe, expect, it } from "vitest";

import { sanitizeSignalAnalysisRecipe } from "./signalRecipe";
import { iirRequest, iirSpecProblem, sanitizeIirSpec, type IirSpec } from "./spectralIir";
import { DEFAULT_SPECTRAL_RECIPE, sanitizeSpectralRecipe, spectralRequest, type SpectralAnalysisRecipe } from "./spectralWorkbench";
import type { DataStruct } from "./types";

const ELLIP: IirSpec = { family: "ellip", btype: "bandstop", order: 3, cutoff: [1, 2], rp: 1, rs: 40, zeroPhase: true };
const recipe = (iir: unknown, over: Partial<SpectralAnalysisRecipe> = {}) => ({
  ...DEFAULT_SPECTRAL_RECIPE,
  operation: "filter",
  channels: [{ index: 0, label: "signal" }],
  iir,
  ...over,
});
const data: DataStruct = { time: [0, 1], values: [[1], [2]], labels: ["signal"], units: ["V"], metadata: {} };

describe("IIR recipe block", () => {
  it("round-trips every family through the recipe sanitizers", () => {
    const specs: IirSpec[] = [
      { family: "butter", btype: "lowpass", order: 4, cutoff: [5], zeroPhase: false },
      { family: "cheby1", btype: "highpass", order: 4, cutoff: [5], rp: 0.5, zeroPhase: true },
      { family: "cheby2", btype: "bandpass", order: 4, cutoff: [5, 9], rs: 40, zeroPhase: false },
      ELLIP,
      { family: "bessel", btype: "lowpass", order: 4, cutoff: [5], besselNorm: "mag", zeroPhase: false },
    ];
    for (const spec of specs) {
      const r = recipe(spec) as SpectralAnalysisRecipe;
      expect(sanitizeSpectralRecipe(structuredClone(r))).toEqual(r);
      expect(sanitizeSignalAnalysisRecipe(JSON.parse(JSON.stringify(r)))).toEqual(r);
    }
  });

  it("keeps recipes without an iir block byte-identical (no iir key appears)", () => {
    const plain = recipe(undefined);
    delete (plain as { iir?: unknown }).iir;
    expect(sanitizeSpectralRecipe(plain)).not.toHaveProperty("iir");
  });

  it("rejects malformed blocks and an iir block on a non-filter operation", () => {
    for (const bad of [
      { ...ELLIP, family: "nope" },
      { ...ELLIP, order: 21 },
      { ...ELLIP, order: 2.5 },
      { ...ELLIP, cutoff: [2, 1] },
      { ...ELLIP, cutoff: [1] },
      { ...ELLIP, rp: undefined },
      { ...ELLIP, rs: 0.5 },
      { ...ELLIP, zeroPhase: "yes" },
      { ...ELLIP, extra: 1 },
      { family: "butter", btype: "lowpass", order: 2, cutoff: [5], rp: 1, zeroPhase: false },
      { family: "butter", btype: "lowpass", order: 2, cutoff: [5], besselNorm: "mag", zeroPhase: false },
      "ellip",
    ]) {
      expect(sanitizeSpectralRecipe(recipe(bad))).toBeUndefined();
    }
    expect(sanitizeSpectralRecipe(recipe(ELLIP, { operation: "fft" }))).toBeUndefined();
    expect(sanitizeIirSpec(null)).toBeUndefined();
  });

  it("maps onto the snake-case wire contract and only sends iir when present", () => {
    expect(iirRequest(ELLIP)).toEqual({ family: "ellip", btype: "bandstop", order: 3, cutoff: [1, 2], rp: 1, rs: 40, zero_phase: true });
    expect(spectralRequest(data, recipe(ELLIP) as SpectralAnalysisRecipe)).toMatchObject({ operation: "filter", iir: { zero_phase: true } });
    expect(spectralRequest(data, { ...recipe(undefined), iir: undefined } as SpectralAnalysisRecipe)).not.toHaveProperty("iir");
    expect(iirSpecProblem(ELLIP)).toBe("");
  });
});
