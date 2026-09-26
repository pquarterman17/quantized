// The Peak Analyzer's model fit -> the durable PeakTable (audit P2.1
// "Per-peak fit uncertainties"): values and standard errors land in the `*Err`
// columns, a missing error stays null (never 0, never NaN) with its reason,
// shapes / eta / Voigt widths are kept, provenance names the producer, and the
// record survives a `.dwk` save/reopen with every error intact.

import { describe, expect, it } from "vitest";

import { sanitizePeakTable, type PeakTable } from "../../../lib/peakTable";
import { peakDataFingerprint, peakTableFromFit, withPeakExcluded } from "../../../lib/peakTableFit";
import type { Dataset } from "../../../lib/types";
import { parseWorkspace, serializeWorkspace } from "../../../lib/workspace";
import { modelFitResponse } from "./modelFit.testkit";
import {
  modelBackgroundAt,
  modelFitPublishProblem,
  peakBackgrounds,
  peakTableFromModelFit,
  type ModelFitPublishContext,
} from "./modelFitPeakTable";

const DS: Dataset = {
  id: "d1",
  name: "film.xrdml",
  data: {
    time: [0, 1, 2, 3, 4, 5],
    values: [[1], [2], [6], [2], [3], [1]],
    labels: ["Intensity"],
    units: ["cts"],
    metadata: { x_column_name: "2-Theta", x_column_unit: "deg", wavelength_a: 1.5406 },
  },
};

const CTX: ModelFitPublishContext = {
  xKey: null,
  recipe: "two peaks",
  baseline: "als",
  bgAtCenter: [0.7, 0.9],
  fingerprint: peakDataFingerprint(DS),
  now: new Date("2026-09-26T10:00:00.000Z"),
};

const build = (res = modelFitResponse(), prior: PeakTable | null = null) =>
  peakTableFromModelFit(res, DS, CTX, prior);

describe("peakTableFromModelFit — values and errors", () => {
  it("fills centre / FWHM / height / area and their *Err columns from the fit", () => {
    const t = build();
    const [p0, p1] = t.peaks;
    expect(p0).toMatchObject({
      center: 2.01, centerErr: 0.004, fwhm: 0.81, fwhmErr: 0.01, height: 5.2, heightErr: 0.05, area: 5.9,
    });
    expect(p1).toMatchObject({ center: 4, height: 2.1, heightErr: 0.04, fwhm: 0.81, fwhmErr: 0.01, area: 1.81, areaErr: 0.03 });
  });

  it("keeps an undetermined / fixed error NULL — never 0, never NaN — with the reason", () => {
    const t = build();
    // p0's area depends on eta, which ended on a bound; p1's centre is fixed.
    expect(t.peaks[0].areaErr).toBeNull();
    expect(t.peaks[1].centerErr).toBeNull();
    expect(t.peaks[0].errReasons?.area).toMatch(/η.*on a bound|eta.*on a bound/i);
    expect(t.peaks[1].errReasons?.center).toMatch(/^fixed/);
    // A present error has no reason recorded.
    expect(t.peaks[0].errReasons?.center).toBeUndefined();
    for (const p of t.peaks) {
      for (const v of [p.centerErr, p.fwhmErr, p.heightErr, p.areaErr]) {
        expect(v === null || (Number.isFinite(v) && (v as number) > 0)).toBe(true);
      }
    }
  });

  it("gives every error of a non-converged fit a reason, and refuses to publish it", () => {
    const res = modelFitResponse({ success: false });
    expect(modelFitPublishProblem(res)).toMatch(/unconverged fit is not a result/);
    expect(modelFitPublishProblem(modelFitResponse())).toBeNull();
  });

  it("refuses a fit with a non-finite derived value rather than writing 0", () => {
    const res = modelFitResponse();
    res.peaks[1] = { ...res.peaks[1], area: null };
    expect(modelFitPublishProblem(res)).toBe("peak 2's area is not a finite number");
  });

  it("records each row's shape, and eta for a pseudo-Voigt with its error", () => {
    const t = build();
    expect(t.peaks.map((p) => p.model)).toEqual(["pseudo_voigt", "gaussian"]);
    expect(t.peaks[0].eta).toBe(1);
    expect(t.peaks[0].etaErr).toBeNull(); // on a bound
    expect(t.peaks[1].eta).toBeNull();
    expect(t.peaks[0].fwhmG).toBeNull();
  });

  it("records a Voigt row's Gaussian and Lorentzian widths with their errors", () => {
    const res = modelFitResponse();
    res.peaks[1] = { ...res.peaks[1], shape: "voigt" };
    res.parameters = [
      ...res.parameters.filter((p) => p.name !== "p1.fwhm"),
      { name: "p1.fwhm_g", value: 0.5, stderr: 0.02, vary: true, tie: null, at_bound: false },
      { name: "p1.fwhm_l", value: 0.4, stderr: null, vary: false, tie: null, at_bound: false },
    ];
    const p1 = build(res).peaks[1];
    expect(p1).toMatchObject({ model: "voigt", fwhmG: 0.5, fwhmGErr: 0.02, fwhmL: 0.4, fwhmLErr: null, eta: null });
  });

  it("uses the background under each centre so height + bg is the plotted apex", () => {
    expect(build().peaks.map((p) => p.bg)).toEqual([0.7, 0.9]);
  });
});

