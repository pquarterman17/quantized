import { describe, expect, it } from "vitest";

import { emptySampleProfile, makeQuantity } from "./sampleGeometry";
import { profileFromMetadata } from "./sampleProfileMetadata";

describe("profileFromMetadata (the explicit 'Use metadata values' action)", () => {
  it("fills only the fields a stored profile states, keeping the user's others", () => {
    const current = { ...emptySampleProfile(), mass: makeQuantity("mass", 9, "mg") };
    const stored = { ...emptySampleProfile(), geometry: "circle", diameter: makeQuantity("diameter", 3, "mm") };
    const fill = profileFromMetadata({ sample_profile: stored }, current)!;
    expect(fill.profile.geometry).toBe("circle");
    expect(fill.profile.diameter).toEqual({ value: 3, unit: "mm", canonical: expect.closeTo(0.3, 15) });
    expect(fill.profile.mass).toEqual(current.mass);
    expect(fill.filled).toEqual(["Diameter 3 mm"]);
    expect(current.diameter.value).toBeNull(); // never mutated
  });

  it("reads a derived dataset's recorded profile", () => {
    const stored = { ...emptySampleProfile(), filmThickness: makeQuantity("filmThickness", 30, "nm") };
    const fill = profileFromMetadata({ magnetometry_normalization: { profile: stored } }, emptySampleProfile())!;
    expect(fill.profile.filmThickness.value).toBe(30);
  });

  it("reads a Quantum Design SAMPLE_MASS header in mg and nothing it cannot place", () => {
    const meta = { instrument: { SAMPLE_MASS: "7.2", SAMPLE_VOLUME: "22.7", SAMPLE_SIZE: "-1" } };
    const fill = profileFromMetadata(meta, emptySampleProfile())!;
    expect(fill.profile.mass).toEqual({ value: 7.2, unit: "mg", canonical: expect.closeTo(7.2e-3, 15) });
    expect(fill.profile.volume.value).toBeNull();
    expect(fill.filled).toEqual(["Sample mass 7.2 mg (Quantum Design SAMPLE_MASS header)"]);
  });

  it("returns null when nothing usable is stated", () => {
    expect(profileFromMetadata({}, emptySampleProfile())).toBeNull();
    expect(profileFromMetadata({ instrument: { SAMPLE_MASS: "" } }, emptySampleProfile())).toBeNull();
    expect(profileFromMetadata({ instrument: { SAMPLE_MASS: "-2" } }, emptySampleProfile())).toBeNull();
  });
});
