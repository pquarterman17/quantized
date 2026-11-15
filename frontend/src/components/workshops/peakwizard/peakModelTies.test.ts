// Gap audit 4 G5: the extra peak shapes and the expression ties (offset,
// ratio, area ratio) on the client — seeds, labels, the request body, the
// recipe round trip, and the client mirror of the backend's tie rules.

import { describe, expect, it } from "vitest";

import { parseRecipeFit } from "../../../lib/peakRecipeFit";
import { modelFitResponse } from "./modelFit.testkit";
import { derivedErrorReason } from "./modelFitReasons";
import { modelFitPublishProblem } from "./modelFitPeakTable";
import { setupProblems } from "./modelSetupChecks";
import {
  modelFitBody,
  paramLabel,
  patchParam,
  recordEdits,
  seedSetup,
  tieOpsFor,
  tieText,
  type ModelSetup,
  type SeedPeak,
} from "./peakModelParams";

const X = Array.from({ length: 101 }, (_, i) => i / 10);
const Y = X.map((x) => 1 + 0.2 * x);
const PEAKS: SeedPeak[] = [
  { center: 3, height: 4, bg: 1.6, fwhm: 0.8 },
  { center: 7, height: 2, bg: 2.4, fwhm: 1.2 },
];
const seed = (shapes: ModelSetup["shapes"]) => seedSetup(PEAKS, shapes, "constant", X, Y);
const byName = (s: ModelSetup, n: string) => s.params.find((p) => p.name === n)!;

describe("the extra shapes", () => {
  it("seed every field, and a seeded table of each shape passes the checks", () => {
    const s = seed(["split_pseudo_voigt", "pearson_vii"]);
    expect(s.params.map((p) => p.name)).toEqual([
      "p0.center", "p0.height", "p0.fwhm_left", "p0.fwhm_right", "p0.eta",
      "p1.center", "p1.height", "p1.fwhm", "p1.m", "bg.c0",
    ]);
    expect(byName(s, "p0.fwhm_left").value).toBe(0.8);
    expect(byName(s, "p1.m").value).toBe(1.5);
    for (const shapes of [["split_gaussian", "split_lorentzian"], ["fano", "doniach_sunjic"]] as const) {
      expect(setupProblems(seed([...shapes]))).toEqual([]);
    }
    expect(byName(seed(["fano", "doniach_sunjic"]), "p1.alpha").value).toBe(0.1);
    expect(paramLabel("p0.fwhm_left")).toBe("#1 FWHM left");
    expect(paramLabel("p1.inv_q")).toBe("#2 1/q");
    expect(paramLabel("p1.alpha")).toBe("#2 α");
  });

  it("checks the shape parameters' physical ranges", () => {
    const s = seed(["pearson_vii", "doniach_sunjic"]);
    expect(setupProblems(patchParam(s, "p0.m", { value: 0.4 }))[0]).toBe("#1 m: m must lie in (0.5, ∞)");
    // m = 0.5 has an infinite area (review M2), and the default min sits above it.
    expect(setupProblems(patchParam(s, "p0.m", { value: 0.5, vary: false }))).toEqual(["#1 m: m must lie in (0.5, ∞)"]);
    expect(setupProblems(patchParam(s, "p0.m", { value: 0.505 }))[0]).toMatch(/outside \[0.51, Infinity\]/);
    expect(setupProblems(patchParam(s, "p1.alpha", { value: 1 }))[0]).toBe("#2 α: α must lie in [0, 1)");
    expect(setupProblems(patchParam(s, "p1.alpha", { value: 0.995 }))[0]).toMatch(/outside \[0, 0.99\]/);
  });
});

