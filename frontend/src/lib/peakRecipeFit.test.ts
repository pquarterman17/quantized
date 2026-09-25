// Peak recipe v2's model-fit section (audit P2.4 slice 3): validation (one
// validator for storage and file), rebuild-from-known-fields, and the
// peak-index remap that keeps each edit with its peak.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIT,
  insertedAt,
  isParamName,
  parseRecipeFit,
  remapFitPeaks,
  removedAt,
  type PeakRecipeFit,
} from "./peakRecipeFit";

const FIT: PeakRecipeFit = {
  engine: "model",
  shapes: [null, "voigt", "lorentzian"],
  background: "quadratic",
  params: {
    "p0.eta": { value: 0.3, vary: false },
    "p1.fwhm_g": { tie: "p0.fwhm" },
    "p2.center": { min: 43, max: 45 },
    "p2.fwhm": { tie: "p1.fwhm_l" },
    "bg.c2": { value: 0, vary: false },
  },
  shareVary: { "p0.fwhm": false },
};

describe("parseRecipeFit", () => {
  it("round-trips a valid section exactly (through JSON) and drops unknown keys", () => {
    expect(parseRecipeFit(JSON.parse(JSON.stringify(FIT)))).toEqual(FIT);
    expect(parseRecipeFit(DEFAULT_FIT)).toEqual(DEFAULT_FIT);
    const extra = { ...FIT, junk: 1, params: { "p0.eta": { value: 0.3, colour: "red" } } };
    expect(parseRecipeFit(extra)).toEqual({ ...FIT, params: { "p0.eta": { value: 0.3 } } });
  });

  it.each([
    ["missing", undefined, /^fit: missing/],
    ["engine", { ...FIT, engine: "turbo" }, /^fit\.engine/],
    ["shape", { ...FIT, shapes: ["gaussian", "pearson"] }, /^fit\.shapes\[1\]/],
    ["background", { ...FIT, background: "cubic" }, /^fit\.background/],
    ["param name", { ...FIT, params: { "p0.sigma": {} } }, /^fit\.params\["p0\.sigma"\]: not a parameter name/],
    ["value", { ...FIT, params: { "p0.center": { value: "3" } } }, /\["p0\.center"\]\.value/],
    ["non-finite", { ...FIT, params: { "p0.center": { value: null } } }, /\["p0\.center"\]\.value/],
    ["vary", { ...FIT, params: { "p0.center": { vary: 1 } } }, /\.vary/],
    ["min > max", { ...FIT, params: { "p0.center": { min: 5, max: 4 } } }, /min > max/],
    ["self tie", { ...FIT, params: { "p0.fwhm": { tie: "p0.fwhm" } } }, /tied to itself/],
    ["kind", { ...FIT, params: { "p1.center": { tie: "p0.height" } } }, /different kind/],
    ["shareVary", { ...FIT, shareVary: { "p0.fwhm": "no" } }, /^fit\.shareVary/],
    ["peak cap", { ...FIT, params: { "p500.center": {} } }, /not a parameter name/],
  ])("fails closed on a bad %s, naming the field", (_label, bad, message) => {
    expect(() => parseRecipeFit(bad)).toThrow(message);
  });

  it("knows the backend's parameter names", () => {
    expect(["p0.center", "p12.fwhm_l", "bg.c0", "bg.c2"].every(isParamName)).toBe(true);
    expect(["p01.center", "bg.c3", "q0.center", "p0.", "__proto__"].some(isParamName)).toBe(false);
  });
});

describe("remapFitPeaks — edits stay with their peak", () => {
  it("a removed peak's edits go; later peaks move down, ties and shapes with them", () => {
    const r = remapFitPeaks(FIT, removedAt(0));
    expect(r.shapes).toEqual(["voigt", "lorentzian"]);
    expect(Object.keys(r.params).sort()).toEqual(["bg.c2", "p0.fwhm_g", "p1.center", "p1.fwhm"]);
    expect(r.params["p0.fwhm_g"]).toEqual({}); // its tie target (old p0) left: the tie is withdrawn
    expect(r.params["p1.fwhm"]).toEqual({ tie: "p0.fwhm_l" });
    expect(r.params["p1.center"]).toEqual({ min: 43, max: 45 });
    expect(r.shareVary).toEqual({});
    expect(r.background).toBe("quadratic");
  });

  it("an inserted peak pushes later ones up and gets no edits of its own", () => {
    const r = remapFitPeaks(FIT, insertedAt(1));
    expect(r.shapes).toEqual([null, null, "voigt", "lorentzian"]);
    expect(r.params["p2.fwhm_g"]).toEqual({ tie: "p0.fwhm" });
    expect(r.params["p3.fwhm"]).toEqual({ tie: "p2.fwhm_l" });
    expect(Object.keys(r.params).some((n) => n.startsWith("p1."))).toBe(false);
    expect(r.shareVary).toEqual({ "p0.fwhm": false });
  });

  it("is the identity for an append (the new peak takes the next index)", () => {
    expect(remapFitPeaks(FIT, insertedAt(3))).toEqual(FIT);
  });
});
