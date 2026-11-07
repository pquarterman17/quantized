import { describe, expect, it } from "vitest";

import { normalizationProvenance, usedProfile, withFieldConversion } from "./normalizationProvenance";
import { emptySampleProfile, makeQuantity, type SampleProfile } from "./sampleGeometry";
import { summarizeNormalization } from "./sampleNormalization";

/** 5 cm × 5 cm × 30 nm film, plus a mass and an INVALID diameter the volume
 *  calculation does not use (they must not leak into the record). */
function profile(): SampleProfile {
  return {
    ...emptySampleProfile(), geometry: "rectangle",
    width: makeQuantity("width", 5, "cm"), length: makeQuantity("length", 5, "cm"),
    filmThickness: makeQuantity("filmThickness", 30, "nm"),
    mass: makeQuantity("mass", 2, "mg"), diameter: makeQuantity("diameter", Number.NaN, "mm"),
  };
}

const RECORD = {
  // Hand-computed, not taken from the summary: V = 25 cm² × 3e-6 cm = 7.5e-5 cm³,
  // and 1 emu/cm³ = 1000 A/m, so the emu -> A/m factor is 1000 / 7.5e-5.
  factor: 1000 / 7.5e-5, divisor: 7.5e-5, divisor_unit: "cm³", mass_g: null, area_cm2: 25, volume_cm3: 7.5e-5,
  canonical: { width: 5, length: 5, film_thickness: 3e-6 }, equation: "M [A/m] = m [emu] × 1000 / V [cm³]", geometry_equation: "g",
};
const SOURCE = { datasetId: "d1", datasetName: "film.dat", xKey: 2, yKey: 3, channel: "Moment", xUnit: "Oe" };

describe("normalization provenance", () => {
  it("records every used input, the source channel indices, and the formula", () => {
    const summary = summarizeNormalization(profile(), "volume", "emu", "A/m");
    const prov = normalizationProvenance({ profile: profile(), summary, record: RECORD, source: SOURCE, toField: "T" });
    expect(prov).toMatchObject({
      version: 1, basis: "volume", geometry: "rectangle", from_moment: "emu", to_moment: "A/m",
      from_field: "Oe", to_field: "T", factor: 1000 / 7.5e-5, divisor: 7.5e-5, sample_volume_cm3: 7.5e-5,
      source_dataset_id: "d1", source_x_key: 2, source_y_key: 3, source_channel: "Moment",
    });
    expect(prov.inputs).toEqual({
      width: { label: "Width", value: 5, unit: "cm", canonical: 5, canonical_unit: "cm" },
      length: { label: "Length", value: 5, unit: "cm", canonical: 5, canonical_unit: "cm" },
      film_thickness: { label: "Magnetic-film thickness", value: 30, unit: "nm", canonical: 3e-6, canonical_unit: "cm" },
    });
  });

  it("stores a sanitized profile holding only the used fields, stable through JSON", () => {
    const summary = summarizeNormalization(profile(), "volume", "emu", "A/m");
    const prov = normalizationProvenance({ profile: profile(), summary, record: RECORD, source: SOURCE, toField: "T" });
    const stored = prov.profile as SampleProfile;
    expect(stored.mass).toEqual({ value: null, unit: "mg", canonical: null }); // unused -> blank
    expect(stored.diameter).toEqual({ value: null, unit: "mm", canonical: null }); // NaN never stored
    expect(stored.filmThickness.value).toBe(30);
    expect(JSON.parse(JSON.stringify(prov))).toEqual(prov);
  });

  it("usedProfile drops everything outside the list", () => {
    const p = usedProfile(profile(), ["mass"]);
    expect(p.mass.value).toBe(2);
    expect(p.width.value).toBeNull();
  });

  it("a field-only follow-up updates the field portion and chains the conversion", () => {
    const prior = { basis: "mass", to_moment: "emu/g", from_field: "Oe", to_field: "Oe" };
    const conv = { from_field: "Oe", to_field: "T", source_dataset_id: "d2", source_dataset_name: "a (emu/g)" };
    const once = withFieldConversion(prior, conv)!;
    expect(once).toEqual({ ...prior, to_field: "T", field_conversions: [conv] });
    const conv2 = { ...conv, from_field: "T", to_field: "mT" };
    expect(withFieldConversion(once, conv2)).toMatchObject({ to_field: "mT", field_conversions: [conv, conv2] });
    expect(withFieldConversion(undefined, conv)).toBeNull();
  });
});
