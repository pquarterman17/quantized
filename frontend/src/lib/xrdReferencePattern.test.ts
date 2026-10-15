import { describe, expect, it } from "vitest";

import { convertReferencePattern, convertTwoTheta, parseReferencePatternText } from "./xrdReferencePattern";

describe("parseReferencePatternText", () => {
  it("parses, normalizes, labels, sorts, and deduplicates a CSV pattern", () => {
    const parsed = parseReferencePatternText(
      "# wavelength = 1.5406\nIntensity,2theta,hkl\n50,30,(1 0 0)\n100,20,(0 0 1)\n75,30,(1 1 0)\n",
      "phase.csv",
    );
    expect(parsed.name).toBe("phase");
    expect(parsed.sourceWavelengthA).toBe(1.5406);
    expect(parsed.reflections).toEqual([
      { twoTheta: 20, intensity: 1, label: "(0 0 1)" },
      { twoTheta: 30, intensity: 0.75, label: "(1 0 0), (1 1 0)" },
    ]);
    expect(parsed.warnings.at(-1)).toContain("duplicate");
  });

  it("accepts a common headerless whitespace pattern but warns", () => {
    const parsed = parseReferencePatternText("10 5\n20 10\n", "sticks.xy");
    expect(parsed.reflections.map((row) => row.intensity)).toEqual([0.5, 1]);
    expect(parsed.warnings[0]).toContain("Headerless");
  });

  it("accepts unit-suffixed headers and quoted comma-containing hkl labels", () => {
    const parsed = parseReferencePatternText('2theta (deg),relative_intensity (%),hkl\n20,50,"(1, 1, 1)"', "quoted.csv");
    expect(parsed.reflections[0]).toEqual({ twoTheta: 20, intensity: 1, label: "(1, 1, 1)" });
  });

  it("preserves reflection identities from separate h, k, and l columns", () => {
    const parsed = parseReferencePatternText("2theta intensity h k l\n28.44 100 1 1 1", "silicon.xy");
    expect(parsed.reflections[0].label).toBe("(1 1 1)");
  });

  it("fails closed for a declared q axis", () => {
    expect(() => parseReferencePatternText("q,intensity\n1,10", "bad.csv")).toThrow(/non-2θ axis/);
    expect(() => parseReferencePatternText("Q [1/Angstrom],counts\n1,10", "bad.csv")).toThrow(/non-2θ axis/);
    expect(() => parseReferencePatternText("d-spacing (Å),intensity\n2,10", "bad.csv")).toThrow(/non-2θ axis/);
  });

  it("allows an explicit override for a mislabeled first column", () => {
    expect(parseReferencePatternText("q,intensity\n20,10", "bad.csv", "two-theta").reflections[0].twoTheta).toBe(20);
  });

  it("rejects invalid and zero-only inputs", () => {
    expect(() => parseReferencePatternText("2theta,intensity\n20,0", "zero.csv")).toThrow(/all zero/);
    expect(() => parseReferencePatternText("hello", "empty.csv")).toThrow(/identify/);
  });
});

describe("reference wavelength conversion", () => {
  it("round-trips a reflection through Bragg d spacing", () => {
    const mo = convertTwoTheta(30, 1.5406, 0.7093);
    expect(mo).not.toBeNull();
    expect(convertTwoTheta(mo!, 0.7093, 1.5406)).toBeCloseTo(30, 10);
  });

  it("reports geometrically impossible converted reflections", () => {
    const result = convertReferencePattern([{ twoTheta: 120, intensity: 1, label: "" }], 0.5, 2);
    expect(result.reflections).toEqual([]);
    expect(result.dropped).toBe(1);
  });

  it("does not claim conversion without both wavelengths", () => {
    const rows = [{ twoTheta: 20, intensity: 1, label: "" }];
    expect(convertReferencePattern(rows, null, 1.5406)).toEqual({ reflections: rows, converted: false, dropped: 0 });
  });
});
