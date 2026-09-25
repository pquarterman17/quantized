// The client-side mirror of the backend's parameter rules (review item 8):
// every table the UI can produce that /api/peaks/model-fit would reject is
// caught here first, and a seeded table passes.

import { describe, expect, it } from "vitest";

import { setupProblems } from "./modelSetupChecks";
import { patchParam, seedSetup, type ModelSetup, type SeedPeak } from "./peakModelParams";

const X = Array.from({ length: 101 }, (_, i) => i / 10);
const Y = X.map((x) => 1 + 0.2 * x);
const PEAKS: SeedPeak[] = [
  { center: 3, height: 4, bg: 1.6, fwhm: 0.8 },
  { center: 7, height: 2, bg: 2.4, fwhm: 1.2 },
];
const base = (shapes: ModelSetup["shapes"] = ["pseudo_voigt", "voigt"]) =>
  seedSetup(PEAKS, shapes, "linear", X, Y);

describe("setupProblems", () => {
  it("accepts every seeded table, and the recipe's shared links", () => {
    expect(setupProblems(base())).toEqual([]);
    expect(setupProblems(seedSetup(PEAKS, ["pseudo_voigt", "pseudo_voigt"], "quadratic", X, Y, "Shared FWHM + eta"))).toEqual([]);
  });

  it("refuses a tie to a fixed parameter, naming both", () => {
    const s = patchParam(patchParam(base(["gaussian", "gaussian"]), "p1.fwhm", { tie: "p0.fwhm" }), "p0.fwhm", { vary: false });
    expect(setupProblems(s)).toEqual([
      "#2 FWHM is tied to #1 FWHM, which is fixed: make #1 FWHM vary or untie #2 FWHM",
    ]);
  });

  it("refuses ties to itself, to another kind, to nothing, and in a cycle", () => {
    const g = base(["gaussian", "gaussian"]);
    expect(setupProblems(patchParam(g, "p0.fwhm", { tie: "p0.fwhm" }))[0]).toMatch(/tied to itself/);
    expect(setupProblems(patchParam(g, "p0.fwhm", { tie: "p1.center" }))[0]).toMatch(/its own kind/);
    expect(setupProblems(patchParam(g, "p0.fwhm", { tie: "p9.fwhm" }))[0]).toMatch(/unknown/);
    const cyc = patchParam(patchParam(g, "p0.fwhm", { tie: "p1.fwhm" }), "p1.fwhm", { tie: "p0.fwhm" });
    expect(setupProblems(cyc).some((m) => /cycle/.test(m))).toBe(true);
  });

  it("refuses bad bounds and starts", () => {
    const g = base(["gaussian", "gaussian"]);
    expect(setupProblems(patchParam(g, "p0.center", { min: 5, max: 4 }))).toContain("#1 center: min is greater than max");
    expect(setupProblems(patchParam(g, "p0.center", { min: 3, max: 3 }))[0]).toMatch(/min equals max/);
    expect(setupProblems(patchParam(g, "p0.center", { min: 4 }))[0]).toMatch(/start value 3 is outside \[4, 10\]/);
    expect(setupProblems(patchParam(g, "p0.fwhm", { value: 0 }))).toContain("#1 FWHM: a width must be positive");
    expect(setupProblems(patchParam(g, "p0.fwhm", { min: 0 }))).toContain("#1 FWHM: min must be positive for a width");
    // a FIXED parameter's start may sit outside bounds it does not use
    expect(setupProblems(patchParam(g, "p0.center", { min: 4, vary: false }))).toEqual([]);
  });

  it("keeps eta in [0, 1] and a Voigt off the double-zero width", () => {
    const s = base();
    expect(setupProblems(patchParam(s, "p0.eta", { value: 1.5 }))[0]).toMatch(/η must lie in \[0, 1\]/);
    expect(setupProblems(patchParam(s, "p0.eta", { max: 2 }))[0]).toMatch(/η bounds/);
    const zero = patchParam(patchParam(s, "p1.fwhm_g", { value: 0, vary: false }), "p1.fwhm_l", { value: 0, vary: false });
    expect(setupProblems(zero)).toContain("#2: a Voigt needs FWHM g or FWHM l above 0");
    // one fixed zero component is the pure-limit case the backend allows
    expect(setupProblems(patchParam(s, "p1.fwhm_g", { value: 0, vary: false }))).toEqual([]);
  });
});