describe("expression ties", () => {
  it("offer only the operations the kind allows", () => {
    expect(tieOpsFor("p1.center", ["gaussian", "gaussian"])).toEqual(["equal", "offset"]);
    expect(tieOpsFor("p1.height", ["gaussian", "gaussian"])).toEqual(["equal", "ratio", "area_ratio"]);
    expect(tieOpsFor("p1.height", ["gaussian", "fano"])).toEqual(["equal", "ratio"]);
    expect(tieOpsFor("p1.fwhm", ["gaussian", "gaussian"])).toEqual(["equal", "ratio"]);
    expect(tieOpsFor("p1.eta", ["pseudo_voigt", "pseudo_voigt"])).toEqual(["equal"]);
  });

  it("send tie_op / tie_coef / tie_coef_vary only for a non-equal tie with a target", () => {
    let s = seed(["gaussian", "gaussian"]);
    s = patchParam(s, "p1.center", { tie: "p0.center", tieOp: "offset", tieCoef: 4, tieCoefVary: true });
    s = patchParam(s, "p1.height", { tie: "p0.height", tieOp: "area_ratio", tieCoef: 0.5 });
    s = patchParam(s, "p1.fwhm", { tie: "p0.fwhm" });
    expect(setupProblems(s)).toEqual([]);
    const get = (n: string) => modelFitBody(s, X, Y).parameters.find((p) => p.name === n)!;
    expect(get("p1.center")).toMatchObject({ tie: "p0.center", tie_op: "offset", tie_coef: 4, tie_coef_vary: true });
    expect(get("p1.height")).toMatchObject({ tie_op: "area_ratio", tie_coef: 0.5, tie_coef_vary: false });
    expect(get("p1.fwhm")).not.toHaveProperty("tie_op");
    // An op left behind on an untied row is never sent (the backend refuses it).
    const untied = patchParam(s, "p1.center", { tie: null });
    expect(modelFitBody(untied, X, Y).parameters.find((p) => p.name === "p1.center")).not.toHaveProperty("tie_op");
  });

  it("are recorded as edits and survive a recipe file round trip", () => {
    const s = seed(["gaussian", "gaussian"]);
    const after = patchParam(s, "p1.center", { tie: "p0.center", tieOp: "offset", tieCoef: -1.5 });
    const edits = recordEdits({}, s.params, after.params);
    expect(edits["p1.center"]).toEqual({ tie: "p0.center", tieOp: "offset", tieCoef: -1.5 });
    const fit = { engine: "model", shapes: [], background: null, params: edits, shareFwhm: null, shareVary: {} };
    expect(parseRecipeFit(JSON.parse(JSON.stringify(fit))).params["p1.center"]).toEqual(edits["p1.center"]);
    expect(() => parseRecipeFit({ ...fit, params: { "p1.center": { tieOp: "sum" } } })).toThrow(/tieOp/);
  });

  it("mirror the backend's tie rules", () => {
    const g = seed(["gaussian", "gaussian"]);
    const bad = (s: ModelSetup) => setupProblems(s);
    expect(bad(patchParam(g, "p1.fwhm", { tie: "p0.fwhm", tieOp: "offset" }))[0]).toMatch(/cannot take an "offset" tie/);
    expect(bad(patchParam(g, "p1.height", { tie: "p0.height", tieOp: "ratio", tieCoef: 0 }))[0]).toMatch(/ratio must be positive/);
    expect(bad(patchParam(g, "p1.center", { tie: "p0.center", tieOp: "offset", tieCoef: Number.NaN }))[0]).toMatch(/not a finite/);
    // An area ratio reads both peaks' fields, so two of them form a cycle.
    const cyc = patchParam(patchParam(g, "p1.height", { tie: "p0.height", tieOp: "area_ratio" }),
      "p0.height", { tie: "p1.height", tieOp: "area_ratio" });
    expect(bad(cyc).filter((m) => /cycle/.test(m))).toHaveLength(2);
    // ... and a peak without an area cannot be the reference.
    const f = seedSetup(PEAKS, ["fano", "gaussian"], "constant", X, Y);
    expect(bad(patchParam(f, "p1.height", { tie: "p0.height", tieOp: "area_ratio" }))[0]).toMatch(/no finite area/);
    // An expression tie may follow a FIXED target (its coefficient may be fitted).
    const fixed = patchParam(patchParam(g, "p0.center", { vary: false }), "p1.center",
      { tie: "p0.center", tieOp: "offset", tieCoef: 4, tieCoefVary: true });
    expect(bad(fixed)).toEqual([]);
  });

  it("read as words in the results", () => {
    expect(tieText({ tie: "p0.center", tie_op: "offset", tie_coef: -1.25 })).toBe("#1 center − 1.25");
    expect(tieText({ tie: "p0.height", tie_op: "ratio", tie_coef: 0.5 })).toBe("0.5 × #1 height");
    expect(tieText({ tie: "p0.height", tie_op: "area_ratio", tie_coef: 1 / 3 })).toBe("area 0.333333 × #1");
    expect(tieText({ tie: "p0.fwhm", tie_op: "equal", tie_coef: null })).toBe("#1 FWHM");
  });
});

describe("a shape without an area", () => {
  it("is named as the reason a fit cannot be published (live check: it read 'not a finite number')", () => {
    const res = modelFitResponse();
    res.peaks[1] = { ...res.peaks[1], shape: "doniach_sunjic", area: null, area_stderr: null };
    expect(modelFitPublishProblem(res)).toBe("peak 2 (doniach sunjic) has no finite area, which the peak table needs");
    expect(derivedErrorReason(res, 1, "area")).toBe("not defined: a doniach sunjic peak has no finite area");
  });
});
