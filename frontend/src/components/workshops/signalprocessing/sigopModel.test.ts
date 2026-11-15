import { describe, expect, it } from "vitest";

import { sigopParamsOf } from "../../../lib/transformSigop";
import { DEFAULT_SIGOP_FORM, isSigopFilter, sigopParamsFromForm, spectrumChannels } from "./sigopModel";

const f = DEFAULT_SIGOP_FORM;

describe("sigopParamsFromForm", () => {
  it("builds recordable params for each filter", () => {
    expect(sigopParamsFromForm("median", { ...f, window: "7" }, [0, 2])).toEqual({
      op: "sigop", method: "median", channels: [0, 2], args: { window: 7 },
    });
    expect(sigopParamsFromForm("despike", f, [1])).toEqual({
      op: "sigop", method: "despike", channels: [1], args: { window: 5, threshold: 5 },
    });
    expect(sigopParamsFromForm("deconvolve", { ...f, fwhm: "0.4", kernel: "lorentzian" }, [0])).toEqual({
      op: "sigop", method: "deconvolve", channels: [0],
      args: { kernel: "lorentzian", fwhm: 0.4, regularisation: 0.001 },
    });
  });

  it("says what is wrong instead of building params", () => {
    expect(sigopParamsFromForm("median", { ...f, window: "4" }, [0])).toMatch(/odd/);
    expect(sigopParamsFromForm("lowess", { ...f, fraction: "1.5" }, [0])).toMatch(/Fraction/);
    expect(sigopParamsFromForm("convolve", f, [0])).toMatch(/FWHM/); // width left blank
    expect(sigopParamsFromForm("median", f, [])).toMatch(/at least one column/);
    expect(sigopParamsFromForm("ifft", { ...f, magnitudeChannel: 1, phaseChannel: 1 }, [])).toMatch(/different/);
  });

  it("reduce: bins by count or width, nth ignores channels", () => {
    expect(sigopParamsFromForm("reduce-bin", { ...f, binMode: "count", nBins: "10", withSd: true }, [0])).toMatchObject({
      args: { nBins: 10, stat: "mean", withSd: true },
    });
    const byWidth = sigopParamsFromForm("reduce-bin", { ...f, binMode: "width", binWidth: "0.5" }, [0]);
    expect(byWidth).toMatchObject({ args: { binWidth: 0.5 } });
    expect(typeof byWidth === "object" && "nBins" in byWidth.args).toBe(false);
    expect(sigopParamsFromForm("reduce-nth", { ...f, n: "3", offset: "1" }, [])).toEqual({
      op: "sigop", method: "reduce-nth", channels: [], args: { n: 3, offset: 1 },
    });
    expect(sigopParamsFromForm("reduce-nth", { ...f, n: "0" }, [])).toMatch(/positive/);
  });

  it("finds the FFT magnitude and phase columns by label", () => {
    expect(spectrumChannels(["x · Phase", "x · Magnitude"])).toEqual({ magnitude: 1, phase: 0 });
    expect(spectrumChannels(["a", "b"])).toEqual({ magnitude: 0, phase: 1 });
    expect(isSigopFilter("hilbert")).toBe(true);
    expect(isSigopFilter("smooth")).toBe(false);
  });
});

describe("sigopParamsOf (replay validation)", () => {
  it("round-trips recorded params and refuses junk", () => {
    const p = sigopParamsFromForm("median", f, [0]);
    expect(sigopParamsOf(p as unknown as Record<string, unknown>)).toEqual(p);
    expect(() => sigopParamsOf({ method: "bogus" })).toThrow(/unknown signal operation/);
    expect(() => sigopParamsOf({ method: "median", channels: ["a"] })).toThrow(/channels/);
    expect(() => sigopParamsOf({ method: "median", channels: [0], args: { w: {} } })).toThrow(/argument/);
  });
});
