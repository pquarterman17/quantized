import { describe, expect, it } from "vitest";

import { wavelengthFromMetadata } from "./xrdWavelength";

describe("wavelengthFromMetadata", () => {
  it("reads io/xrdml.py's `wavelength_a`", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 1.5406 })).toBe(1.5406);
  });

  it("reads io/xrd_csv.py's two Kα1 spellings", () => {
    expect(wavelengthFromMetadata({ k_alpha1: 0.7093 })).toBe(0.7093);
    expect(wavelengthFromMetadata({ kAlpha1: 0.5594 })).toBe(0.5594);
  });

  it("reads io/bruker_raw.py's `alpha_average`", () => {
    expect(wavelengthFromMetadata({ alpha_average: 1.5418 })).toBe(1.5418);
  });

  it("prefers an explicit Kα1 over the Kα1/Kα2 average", () => {
    expect(wavelengthFromMetadata({ alpha_average: 1.5418, k_alpha1: 1.5406 })).toBe(1.5406);
  });

  it("accepts a numeric string (some headers round-trip as text)", () => {
    expect(wavelengthFromMetadata({ wavelength_a: "1.5406" })).toBe(1.5406);
  });

  it("returns null for absent, empty, null and non-numeric metadata", () => {
    expect(wavelengthFromMetadata(undefined)).toBeNull();
    expect(wavelengthFromMetadata({})).toBeNull();
    expect(wavelengthFromMetadata({ wavelength_a: null })).toBeNull();
    expect(wavelengthFromMetadata({ wavelength_a: "Cu Ka" })).toBeNull();
  });

  it("rejects a zero/negative placeholder", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 0 })).toBeNull();
    expect(wavelengthFromMetadata({ wavelength_a: -1.54 })).toBeNull();
  });

  it("rejects a wrong-unit value rather than scaling a grain size by 10x", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 0.15406 })).toBeNull(); // nm
    expect(wavelengthFromMetadata({ wavelength_a: 154.06 })).toBeNull(); // pm
  });

  it("still accepts the shortest lab anode line at the floor (W Kα1)", () => {
    expect(wavelengthFromMetadata({ k_alpha1: 0.209 })).toBe(0.209);
  });

  it("falls through a rejected key to a plausible later one", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 0, alpha_average: 1.5418 })).toBe(1.5418);
  });
});
