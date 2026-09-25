// Honest labels for a model-fit result (audit P2.4 slice 2): why an error is
// missing, and SSR vs chi-square.

import { describe, expect, it } from "vitest";

import { derivedErrorReason, metricRows, paramErrorReason } from "./modelFitReasons";
import { modelFitResponse } from "./modelFit.testkit";

const r = modelFitResponse();
const param = (name: string, res = r) => res.parameters.find((q) => q.name === name)!;

describe("paramErrorReason", () => {
  it("is null when the error is reported", () => {
    expect(paramErrorReason(r, param("p0.center"))).toBeNull();
  });
  it("names at-bound, fixed, and tied (with the target's own state)", () => {
    expect(paramErrorReason(r, param("p0.eta"))).toMatch(/^on a bound/);
    expect(paramErrorReason(r, param("p1.center"))).toMatch(/^fixed/);
    const tiedToBound = modelFitResponse();
    param("p1.fwhm", tiedToBound).stderr = null;
    param("p0.fwhm", tiedToBound).stderr = null;
    param("p0.fwhm", tiedToBound).at_bound = true;
    expect(paramErrorReason(tiedToBound, param("p1.fwhm", tiedToBound))).toBe(
      "tied to #1 FWHM (on a bound: the error is not reported there)",
    );
  });
  it("calls a free, in-bounds, error-less parameter undetermined", () => {
    const res = modelFitResponse();
    param("p1.height", res).stderr = null;
    expect(paramErrorReason(res, param("p1.height", res))).toMatch(/^undetermined/);
  });
  it("blames non-convergence first, whatever else is true", () => {
    const res = modelFitResponse({ success: false });
    expect(paramErrorReason(res, param("p0.eta", res))).toMatch(/without converging/);
    expect(paramErrorReason(res, param("p1.center", res))).toMatch(/without converging/);
  });
});

describe("derivedErrorReason", () => {
  it("is null when present; names the contributing parameter otherwise", () => {
    expect(derivedErrorReason(r, 0, "center")).toBeNull();
    expect(derivedErrorReason(r, 0, "area")).toBe(
      "not available: #1 η on a bound: the error is not reported there",
    );
  });
  it("says fixed when every contributing parameter is fixed", () => {
    expect(derivedErrorReason(r, 1, "center")).toMatch(/^fixed: every parameter/);
  });
  it("blames non-convergence", () => {
    const res = modelFitResponse({ success: false });
    res.peaks[0].center_stderr = null;
    expect(derivedErrorReason(res, 0, "center")).toMatch(/without converging/);
  });
});

describe("metricRows — the objective under its honest label", () => {
  it("an unweighted fit reports SSR and never chi-square", () => {
    const labels = metricRows(r.metrics).map(([l]) => l);
    expect(labels.slice(0, 2)).toEqual(["SSR", "reduced SSR"]);
    expect(labels.join(" ")).not.toMatch(/χ/);
  });
  it("a weighted fit reports chi-square", () => {
    const res = modelFitResponse({ weighted: true, metrics: { objective: "chi2", chi2: 5.5, reduced_chi2: 1.1 } });
    expect(metricRows(res.metrics).slice(0, 2)).toEqual([["χ²", 5.5], ["reduced χ²", 1.1]]);
  });
});
