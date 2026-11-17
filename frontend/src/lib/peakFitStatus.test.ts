import { describe, expect, it } from "vitest";

import { analysisPeakTableCsv } from "./analysisPeakTable";
import { peakFitStatus } from "./peakFitStatus";
import { sanitizePeakTable, serializePeakTable, type MultiFitResult } from "./peakTable";
import { POLISH_NO_ERR_REASON, POLISH_NOT_CONVERGED_REASON, peakTableFromFit, peakTableToFitResult } from "./peakTableFit";

// The audit's Si XRD scan (UX audit 9 #3), as tests/test_calc_peak_multifit_polish.py
// measures it: the parity simplex alone, and the polished fit.
const SIMPLEX_SI = { R2: 0.9677, rmse: 74.4, converged: false, noiseSigma: 12.1 };
const POLISHED_SI = { R2: 0.99768, rmse: 19.9, converged: true, noiseSigma: 12.1 };

describe("peakFitStatus", () => {
  it("reads the polished Si fit as good, with its noise ratio", () => {
    const s = peakFitStatus(POLISHED_SI);
    expect(s.tone).toBe("ok");
    expect(s.reasons).toEqual([]);
    expect(s.text).toBe("R² 0.99768 · RMSE 19.9 (1.6× noise)");
  });

  it("warns on a fit stuck at R² 0.94 even when it converged (the audit's case)", () => {
    const s = peakFitStatus({ R2: 0.941639, rmse: 100.009, converged: true, noiseSigma: 12.1 });
    expect(s.tone).toBe("warn");
    expect(s.reasons).toEqual(["RMSE over 3× noise"]);
    expect(s.text).toMatch(/^Poor fit \(RMSE over 3× noise\) — check the seeds/);
  });

  it("warns on a fit that did not converge, whatever its R²", () => {
    const s = peakFitStatus({ ...POLISHED_SI, converged: false });
    expect(s.tone).toBe("warn");
    expect(s.text).toMatch(/^Did not converge — no uncertainties/);
    expect(peakFitStatus(SIMPLEX_SI).reasons).toContain("did not converge");
  });

  it("warns on RMSE over 3× the noise with a high R² (structure left in the residual)", () => {
    const s = peakFitStatus({ R2: 0.995, rmse: 40, converged: true, noiseSigma: 12 });
    expect(s.tone).toBe("warn");
    expect(s.reasons).toEqual(["RMSE over 3× noise"]);
  });

  it("keeps a correct fit to low-count Poisson data ok despite a low R² (RMSE/noise is the rule)", () => {
    // 2 Gaussians (100/60, baseline 5), poisson(0.1*true) x 600 points: the
    // correct model measured R² 0.74-0.79 and RMSE/noise 0.95-2.0.
    for (const [R2, ratio] of [[0.74, 0.95], [0.79, 2.0]]) {
      const s = peakFitStatus({ R2, rmse: ratio * 1.1, converged: true, noiseSigma: 1.1 });
      expect(s.tone).toBe("ok");
      expect(s.reasons).toEqual([]);
    }
    // …and a genuinely bad fit of the same data still warns, on the ratio.
    expect(peakFitStatus({ R2: 0.74, rmse: 4 * 1.1, converged: true, noiseSigma: 1.1 }).tone).toBe("warn");
  });

  it("falls back to R² < 0.98 when the noise estimate is missing, non-finite or at its floor (null)", () => {
    for (const noiseSigma of [undefined, null, NaN, Infinity, 0]) {
      const s = peakFitStatus({ R2: 0.9, rmse: 0.4, converged: true, noiseSigma });
      expect(s.tone).toBe("warn");
      expect(s.reasons).toEqual(["R² below 0.98 (no noise estimate)"]);
      expect(peakFitStatus({ R2: 0.99, rmse: 0.4, converged: true, noiseSigma }).tone).toBe("ok");
    }
  });

  it("judges an older record on what it has, and is quiet with nothing to judge", () => {
    expect(peakFitStatus({ R2: 0.997, rmse: 0.4 })).toEqual({ tone: "ok", text: "R² 0.99700 · RMSE 0.4", reasons: [] });
    expect(peakFitStatus({ R2: 0.9, rmse: 0.4 }).tone).toBe("warn");
    expect(peakFitStatus({ R2: null, rmse: null })).toEqual({ tone: "ok", text: "", reasons: [] });
    // A zero noise estimate (noise-free data) cannot be a ratio's denominator.
    expect(peakFitStatus({ R2: 0.999, rmse: 1e-9, converged: true, noiseSigma: 0 }).tone).toBe("ok");
  });
});

