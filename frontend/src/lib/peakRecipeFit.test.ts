// Peak recipe v2's model-fit section (audit P2.4 slice 3): validation (one
// validator for storage and file), rebuild-from-known-fields, and the
// peak-index remap that keeps each edit with its peak.

import { describe, expect, it } from "vitest";

import {
  DEFAULT_FIT,
  extractPeak,
  insertedAt,
  insertPeak,
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
  shareFwhm: true,
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
    ["peak cap", { ...FIT, params: { "p500.center": {} } }, /peak index over 499/],
    ["shareFwhm", { ...FIT, shareFwhm: "yes" }, /^fit\.shareFwhm/],
  ])("fails closed on a bad %s, naming the field", (_label, bad, message) => {
    expect(() => parseRecipeFit(bad)).toThrow(message);
  });

  it("tolerant mode (the storage boundary) drops an unusable edit FIELD with a warning; structure still fails", () => {
    const warnings: string[] = [];
    const loose = { ...FIT, params: { "p0.center": { value: 3, min: 5, max: 4 }, "p700.eta": { value: 0.1 }, "p1.fwhm": { tie: "p999.fwhm" } } };
    expect(parseRecipeFit(loose, warnings).params).toEqual({ "p0.center": { value: 3 }, "p1.fwhm": {} });
    expect(warnings).toEqual([
      'fit.params["p0.center"]: min > max (bounds dropped)',
      'fit.params["p700.eta"]: peak index over 499 (edit dropped)',
      'fit.params["p1.fwhm"].tie: peak index over 499 (tie dropped)',
    ]);
    expect(() => parseRecipeFit({ ...FIT, engine: 1 }, [])).toThrow(/fit\.engine/);
    expect(parseRecipeFit({ ...FIT, shareFwhm: undefined }).shareFwhm).toBeNull(); // absent reads as null
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

  it("never writes a name past the peak cap (review #5): such edits go, and the result re-loads", () => {
    const edge: PeakRecipeFit = { ...FIT, params: { "p499.eta": { value: 0.2 }, "p0.eta": { value: 0.3 } }, shareVary: { "p499.fwhm": true } };
    const r = remapFitPeaks(edge, insertedAt(0));
    expect(r.params).toEqual({ "p1.eta": { value: 0.3 } });
    expect(r.shareVary).toEqual({});
    expect(() => parseRecipeFit(JSON.parse(JSON.stringify(r)))).not.toThrow();
  });
});

describe("extractPeak / insertPeak — an excluded peak's edits come back (review #3)", () => {
  const ids = [11, 12, 13];
  it("round-trips peak 1's edits, shape and ties (to itself and to another peak) through exclude + re-include", () => {
    const fit: PeakRecipeFit = {
      ...FIT,
      params: { ...FIT.params, "p1.eta": { value: 0.2, vary: false }, "p1.fwhm_l": { tie: "p1.fwhm_g" } },
      shareVary: { "p1.fwhm_g": true },
    };
    const slice = extractPeak(fit, 1, ids);
    expect(slice).toEqual({
      shape: "voigt",
      params: { fwhm_g: { tie: "@11.fwhm" }, eta: { value: 0.2, vary: false }, fwhm_l: { tie: "fwhm_g" } },
      shareVary: { fwhm_g: true },
    });
    const without = remapFitPeaks(fit, removedAt(1));
    const back = insertPeak(remapFitPeaks(without, insertedAt(1)), 1, slice, ids);
    expect(back.shapes).toEqual(fit.shapes);
    expect(back.params["p1.eta"]).toEqual({ value: 0.2, vary: false });
    expect(back.params["p1.fwhm_g"]).toEqual({ tie: "p0.fwhm" });
    expect(back.params["p1.fwhm_l"]).toEqual({ tie: "p1.fwhm_g" });
    expect(back.shareVary["p1.fwhm_g"]).toBe(true);
  });

  it("re-points a tie at the other peak's NEW index, and withdraws it when that peak is gone", () => {
    const slice = extractPeak({ ...DEFAULT_FIT, params: { "p2.fwhm": { tie: "p0.fwhm", max: 3 } } }, 2, ids);
    expect(insertPeak(DEFAULT_FIT, 0, slice, [13, 11]).params).toEqual({ "p0.fwhm": { tie: "p1.fwhm", max: 3 } });
    expect(insertPeak(DEFAULT_FIT, 0, slice, [13]).params).toEqual({ "p0.fwhm": { max: 3 } });
  });
});
