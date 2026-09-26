// modelFitPublish: a `/api/peaks/model-fit` result -> the durable peak table
// (audit P2.1 per-peak uncertainties). Fixture: ./modelFit.testkit — p0 a
// pseudo-Voigt whose eta ended on a bound (so its AREA has no error), p1 a
// gaussian with a FIXED centre and its FWHM tied to p0's, constant background.

import { describe, expect, it } from "vitest";

import { peakTableFromFit, withPeakExcluded } from "../../../lib/peakTableFit";
import { modelFitResponse, modelFitTable } from "./modelFit.testkit";
import { interpolateAt, modelFitPublishBlock, modelFitRows, shiftedToRaw } from "./modelFitPublish";
import type { TableStamp } from "./modelFitPublishRun";

const SOURCE: TableStamp & Parameters<typeof modelFitTable>[1] = {
  datasetId: "d1",
  datasetName: "film.xrdml",
  wavelengthA: 1.5406,
  xLabel: "2Theta",
  xUnit: "deg",
  fingerprint: "2:fp",
  recipe: { name: "film", range: { lo: 0, hi: 5 }, baseline: { method: "als", lam: 1e5, p: 0.01, radius: 10, order: 2 } },
  now: new Date("2026-09-25T10:00:00.000Z"),
};

describe("modelFitRows — values, errors, shapes", () => {
  it("copies each derived value and its standard error into the *Err columns", () => {
    const [p0, p1] = modelFitRows(modelFitResponse());
    expect(p0).toMatchObject({ center: 2.01, centerErr: 0.004, fwhm: 0.81, fwhmErr: 0.01, height: 5.2, heightErr: 0.05, area: 5.9 });
    expect(p1).toMatchObject({ center: 4, fwhm: 0.81, fwhmErr: 0.01, height: 2.1, heightErr: 0.04, area: 1.81, areaErr: 0.03 });
    expect(p0.model).toBe("Pseudo-Voigt");
    expect(p1.model).toBe("Gaussian");
    expect(p0.eta).toBe(1); // the pseudo-Voigt's own eta parameter
    expect(p1.eta).toBeNull();
  });

  it("an undetermined / at-bound / fixed error stays NULL and keeps its reason", () => {
    const [p0, p1] = modelFitRows(modelFitResponse());
    expect(p0.areaErr).toBeNull();
    expect(p0.errReasons?.area).toMatch(/η on a bound/);
    expect(p1.centerErr).toBeNull();
    expect(p1.errReasons?.center).toMatch(/^fixed/);
    // a field WITH an error carries no reason
    expect(p0.errReasons?.center).toBeUndefined();
    expect(p1.errReasons).toEqual({ center: expect.any(String) });
  });

  it("never publishes 0 or NaN as an error", () => {
    const r = modelFitResponse();
    r.peaks[0] = { ...r.peaks[0], center_stderr: 0, fwhm_stderr: Number.NaN, height_stderr: -1 };
    const [p0] = modelFitRows(r);
    expect([p0.centerErr, p0.fwhmErr, p0.heightErr]).toEqual([null, null, null]);
    expect(p0.errReasons?.center).toMatch(/not a positive finite number/);
    expect(Object.values(p0.errReasons ?? {}).every((s) => s.length > 0)).toBe(true);
  });

  it("bg is the fitted background at the centre plus the subtracted baseline there", () => {
    const [p0] = modelFitRows(modelFitResponse()); // constant bg.c0 = 0.5
    expect(p0.bg).toBeCloseTo(0.5, 12);
    const [q0, q1] = modelFitRows(modelFitResponse(), (x) => 10 * x);
    expect(q0.bg).toBeCloseTo(0.5 + 20.1, 12);
    expect(q1.bg).toBeCloseTo(0.5 + 40, 12);
  });

  it("a linear background is evaluated in (x - x_ref)", () => {
    const r = modelFitResponse({ background: { kind: "linear", x_ref: 2.5 } });
    r.parameters = [...r.parameters, { name: "bg.c1", value: 2, stderr: 0.1, vary: true, tie: null, at_bound: false }];
    const [p0, p1] = modelFitRows(r);
    expect(p0.bg).toBeCloseTo(0.5 + 2 * (2.01 - 2.5), 12);
    expect(p1.bg).toBeCloseTo(0.5 + 2 * (4 - 2.5), 12);
  });

  it("a Voigt row carries its Gaussian and Lorentzian widths", () => {
    const r = modelFitResponse();
    r.peaks[1] = { ...r.peaks[1], shape: "voigt" };
    r.parameters = [
      ...r.parameters.filter((q) => q.name !== "p1.fwhm"),
      { name: "p1.fwhm_g", value: 0.3, stderr: 0.02, vary: true, tie: null, at_bound: false },
      { name: "p1.fwhm_l", value: 0.6, stderr: 0.03, vary: true, tie: null, at_bound: false },
    ];
    const [p0, p1] = modelFitRows(r);
    expect(p1).toMatchObject({ model: "Voigt", fwhmG: 0.3, fwhmL: 0.6, eta: null });
    expect("fwhmG" in p0).toBe(false);
  });
});