function polished(converged = true): MultiFitResult {
  return {
    peaks: [
      { center: 28.43983692, fwhm: 0.1218, height: 8939, bg: 90, eta: null, area: 1711.2, status: "fitted(global)",
        model: "Lorentzian", centerErr: 0.000253, fwhmErr: 0.00071, heightErr: 47.1, areaErr: 8.04, etaErr: null },
      { center: 69.13, fwhm: 0.19, height: 700, bg: 70, eta: null, area: 210, status: "fitted(global)",
        model: "Lorentzian", centerErr: null, fwhmErr: 0.004, heightErr: 10, areaErr: null, etaErr: null },
    ],
    bgCoeffs: [100, -0.5], R2: 0.99768, rmse: 19.9, nPeaks: 2, model: "Lorentzian",
    solver: "nelder-mead+trf", converged, fitMessage: "ftol", noiseSigma: 12.1,
  };
}

const SOURCE = {
  datasetId: "si", datasetName: "XRD_Si.csv", method: "simultaneous" as const, bgDegree: 1,
  linkMode: "None", constrain: false, wavelengthA: 1.5406, now: new Date("2026-11-17T00:00:00Z"),
};

describe("a polished simultaneous fit in the durable table", () => {
  it("fills the 1σ columns, gives each null its reason, and records the quality inputs", () => {
    const t = peakTableFromFit(polished(), SOURCE);
    expect(t.peaks[0]).toMatchObject({ centerErr: 0.000253, fwhmErr: 0.00071, heightErr: 47.1, areaErr: 8.04 });
    expect(t.peaks[0].errReasons).toBeUndefined();
    expect(t.peaks[1]).toMatchObject({ centerErr: null, areaErr: null });
    expect(t.peaks[1].errReasons).toEqual({ center: POLISH_NO_ERR_REASON, area: POLISH_NO_ERR_REASON });
    expect("etaErr" in t.peaks[0]).toBe(false); // Lorentzian: no η column
    expect(t.provenance).toMatchObject({ solver: "nelder-mead+trf", converged: true, noiseSigma: 12.1 });
    const unconverged = peakTableFromFit(polished(false), SOURCE);
    expect(unconverged.peaks[1].errReasons?.center).toBe(POLISH_NOT_CONVERGED_REASON);
  });

  it("round-trips through a .dwk save and back into the panel's fit result", () => {
    const t = peakTableFromFit(polished(), SOURCE);
    const back = sanitizePeakTable(JSON.parse(JSON.stringify(serializePeakTable(t))));
    expect(back).toEqual(t);
    expect(peakTableToFitResult(t)).toMatchObject({ solver: "nelder-mead+trf", converged: true, noiseSigma: 12.1 });
  });

  it("leaves a legacy fit's record exactly as before (no solver, no optional columns)", () => {
    const { solver: _s, converged: _c, noiseSigma: _n, fitMessage: _m, ...legacy } = polished();
    const t = peakTableFromFit({ ...legacy, peaks: legacy.peaks.map(({ centerErr: _a, fwhmErr: _b, heightErr: _h, areaErr: _r, etaErr: _e, ...p }) => p) }, SOURCE);
    expect(t.peaks[0]).toMatchObject({ centerErr: null, fwhmErr: null, heightErr: null });
    expect("areaErr" in t.peaks[0] || "errReasons" in t.peaks[0]).toBe(false);
    expect("solver" in t.provenance).toBe(false);
  });

  it("exports PDG-rounded value ± σ pairs, and no σ column that no row has", () => {
    const csv = analysisPeakTableCsv(peakTableFromFit(polished(), SOURCE));
    const [header, first] = csv.split("\n");
    expect(header).toBe("included,center,center_1sigma,fwhm,fwhm_1sigma,height,height_1sigma,area,area_1sigma,background,eta,model,status");
    // PDG: two figures for a leading 100-354 (0.000253 → 0.00025), one for
    // 355-949 (0.00071 → 0.0007, 47.1 → 50); the value to the same place.
    expect(first).toBe(`true,28.43984,0.00025,0.1218,0.0007,8940,50,1711,8,90,,Lorentzian,fitted(global)`);
  });
});