describe("peakTableFromModelFit — provenance", () => {
  it("names the producer, engine, recipe, metrics and the data it was fit from", () => {
    const pr = build().provenance;
    expect(pr).toMatchObject({
      datasetId: "d1",
      datasetName: "film.xrdml",
      method: "simultaneous",
      model: "mixed (pseudo_voigt, gaussian)",
      producer: "model_fit",
      engine: "peak_model_fit",
      recipe: "two peaks",
      objective: "ssr",
      ssr: 0.012,
      chi2: null,
      R2: 0.998,
      bgDegree: 0,
      bgCoeffs: [],
      background: "constant background after als baseline",
      xLabel: "2-Theta",
      xUnit: "deg",
      wavelengthA: 1.5406,
      fingerprint: peakDataFingerprint(DS),
      fittedAt: "2026-09-26T10:00:00.000Z",
    });
    // RMSE on the legacy definition: sqrt(SSR / n).
    expect(pr.rmse).toBeCloseTo(Math.sqrt(0.012 / 6), 12);
    expect(pr.warnings).toEqual(["parameters ended on a bound (errors not reported): p0.eta"]);
  });

  it("records χ² only for a weighted fit, and an unsaved recipe as null", () => {
    const res = modelFitResponse({ metrics: { objective: "chi2", chi2: 5.5 } });
    const pr = peakTableFromModelFit(res, DS, { ...CTX, recipe: "" }, null).provenance;
    expect(pr.objective).toBe("chi2");
    expect(pr.chi2).toBe(5.5);
    expect(pr.recipe).toBeNull();
    expect(build(modelFitResponse({ metrics: { chi2: 9 } })).provenance.chi2).toBeNull();
  });

  it("carries the user's exclusions across a re-publish, by peak identity", () => {
    const first = build();
    const marked = withPeakExcluded(first, first.peaks[1].id, true);
    const again = build(modelFitResponse(), marked);
    expect(again.peaks.map((p) => p.excluded)).toEqual([false, true]);
  });
});

