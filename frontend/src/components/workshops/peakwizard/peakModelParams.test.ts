// The mixed-shape model's parameter table (audit P2.4 slice 2): seeding,
// editing, the share-FWHM convenience, and the request body.

import { describe, expect, it } from "vitest";

import {
  backgroundFromDegree,
  fwhmShared,
  modelFitBody,
  paramKind,
  paramLabel,
  patchParam,
  reshape,
  seedSetup,
  setFwhmShared,
  shapeFromGlobal,
  startFromFit,
  tieTargets,
  type SeedPeak,
} from "./peakModelParams";

// 0..10 in 101 points on a linear background 1 + 0.2 x.
const X = Array.from({ length: 101 }, (_, i) => i / 10);
const Y = X.map((x) => 1 + 0.2 * x);
const PEAKS: SeedPeak[] = [
  { center: 3, height: 4, bg: 1.6, fwhm: 0.8 }, // detected: apex 5.6
  { center: 7, height: 2, bg: 2.4, fwhm: 1.2 },
];
const byName = <T extends { name: string }>(ps: readonly T[], n: string): T => ps.find((p) => p.name === n)!;

describe("seedSetup — defaults a user who touches nothing fits with", () => {
  it("names every parameter per shape, in canonical order, all varying and untied", () => {
    const s = seedSetup(PEAKS, ["pseudo_voigt", "voigt"], "linear", X, Y);
    expect(s.params.map((p) => p.name)).toEqual([
      "p0.center", "p0.height", "p0.fwhm", "p0.eta",
      "p1.center", "p1.height", "p1.fwhm_g", "p1.fwhm_l",
      "bg.c0", "bg.c1",
    ]);
    expect(s.params.every((p) => p.vary && p.tie === null)).toBe(true);
    expect(s.xRef).toBe(5);
  });

  it("bounds centres to the window, heights at 0, widths at the window span", () => {
    const s = seedSetup(PEAKS, ["gaussian", "gaussian"], "linear", X, Y);
    expect(byName(s.params, "p0.center")).toMatchObject({ value: 3, min: 0, max: 10 });
    expect(byName(s.params, "p0.height")).toMatchObject({ min: 0, max: null });
    expect(byName(s.params, "p0.fwhm")).toMatchObject({ value: 0.8, min: null, max: 10 });
  });

  it("seeds the background through the window ends and heights ABOVE it", () => {
    const s = seedSetup(PEAKS, ["gaussian", "gaussian"], "linear", X, Y);
    // ends average the first/last 5 points: line 1 + 0.2x, in (x - 5)
    expect(byName(s.params, "bg.c0").value).toBeCloseTo(2, 10);
    expect(byName(s.params, "bg.c1").value).toBeCloseTo(0.2, 10);
    // apex 5.6 at x = 3 over a seeded background of 1.6
    expect(byName(s.params, "p0.height").value).toBeCloseTo(4, 10);
  });

  it("splits a Voigt's detected FWHM, puts eta mid-range, clamps a stray centre", () => {
    const s = seedSetup([{ center: 12, height: 1, bg: 0, fwhm: 1 }], ["voigt"], "none", X, Y);
    expect(byName(s.params, "p0.center").value).toBe(10);
    expect(byName(s.params, "p0.fwhm_g").value).toBeCloseTo(0.61);
    expect(byName(s.params, "p0.fwhm_l").value).toBeCloseTo(0.61);
    const pv = seedSetup(PEAKS.slice(0, 1), ["pseudo_voigt"], "constant", X, Y);
    expect(byName(pv.params, "p0.eta")).toMatchObject({ value: 0.5, min: null, max: null });
    expect(byName(pv.params, "bg.c0").value).toBeCloseTo(1.04); // min of the two ends
  });

  it("carries the recipe's width link over as ties", () => {
    const s = seedSetup(PEAKS, ["pseudo_voigt", "pseudo_voigt"], "none", X, Y, "Shared FWHM + eta");
    expect(byName(s.params, "p1.fwhm").tie).toBe("p0.fwhm");
    expect(byName(s.params, "p1.eta").tie).toBe("p0.eta");
    expect(byName(s.params, "p0.fwhm").tie).toBeNull();
  });

  it("maps the recipe's global shape / degree", () => {
    expect(shapeFromGlobal("Gaussian")).toBe("gaussian");
    expect(shapeFromGlobal("Lorentzian")).toBe("lorentzian");
    expect(shapeFromGlobal("Pseudo-Voigt")).toBe("pseudo_voigt");
    expect(shapeFromGlobal("TCH-pV")).toBe("pseudo_voigt");
    expect([0, 1, 2, 5].map(backgroundFromDegree)).toEqual(["constant", "linear", "quadratic", "quadratic"]);
  });
});

