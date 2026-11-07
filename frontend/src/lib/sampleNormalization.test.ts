import { describe, expect, it } from "vitest";

import { emptySampleProfile, makeQuantity, type SampleProfile } from "./sampleGeometry";
import {
  BASIS_OUTPUT_UNITS,
  fieldsFor,
  geometriesFor,
  OUTPUT_PER_EMU,
  outputUnitsFor,
  summarizeNormalization,
} from "./sampleNormalization";

/** The owner's representative sample: 5 cm × 5 cm, 30 nm magnetic film. */
function film(): SampleProfile {
  return {
    ...emptySampleProfile(),
    geometry: "rectangle",
    width: makeQuantity("width", 5, "cm"),
    length: makeQuantity("length", 5, "cm"),
    filmThickness: makeQuantity("filmThickness", 30, "nm"),
  };
}

describe("basis-dependent output units", () => {
  it("offers one family per basis, never a mixed list", () => {
    expect(outputUnitsFor("none", "emu")).toEqual(["emu", "A·m²"]);
    expect(outputUnitsFor("mass", "emu")).toEqual(["emu/g", "A·m²/kg"]);
    expect(outputUnitsFor("volume", "emu")).toEqual(["emu/cm³", "A/m", "kA/m"]);
    expect(outputUnitsFor("area", "A·m²")).toEqual(["emu/cm²", "A·m²/m²"]);
  });

  it("never offers to normalize an already-normalized source again", () => {
    expect(outputUnitsFor("none", "emu/g")).toEqual(["emu/g"]);
    expect(outputUnitsFor("volume", "A/m")).toEqual([]);
    const s = summarizeNormalization(film(), "volume", "emu/cm³", "A/m");
    expect(s.problem).toMatch(/already normalized \(emu\/cm³\)/);
  });

  it("matches the backend's dimensional factors", () => {
    expect(OUTPUT_PER_EMU["A/m"] / OUTPUT_PER_EMU["emu/cm³"]).toBe(1000); // 1 emu/cm³ = 1000 A/m
    expect(OUTPUT_PER_EMU["A·m²/m²"]).toBeCloseTo(1e-3 / 1e-4, 15);
    expect(OUTPUT_PER_EMU["A·m²/kg"]).toBeCloseTo(1e-3 / 1e-3, 15);
    for (const units of Object.values(BASIS_OUTPUT_UNITS)) for (const u of units) expect(OUTPUT_PER_EMU[u]).toBeGreaterThan(0);
  });

  it("asks only for the fields the chosen path uses", () => {
    expect(geometriesFor("area")).not.toContain("volume");
    expect(fieldsFor("area", "rectangle")).toEqual(["width", "length"]);
    expect(fieldsFor("volume", "circle")).toEqual(["diameter", "filmThickness"]);
    expect(fieldsFor("volume", "volume")).toEqual(["volume"]);
    expect(fieldsFor("mass", "circle")).toEqual(["mass"]);
  });
});

describe("live calculation summary", () => {
  it("5 cm × 5 cm × 30 nm -> emu/cm³ and A/m", () => {
    // A = 25 cm²; t = 30 nm = 3e-6 cm; V = 7.5e-5 cm³.
    // 1 emu/cm³ = 1000 A/m, so the A/m factor is 1000 / 7.5e-5 = 1.333…e7.
    const cgs = summarizeNormalization(film(), "volume", "emu", "emu/cm³");
    expect(cgs.problem).toBeNull();
    expect(cgs.areaCm2).toBeCloseTo(25, 12);
    expect(cgs.volumeCm3).toBeCloseTo(7.5e-5, 18);
    expect(cgs.divisor).toBeCloseTo(7.5e-5, 18);
    expect(cgs.divisorUnit).toBe("cm³");
    expect(cgs.factor! * 1.5e-3).toBeCloseTo(20, 9); // 1.5e-3 emu -> 20 emu/cm³
    expect(cgs.equation).toBe("M [emu/cm³] = m [emu] / V [cm³]");
    expect(cgs.geometryEquation).toBe("A = w × l = 5 cm × 5 cm = 25 cm²; V = A × t_film = 25 cm² × 0.000003 cm = 0.000075 cm³");
    const si = summarizeNormalization(film(), "volume", "emu", "A/m");
    expect(si.factor! * 1.5e-3).toBeCloseTo(20_000, 6);
    expect(si.equation).toBe("M [A/m] = m [emu] × 1000 / V [cm³]");
  });

  it("area basis ignores thickness entirely", () => {
    const p = { ...film(), filmThickness: makeQuantity("filmThickness", -1, "nm") };
    const s = summarizeNormalization(p, "area", "emu", "A·m²/m²");
    expect(s.problem).toBeNull();
    expect(s.fields).toEqual(["width", "length"]);
    expect(s.factor).toBeCloseTo(10 / 25, 15); // 1 emu/cm² = 10 A·m²/m²
  });

  it("names the exact field for missing, zero, negative and NaN entries", () => {
    const cases: [number | null, RegExp][] = [
      [null, /^Magnetic-film thickness is required\.$/],
      [0, /^Magnetic-film thickness must be greater than zero\.$/],
      [-30, /^Magnetic-film thickness must be greater than zero\.$/],
      [Number.NaN, /^Magnetic-film thickness must be a number\.$/],
    ];
    for (const [value, msg] of cases) {
      const s = summarizeNormalization({ ...film(), filmThickness: makeQuantity("filmThickness", value, "nm") }, "volume", "emu", "A/m");
      expect(Object.keys(s.fieldErrors)).toEqual(["filmThickness"]);
      expect(s.fieldErrors.filmThickness).toMatch(msg);
      expect(s.problem).toMatch(msg);
      expect(s.factor).toBeNull();
    }
  });

  it("reports every bad field at once", () => {
    const s = summarizeNormalization({ ...emptySampleProfile(), geometry: "circle" }, "volume", "emu", "emu/cm³");
    expect(Object.keys(s.fieldErrors).sort()).toEqual(["diameter", "filmThickness"]);
  });

  it("mass basis: emu/g equals A·m²/kg numerically", () => {
    const p = { ...emptySampleProfile(), mass: makeQuantity("mass", 2, "mg") };
    const a = summarizeNormalization(p, "mass", "emu", "emu/g");
    const b = summarizeNormalization(p, "mass", "emu", "A·m²/kg");
    expect(a.factor).toBeCloseTo(500, 9);
    expect(b.factor).toBe(a.factor);
    expect(a.massG).toBeCloseTo(2e-3, 15);
  });

  it("raw basis from A·m²", () => {
    expect(summarizeNormalization(emptySampleProfile(), "none", "A·m²", "emu").factor).toBe(1000);
    expect(summarizeNormalization(emptySampleProfile(), "none", "emu", "A·m²").factor).toBe(1e-3);
  });

  it("refuses an output unit outside the basis family", () => {
    expect(summarizeNormalization(film(), "volume", "emu", "emu/g").problem).toMatch(/Choose an output unit/);
  });
});