describe("peakBackgrounds / modelBackgroundAt", () => {
  it("evaluates the model background polynomial exactly, in (x - x_ref)", () => {
    const res = modelFitResponse(); // x_ref 2.5
    res.parameters = [
      ...res.parameters.filter((p) => !p.name.startsWith("bg.")),
      { name: "bg.c0", value: 1, stderr: null, vary: true, tie: null, at_bound: false },
      { name: "bg.c1", value: 2, stderr: null, vary: true, tie: null, at_bound: false },
      { name: "bg.c2", value: -0.5, stderr: null, vary: true, tie: null, at_bound: false },
    ];
    // 1 + 2*(4 - 2.5) - 0.5*(4 - 2.5)^2 = 2.875
    expect(modelBackgroundAt(res, 4)).toBeCloseTo(2.875, 12);
    const none = { ...res, parameters: res.parameters.filter((p) => !p.name.startsWith("bg.")) };
    expect(modelBackgroundAt(none, 4)).toBe(0);
  });

  it("adds the step-① baseline at the nearest sample, as the wizard's markers read it", () => {
    const res = modelFitResponse(); // constant 0.5 background; centres 2.01 and 4
    const x = [0, 1, 2, 3, 4, 5];
    expect(peakBackgrounds(res, x, null)).toEqual([0.5, 0.5]);
    // 2.01 -> sample x=2 (baseline 2), 4 -> sample x=4 (baseline 4)
    expect(peakBackgrounds(res, x, [0, 1, 2, 3, 4, 5])).toEqual([2.5, 4.5]);
  });
});

describe("a published model-fit table across a .dwk save/reopen", () => {
  const ser = (ds: Dataset) => serializeWorkspace({ datasets: [ds] });

  it("round-trips every value, error, null error, reason, shape and provenance field", () => {
    const t = build();
    const [restored] = parseWorkspace(ser({ ...DS, peakTable: t })).datasets;
    expect(restored.peakTable).toEqual(t);
    expect(restored.peakTable?.peaks[0].centerErr).toBe(0.004);
    expect(restored.peakTable?.peaks[0].areaErr).toBeNull();
    expect(restored.peakTable?.peaks[1].errReasons?.center).toMatch(/^fixed/);
    expect(restored.peakTable?.provenance.producer).toBe("model_fit");
  });

  it("an old workspace's table (no model-fit fields) reopens without gaining any", () => {
    const legacy = peakTableFromFit(
      { peaks: [{ center: 30, fwhm: 0.2, height: 9, bg: 1, eta: null, area: 2, status: "fitted", model: "Gaussian" }],
        bgCoeffs: [1], R2: 0.9, rmse: 0.1, nPeaks: 1, model: "Gaussian" },
      { datasetId: "d1", datasetName: "x", method: "simultaneous", bgDegree: 0, linkMode: "None", constrain: false, wavelengthA: null },
    );
    const doc = JSON.parse(ser({ ...DS, peakTable: legacy }));
    const saved = doc.datasets[0].peakTable;
    expect(Object.keys(saved.peaks[0])).not.toContain("areaErr");
    expect(Object.keys(saved.provenance)).not.toContain("producer");
    const [restored] = parseWorkspace(JSON.stringify(doc)).datasets;
    expect(restored.peakTable).toEqual(legacy);
    expect(Object.keys(restored.peakTable!.peaks[0])).not.toContain("areaErr");
    expect(Object.keys(restored.peakTable!.peaks[0])).not.toContain("errReasons");
    expect(restored.peakTable!.provenance.producer).toBeUndefined();
  });

  it("sanitizes a hand-edited model-fit record: a non-numeric error reads null, junk reasons drop", () => {
    const t = JSON.parse(JSON.stringify(build())) as Record<string, unknown> & { peaks: Record<string, unknown>[] };
    t.peaks[0].centerErr = "0.1";
    t.peaks[0].areaErr = null;
    t.peaks[0].errReasons = { center: 5, area: "on a bound", bogus: "x" };
    const clean = sanitizePeakTable(t);
    expect(clean?.peaks[0].centerErr).toBeNull();
    expect(clean?.peaks[0].areaErr).toBeNull();
    expect(clean?.peaks[0].errReasons).toEqual({ area: "on a bound" });
  });
});
