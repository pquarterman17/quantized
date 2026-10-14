import { describe, expect, it } from "vitest";
import { DEFAULT_MAG_NORMALIZATION, areaThicknessVolumeInCm3, circularVolumeInCm3, directVolumeInCm3, massInGrams, normalizationProblem, rectangularVolumeInCm3 } from "./sampleGeometry";

describe("sample geometry conversions", () => {
  it("converts mass and direct volume into backend units", () => {
    expect(massInGrams(250, "mg")).toBeCloseTo(0.25);
    expect(directVolumeInCm3(2_000, "mm³")).toBeCloseTo(2);
  });

  it("computes a thin-film volume from mixed length units", () => {
    expect(rectangularVolumeInCm3(5, "cm", 5, "cm", 30, "nm")).toBeCloseTo(7.5e-5);
  });

  it("supports direct-area and circular-film geometry", () => {
    expect(areaThicknessVolumeInCm3(25, "cm²", 30, "nm")).toBeCloseTo(7.5e-5);
    expect(circularVolumeInCm3(10, "mm", 1, "µm")).toBeCloseTo(Math.PI * 0.5 ** 2 * 1e-4);
    expect(directVolumeInCm3(250, "µL")).toBeCloseTo(0.25);
  });

  it("rejects zero, negative, and non-finite dimensions", () => {
    expect(massInGrams(0, "g")).toBeNull();
    expect(directVolumeInCm3(Number.NaN, "cm³")).toBeNull();
    expect(rectangularVolumeInCm3(1, "cm", -1, "cm", 1, "nm")).toBeNull();
  });

  it("requires geometry for a new volume-normalized target", () => {
    expect(normalizationProblem({ ...DEFAULT_MAG_NORMALIZATION, fromMoment: "emu", toMoment: "A/m" })).toMatch(/positive sample geometry/);
  });
});
