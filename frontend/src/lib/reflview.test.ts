import { describe, expect, it } from "vitest";

import {
  autoPair,
  buildReflPanels,
  isProfile,
  isReflCurve,
  reflStem,
} from "./reflview";
import type { DataStruct } from "./types";

const reflDs: DataStruct = {
  time: [0.01, 0.02, 0.03],
  values: [
    [0.0007, 0.99, 0.007, 1.05, 0.12],
    [0.0007, 1.0, 0.007, 1.04, 0.1],
    [0.0007, 0.98, 0.007, 1.04, 0.09],
  ],
  labels: ["dQ", "R", "dR", "theory", "fresnel"],
  units: ["1/A", "", "", "", ""],
  metadata: { x_column_name: "Q", x_column_unit: "1/A" },
};

const profileDs: DataStruct = {
  time: [-10, -9.9, -9.8],
  values: [
    [20.0, 0.74],
    [20.0, 0.74],
    [20.0, 0.74],
  ],
  labels: ["rho", "irho"],
  units: ["1e-6/A2", "1e-6/A2"],
  metadata: { x_column_name: "z", x_column_unit: "A" },
};

describe("classification", () => {
  it("recognizes a reflectivity curve (R + theory)", () => {
    expect(isReflCurve(reflDs)).toBe(true);
    expect(isReflCurve(profileDs)).toBe(false);
  });
  it("recognizes an SLD profile (rho)", () => {
    expect(isProfile(profileDs)).toBe(true);
    expect(isProfile(reflDs)).toBe(false);
  });
});

describe("reflStem", () => {
  it("strips the role suffix and extension", () => {
    expect(reflStem("NbAl_XRR-refl.dat")).toBe("NbAl_XRR");
    expect(reflStem("NbAl_XRR-profile.dat")).toBe("NbAl_XRR");
    expect(reflStem("J395_dsf01-refl-fix.dat")).toBe("J395_dsf01");
    expect(reflStem("J395_dsf01-profile-edit.dat")).toBe("J395_dsf01");
    expect(reflStem("plain.dat")).toBe("plain");
  });
});

describe("buildReflPanels", () => {
  it("packs R + theory + fresnel vs Q on top", () => {
    const { top } = buildReflPanels(reflDs, null);
    expect(top?.series.map((s) => s.label)).toEqual(["R", "theory", "fresnel"]);
    expect(top?.xLabel).toBe("Q");
    expect(top?.data[0]).toEqual([0.01, 0.02, 0.03]); // Q
    expect(top?.data[1]).toEqual([0.99, 1.0, 0.98]); // R
  });
  it("packs rho + irho vs z on the bottom", () => {
    const { bottom } = buildReflPanels(null, profileDs);
    expect(bottom?.series.map((s) => s.label)).toEqual(["rho", "irho"]);
    expect(bottom?.xLabel).toBe("z");
    expect(bottom?.data[1]).toEqual([20.0, 20.0, 20.0]); // rho
  });
  it("returns null frames for absent datasets", () => {
    expect(buildReflPanels(null, null)).toEqual({ top: null, bottom: null });
  });
});

describe("autoPair", () => {
  it("pairs refl + profile by shared stem", () => {
    const sets = [
      { id: "r", name: "NbAl_XRR-refl.dat", data: reflDs },
      { id: "p", name: "NbAl_XRR-profile.dat", data: profileDs },
      { id: "x", name: "other.dat", data: profileDs },
    ];
    expect(autoPair(sets)).toEqual({ reflId: "r", profileId: "p" });
  });
  it("falls back to the first of each kind without a stem match", () => {
    const sets = [
      { id: "r", name: "a-refl.dat", data: reflDs },
      { id: "p", name: "b-profile.dat", data: profileDs },
    ];
    expect(autoPair(sets)).toEqual({ reflId: "r", profileId: "p" });
  });
  it("returns nulls when nothing matches", () => {
    expect(autoPair([])).toEqual({ reflId: null, profileId: null });
  });
});
