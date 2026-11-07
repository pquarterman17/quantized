import { describe, expect, it } from "vitest";

import {
  convertQuantityUnit,
  emptySampleProfile,
  makeQuantity,
  massInGrams,
  profileWire,
  sanitizeSampleProfile,
  sanitizeSavedSampleProfiles,
  SAMPLE_PROFILE_VERSION,
  type SampleProfile,
} from "./sampleGeometry";

describe("SampleProfile canonical values", () => {
  it("converts each field to its canonical unit (g, cm, cm², cm³)", () => {
    expect(massInGrams(250, "mg")).toBeCloseTo(0.25);
    expect(makeQuantity("mass", 250, "µg").canonical).toBeCloseTo(2.5e-4);
    expect(makeQuantity("filmThickness", 30, "nm").canonical).toBeCloseTo(3e-6);
    expect(makeQuantity("filmThickness", 50, "Å").canonical).toBeCloseTo(5e-7);
    expect(makeQuantity("area", 150, "mm²").canonical).toBeCloseTo(1.5);
    expect(makeQuantity("volume", 2, "µL").canonical).toBeCloseTo(2e-3);
    expect(makeQuantity("volume", 3e-9, "m³").canonical).toBeCloseTo(3e-3);
    expect(makeQuantity("width", 2, "m").canonical).toBe(200);
  });

  it("accepts the Greek mu spelling as the micro sign", () => {
    expect(makeQuantity("mass", 1, "μg").canonical).toBeCloseTo(1e-6);
  });

  it("returns no canonical value for a blank, NaN or unknown-unit entry", () => {
    expect(makeQuantity("width", null, "cm").canonical).toBeNull();
    expect(makeQuantity("width", Number.NaN, "cm").canonical).toBeNull();
    expect(makeQuantity("width", 1, "furlong").canonical).toBeNull();
  });
});

describe("unit changes preserve the physical value", () => {
  it("re-expresses the entered number so the canonical value is unchanged", () => {
    const cm = makeQuantity("width", 5, "cm");
    const mm = convertQuantityUnit("width", cm, "mm");
    expect(mm).toEqual({ value: 50, unit: "mm", canonical: 5 });
    const nm = makeQuantity("filmThickness", 30, "nm");
    const angstrom = convertQuantityUnit("filmThickness", nm, "Å");
    expect(angstrom.value).toBe(300);
    expect(angstrom.canonical).toBeCloseTo(nm.canonical!, 15);
    expect(convertQuantityUnit("filmThickness", angstrom, "nm").value).toBe(30);
  });

  it("rounds away binary noise from a chain of conversions", () => {
    let q = makeQuantity("mass", 0.1, "mg");
    for (const unit of ["µg", "g", "kg", "mg"]) q = convertQuantityUnit("mass", q, unit);
    expect(q.value).toBe(0.1);
  });

  it("keeps a blank or invalid entry as entered (nothing physical to preserve)", () => {
    expect(convertQuantityUnit("width", makeQuantity("width", null, "cm"), "mm")).toEqual({ value: null, unit: "mm", canonical: null });
    expect(Number.isNaN(convertQuantityUnit("width", makeQuantity("width", Number.NaN, "cm"), "mm").value)).toBe(true);
  });
});

describe("sanitizeSampleProfile", () => {
  it("round-trips a profile and recomputes canonical values from value + unit", () => {
    const p: SampleProfile = { ...emptySampleProfile(), width: makeQuantity("width", 5, "cm") };
    const tampered = JSON.parse(JSON.stringify(p));
    tampered.width.canonical = 999; // a hand-edited canonical never wins
    expect(sanitizeSampleProfile(tampered)).toEqual(p);
  });

  it("refuses unknown versions and non-objects", () => {
    expect(sanitizeSampleProfile({ ...emptySampleProfile(), version: SAMPLE_PROFILE_VERSION + 1 })).toBeNull();
    expect(sanitizeSampleProfile(null)).toBeNull();
    expect(sanitizeSampleProfile("profile")).toBeNull();
  });

  it("drops a value whose unit it does not know rather than guessing", () => {
    const raw = { ...emptySampleProfile(), mass: { value: 3, unit: "lb", canonical: 1361 } };
    expect(sanitizeSampleProfile(raw)!.mass).toEqual({ value: null, unit: "mg", canonical: null });
  });

  it("drops non-finite values and defaults a bad geometry", () => {
    const raw = { ...emptySampleProfile(), geometry: "blob", area: { value: "12", unit: "cm²" } };
    const out = sanitizeSampleProfile(raw)!;
    expect(out.geometry).toBe("rectangle");
    expect(out.area.value).toBeNull();
  });
});

describe("sanitizeSavedSampleProfiles", () => {
  it("drops malformed entries and duplicate ids, trims names", () => {
    const profile = { ...emptySampleProfile(), mass: makeQuantity("mass", 2, "mg") };
    const out = sanitizeSavedSampleProfiles([
      { id: "a", name: "  Film A ", savedAt: "2026-11-07T00:00:00.000Z", profile },
      { id: "a", name: "dupe", profile },
      { id: "b", name: "", profile },
      { id: "c", name: "future", profile: { ...profile, version: 2 } },
      "junk",
    ]);
    expect(out).toEqual([{ id: "a", name: "Film A", savedAt: "2026-11-07T00:00:00.000Z", profile }]);
    expect(sanitizeSavedSampleProfiles({})).toEqual([]);
  });
});

describe("profileWire", () => {
  it("sends entered values + units under the backend's field names, NaN as blank", () => {
    const p = { ...emptySampleProfile(), filmThickness: makeQuantity("filmThickness", 30, "nm"), width: makeQuantity("width", Number.NaN, "cm") };
    const wire = profileWire(p);
    expect(wire.film_thickness).toEqual({ value: 30, unit: "nm" });
    expect(wire.width).toEqual({ value: null, unit: "cm" });
    expect(Object.keys(wire).sort()).toEqual(["area", "diameter", "film_thickness", "length", "mass", "volume", "width"]);
  });
});