describe("editing", () => {
  it("patchParam edits one row's vary/min/max/tie", () => {
    const s = seedSetup(PEAKS, ["gaussian", "gaussian"], "linear", X, Y);
    const e = patchParam(patchParam(s, "p1.fwhm", { tie: "p0.fwhm" }), "p0.height", {
      vary: false, min: 1, max: 9,
    });
    expect(byName(e.params, "p1.fwhm").tie).toBe("p0.fwhm");
    expect(byName(e.params, "p0.height")).toMatchObject({ vary: false, min: 1, max: 9 });
    expect(byName(s.params, "p0.height").vary).toBe(true); // immutable
  });

  it("tieTargets offers only same-kind, varying, untied parameters", () => {
    let s = seedSetup([...PEAKS, PEAKS[0]], ["gaussian", "voigt", "gaussian"], "linear", X, Y);
    expect(tieTargets(s.params, "p0.fwhm")).toEqual(["p1.fwhm_g", "p1.fwhm_l", "p2.fwhm"]);
    expect(tieTargets(s.params, "p0.center")).toEqual(["p1.center", "p2.center"]);
    expect(tieTargets(s.params, "bg.c0")).toEqual([]);
    s = patchParam(patchParam(s, "p1.center", { vary: false }), "p2.center", { tie: "p0.center" });
    expect(tieTargets(s.params, "p0.center")).toEqual([]);
    expect(paramKind("p1.fwhm_l")).toBe("width");
    expect(paramKind("bg.c2")).toBe("bg2");
    expect(paramLabel("p1.fwhm")).toBe("#2 FWHM");
    expect(paramLabel("p0.fwhm_g")).toBe("#1 FWHM g");
  });

  it("reshape keeps edits that still exist and drops ties to vanished parameters", () => {
    let s = seedSetup(PEAKS, ["gaussian", "gaussian"], "linear", X, Y);
    s = patchParam(s, "p1.fwhm", { tie: "p0.fwhm" });
    s = patchParam(s, "p0.center", { min: 2.5, max: 3.5 });
    const r = reshape(s, PEAKS, ["voigt", "gaussian"], "quadratic", X, Y);
    expect(r.shapes).toEqual(["voigt", "gaussian"]);
    expect(byName(r.params, "p0.center")).toMatchObject({ min: 2.5, max: 3.5 });
    expect(byName(r.params, "p1.fwhm").tie).toBeNull(); // p0.fwhm is gone
    expect(r.params.map((p) => p.name)).toContain("bg.c2");
  });
});

describe("share FWHM across peaks", () => {
  it("ties every width to the first peak's of the same field and toggles back", () => {
    const s = seedSetup([...PEAKS, PEAKS[0]], ["gaussian", "gaussian", "voigt"], "none", X, Y);
    const withFixedRoot = patchParam(s, "p0.fwhm", { vary: false }).params;
    expect(fwhmShared(withFixedRoot)).toBe(false);
    const on = setFwhmShared(withFixedRoot, true);
    expect(byName(on, "p0.fwhm")).toMatchObject({ tie: null, vary: true }); // root made to vary
    expect(byName(on, "p1.fwhm").tie).toBe("p0.fwhm");
    expect(byName(on, "p2.fwhm_g").tie).toBeNull(); // first fwhm_g is its own root
    expect(fwhmShared(on)).toBe(true);
    // only ties change: values and bounds are untouched
    expect(on.map((p) => [p.value, p.min, p.max])).toEqual(withFixedRoot.map((p) => [p.value, p.min, p.max]));
    const off = setFwhmShared(on, false);
    expect(off.every((p) => p.tie === null)).toBe(true);
    expect(fwhmShared(off)).toBe(false);
  });
});

describe("startFromFit / modelFitBody", () => {
  it("copies fitted values into starts, clamped, skipping tied rows", () => {
    let s = seedSetup(PEAKS, ["gaussian", "gaussian"], "none", X, Y);
    s = patchParam(s, "p1.fwhm", { tie: "p0.fwhm", value: 1.2 });
    const out = startFromFit(s.params, [
      { name: "p0.center", value: 3.1 },
      { name: "p0.fwhm", value: 20 },
      { name: "p1.fwhm", value: 0.9 },
      { name: "p1.height", value: null },
    ]);
    expect(byName(out, "p0.center").value).toBe(3.1);
    expect(byName(out, "p0.fwhm").value).toBe(10); // clamped to max
    expect(byName(out, "p1.fwhm").value).toBe(1.2); // tied: untouched
    expect(byName(out, "p1.height").value).toBe(byName(s.params, "p1.height").value);
  });

  it("builds the /api/peaks/model-fit body with explicit vary and the fitted range", () => {
    const s = patchParam(seedSetup(PEAKS.slice(0, 1), ["lorentzian"], "constant", X, Y), "bg.c0", { vary: false });
    const body = modelFitBody(s, [1, 2], [3, 4], { lo: 0.5, hi: null });
    expect(body).toEqual({
      x: [1, 2],
      y: [3, 4],
      shapes: ["lorentzian"],
      background: "constant",
      parameters: s.params.map(({ name, value, vary, min, max, tie }) => ({ name, value, vary, min, max, tie })),
      bg_x_ref: 5,
      x_min: 0.5,
    });
    expect(body.parameters.find((p) => p.name === "bg.c0")?.vary).toBe(false);
  });
});
