import { describe, expect, it } from "vitest";

import { emptySampleProfile, makeQuantity, type SampleProfile } from "./sampleGeometry";
import { profileFromMetadata, type MetadataFill } from "./sampleProfileMetadata";

function filled(fill: MetadataFill | null): { profile: SampleProfile; filled: string[] } {
  if (fill?.kind !== "fill") throw new Error(`expected a fill, got ${JSON.stringify(fill)}`);
  return fill;
}

describe("profileFromMetadata (the explicit 'Use metadata values' action)", () => {
  it("fills only the fields a stored profile states, keeping the user's others", () => {
    const current = { ...emptySampleProfile(), mass: makeQuantity("mass", 9, "mg") };
    const stored = { ...emptySampleProfile(), geometry: "circle", diameter: makeQuantity("diameter", 3, "mm") };
    const fill = filled(profileFromMetadata({ sample_profile: stored }, current));
    expect(fill.profile.diameter).toEqual({ value: 3, unit: "mm", canonical: expect.closeTo(0.3, 15) });
    expect(fill.profile.mass).toEqual(current.mass);
    expect(current.diameter.value).toBeNull(); // never mutated
  });

  it("adopts the stored geometry when the profile states that geometry's size, and says so", () => {
    const stored = { ...emptySampleProfile(), geometry: "circle", diameter: makeQuantity("diameter", 3, "mm") };
    const fill = filled(profileFromMetadata({ sample_profile: stored }, emptySampleProfile()));
    expect(fill.profile.geometry).toBe("circle");
    expect(fill.filled).toEqual(["Diameter 3 mm", "sample geometry changed to Circular (diameter)"]);
  });

  it("a mass-only stored profile never changes the user's geometry", () => {
    const current = { ...emptySampleProfile(), geometry: "circle" as const };
    const stored = { ...emptySampleProfile(), geometry: "rectangle", mass: makeQuantity("mass", 2, "mg") };
    const fill = filled(profileFromMetadata({ sample_profile: stored }, current));
    expect(fill.profile.geometry).toBe("circle");
    expect(fill.filled).toEqual(["Sample mass 2 mg"]);
  });

  it("an invalid stored geometry is ignored, not read as the sanitizer's rectangle default", () => {
    const current = { ...emptySampleProfile(), geometry: "circle" as const };
    const stored = { ...emptySampleProfile(), geometry: "blob", width: makeQuantity("width", 1, "cm") };
    expect(filled(profileFromMetadata({ sample_profile: stored }, current)).profile.geometry).toBe("circle");
  });

  it("reads a derived dataset's recorded profile", () => {
    const stored = { ...emptySampleProfile(), filmThickness: makeQuantity("filmThickness", 30, "nm") };
    const fill = filled(profileFromMetadata({ magnetometry_normalization: { profile: stored } }, emptySampleProfile()));
    expect(fill.profile.filmThickness.value).toBe(30);
  });

  it("fills a Quantum Design SAMPLE_MASS as an ASSUMED mg and says to verify it", () => {
    const meta = { instrument: { SAMPLE_MASS: "7.2", MOMENT_UNITS: "0", SAMPLE_VOLUME: "22.7", SAMPLE_SIZE: "-1" } };
    const fill = filled(profileFromMetadata(meta, emptySampleProfile(), "emu"));
    expect(fill.profile.mass).toEqual({ value: 7.2, unit: "mg", canonical: expect.closeTo(7.2e-3, 15) });
    expect(fill.profile.volume.value).toBeNull(); // a unitless volume is never read
    expect(fill.filled[0]).toMatch(/states no unit, mg is assumed; verify/);
  });

  it("refuses the QD mass when MOMENT_UNITS is not the emu setting, or the moment is SI", () => {
    const si = profileFromMetadata({ instrument: { SAMPLE_MASS: "7.2", MOMENT_UNITS: "1" } }, emptySampleProfile(), "emu");
    expect(si).toEqual({ kind: "refused", reason: expect.stringMatching(/MOMENT_UNITS is "1".*cannot be assumed/) });
    const am2 = profileFromMetadata({ instrument: { SAMPLE_MASS: "7.2" } }, emptySampleProfile(), "A·m²");
    expect(am2).toEqual({ kind: "refused", reason: expect.stringMatching(/SI \(A·m²\).*cannot be assumed/) });
  });

  it("returns null when nothing usable is stated", () => {
    expect(profileFromMetadata({}, emptySampleProfile())).toBeNull();
    expect(profileFromMetadata({ instrument: { SAMPLE_MASS: "" } }, emptySampleProfile())).toBeNull();
    expect(profileFromMetadata({ instrument: { SAMPLE_MASS: "-2" } }, emptySampleProfile())).toBeNull();
  });
});
