import { describe, expect, it } from "vitest";

import { wavelengthFromMetadata } from "./xrdWavelength";

describe("wavelengthFromMetadata", () => {
  it("reads io/xrdml.py's `wavelength_a`", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 1.5406 })).toBe(1.5406);
  });

  it("reads io/_xrdml_scan.py's `wavelength_a` the same way", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 0.7093 })).toBe(0.7093);
  });

  it("ignores `k_alpha1`/`kAlpha1` — NO parser writes either (review round 2)", () => {
    // io/xrd_csv.py:285 reads them in the ASCII EXPORTER's header writer and
    // io/xrdml.py:86 is an XML element name; neither is a metadata key any
    // importer emits. Reading them here was dead code that made the module
    // header's key list wrong.
    expect(wavelengthFromMetadata({ k_alpha1: 0.7093 })).toBeNull();
    expect(wavelengthFromMetadata({ kAlpha1: 0.5594 })).toBeNull();
  });

  it("reads io/bruker_raw.py's `alpha_average`", () => {
    expect(wavelengthFromMetadata({ alpha_average: 1.5418 })).toBe(1.5418);
  });

  it("prefers the explicit Kα1 (`wavelength_a`) over the Kα1/Kα2 average", () => {
    expect(wavelengthFromMetadata({ alpha_average: 1.5418, wavelength_a: 1.5406 })).toBe(1.5406);
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
    expect(wavelengthFromMetadata({ wavelength_a: 0.209 })).toBe(0.209);
  });

  it("falls through a rejected key to a plausible later one", () => {
    expect(wavelengthFromMetadata({ wavelength_a: 0, alpha_average: 1.5418 })).toBe(1.5418);
  });
});