describe("modelFitDraft + assembly — provenance", () => {
  it("names the producer, engine, recipe, the honest objective and the live stamp", () => {
    const t = modelFitTable(modelFitResponse(), SOURCE);
    expect(t.peaks).toHaveLength(2);
    expect(new Set(t.peaks.map((p) => p.id)).size).toBe(2);
    expect(t.peaks.every((p) => !p.excluded)).toBe(true);
    const p = t.provenance;
    expect(p).toMatchObject({
      datasetId: "d1", datasetName: "film.xrdml", method: "simultaneous", producer: "model_fit",
      model: "Pseudo-Voigt + Gaussian", R2: 0.998, rmse: null, wavelengthA: 1.5406, xLabel: "2Theta",
      xUnit: "deg", fingerprint: "2:fp", fittedAt: "2026-09-25T10:00:00.000Z", bgDegree: 0, bgCoeffs: [0.5],
    });
    expect(p.objective).toEqual({ kind: "ssr", value: 0.012, reduced: 0.012 });
    expect(p.engine).toMatch(/^mixed-shape model fit · constant background · 40 evaluations$/);
    expect(p.recipe).toBe('"film" · x 0 to 5 · baseline als');
    expect(p.linkMode).toBe("tied: #2 FWHM → #1 FWHM");
  });

  it("a weighted fit's objective is χ², never SSR", () => {
    const t = modelFitTable(
      modelFitResponse({ metrics: { objective: "chi2", chi2: 12.5, reduced_chi2: 1.04 } }), SOURCE);
    expect(t.provenance.objective).toEqual({ kind: "chi2", value: 12.5, reduced: 1.04 });
  });

  it("no background: degree -1, no coefficients, bg = the baseline only", () => {
    const r = modelFitResponse({ background: { kind: "none", x_ref: 2.5 } });
    r.parameters = r.parameters.filter((q) => !q.name.startsWith("bg."));
    const t = modelFitTable(r, { ...SOURCE, offsetAt: () => 3 });
    expect(t.provenance.bgDegree).toBe(-1);
    expect(t.provenance.bgCoeffs).toEqual([]);
    expect(t.peaks[0].bg).toBe(3);
  });

  it("after a baseline subtraction, bgCoeffs stay empty so they cannot disagree with each row's bg", () => {
    const raw = modelFitTable(modelFitResponse(), SOURCE);
    expect(raw.provenance.bgCoeffs).toEqual([0.5]);
    expect(raw.provenance.engine).not.toMatch(/baseline/);
    const sub = modelFitTable(modelFitResponse(), { ...SOURCE, offsetAt: () => 2 });
    expect(sub.provenance.bgCoeffs).toEqual([]);
    expect(sub.provenance.bgDegree).toBe(0); // still names the polynomial
    expect(sub.provenance.engine).toMatch(/constant background after baseline subtraction/);
    expect(sub.peaks[0].bg).toBeCloseTo(2.5, 12);
  });

  it("carries the user's exclusions from the previous table by peak identity", () => {
    const prior = peakTableFromFit(
      { peaks: [
        { center: 2.0, fwhm: 0.8, height: 5, bg: 0, eta: null, area: 5, status: "fitted", model: "Gaussian" },
        { center: 4.0, fwhm: 0.8, height: 2, bg: 0, eta: null, area: 2, status: "fitted", model: "Gaussian" },
      ], bgCoeffs: [], R2: null, rmse: null, nPeaks: 2, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x", method: "simultaneous", bgDegree: 0, linkMode: "None", constrain: false, wavelengthA: null },
    );
    const t = modelFitTable(modelFitResponse(), SOURCE, withPeakExcluded(prior, prior.peaks[1].id, true));
    expect(t.peaks.map((p) => p.excluded)).toEqual([false, true]);
  });
});

describe("modelFitPublishBlock", () => {
  it("allows a converged, current fit", () => {
    expect(modelFitPublishBlock(modelFitResponse())).toBeNull();
  });
  it("refuses no fit, a stale fit and a non-converged fit", () => {
    expect(modelFitPublishBlock(null)).toMatch(/fit the model first/);
    expect(modelFitPublishBlock(modelFitResponse(), true)).toMatch(/Re-fit/);
    expect(modelFitPublishBlock(modelFitResponse({ success: false }))).toMatch(/did not converge/);
  });
  it("refuses a peak with no finite value, naming it", () => {
    const r = modelFitResponse();
    r.peaks[1] = { ...r.peaks[1], area: null };
    expect(modelFitPublishBlock(r)).toBe("peak 2 has no finite area");
  });
  it("refuses a background coefficient that is not finite", () => {
    const r = modelFitResponse();
    r.parameters = r.parameters.map((q) => (q.name === "bg.c0" ? { ...q, value: null } : q));
    expect(modelFitPublishBlock(r)).toMatch(/background/);
  });
});

describe("helpers", () => {
  it("shiftedToRaw re-expands a (x - r) polynomial exactly", () => {
    const c = [1, 2, 3];
    const a = shiftedToRaw(c, 5);
    for (const x of [-2, 0, 7, 40]) {
      const shifted = c.reduce((s, ck, k) => s + ck * (x - 5) ** k, 0);
      const raw = a.reduce((s, aj, j) => s + aj * x ** j, 0);
      expect(raw).toBeCloseTo(shifted, 9);
    }
    expect(shiftedToRaw([], 5)).toEqual([]);
  });

  it("interpolateAt: linear between brackets, nearest outside, nulls skipped", () => {
    expect(interpolateAt([0, 1, 2], [0, 10, 20], 1.5)).toBe(15);
    expect(interpolateAt([0, 1, 2], [0, null, 20], 1)).toBe(10);
    expect(interpolateAt([0, 1, 2], [5, 10, 20], -3)).toBe(5);
    expect(interpolateAt([0, 1, 2], [5, 10, 20], 9)).toBe(20);
    expect(interpolateAt([2, 1, 0], [20, 10, 0], 0.5)).toBe(5);
    expect(interpolateAt([], [], 1)).toBe(0);
  });
});
