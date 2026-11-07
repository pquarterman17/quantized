// The live normalization preview (lib/sampleNormalization.ts,
// lib/sampleGeometry.ts) mirrors the backend unit tables. This pins the
// frontend copies to the shared fixture; tests/test_normalization_units_parity.py
// pins the Python tables (calc/magnetometry_normalization.py,
// calc/sample_geometry.py) to the same file, so the two cannot drift apart.

import { describe, expect, it } from "vitest";

import fixture from "./__fixtures__/normalizationUnits.json";
import { FIELD_SPECS } from "./sampleGeometry";
import { BASIS_OUTPUT_UNITS, OUTPUT_PER_EMU, RAW_MOMENT_TO_EMU } from "./sampleNormalization";

describe("normalization unit tables match the backend", () => {
  it("moment tables", () => {
    expect(RAW_MOMENT_TO_EMU).toEqual(fixture.raw_moment_to_emu);
    expect(BASIS_OUTPUT_UNITS).toEqual(fixture.basis_output_units);
    expect(OUTPUT_PER_EMU).toEqual(fixture.output_per_emu);
  });

  it("sample-geometry unit tables", () => {
    expect(FIELD_SPECS.mass.toCanonical).toEqual(fixture.mass_to_g);
    expect(FIELD_SPECS.volume.toCanonical).toEqual(fixture.volume_to_cm3);
    expect(FIELD_SPECS.area.toCanonical).toEqual(fixture.area_to_cm2);
    for (const f of ["width", "length", "diameter", "filmThickness"] as const) {
      expect(FIELD_SPECS[f].toCanonical).toEqual(fixture.length_to_cm);
    }
  });
});
