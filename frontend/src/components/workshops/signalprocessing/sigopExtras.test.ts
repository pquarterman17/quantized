import { describe, expect, it } from "vitest";

import { sigopScriptParams } from "../../../lib/transformScriptParams";
import { SIGOP_METHODS, sigopParamsOf } from "../../../lib/transformSigop";
import { assertStepXUnit, stepNeedsXUnit } from "../../../lib/signalXUnit";
import { nyquistOf } from "./SigopExtraFields";
import { DEFAULT_SIGOP_FORM, FILTERS_WITH_RANGE, isSigopFilter, sigopParamsFromForm } from "./sigopModel";

const f = DEFAULT_SIGOP_FORM;
const EXTRAS = ["unwrap", "percentile", "binomial", "envelope-extrema", "coherence", "decimate-aa", "zoom-fft"] as const;

describe("signal extras: form -> params", () => {
  it("builds recordable params for each, with the documented defaults", () => {
    expect(sigopParamsFromForm("unwrap", f, [0])).toEqual({ op: "sigop", method: "unwrap", channels: [0], args: { unit: "radians" } });
    expect(sigopParamsFromForm("percentile", { ...f, window: "7", percentile: "25" }, [0])).toMatchObject({ args: { window: 7, percentile: 25 } });
    expect(sigopParamsFromForm("binomial", f, [1])).toMatchObject({ channels: [1], args: { window: 5 } });
    expect(sigopParamsFromForm("envelope-extrema", f, [0])).toMatchObject({ args: { side: "both", interpolation: "spline", minDistance: 1 } });
    expect(sigopParamsFromForm("coherence", f, [0, 1])).toMatchObject({ channels: [0, 1], args: { window: "hanning", segmentLen: 256, overlap: 0.5 } });
    expect(sigopParamsFromForm("decimate-aa", { ...f, factor: "4" }, [0])).toMatchObject({ args: { factor: 4, filter: "iir", zeroPhase: true } });
    expect(sigopParamsFromForm("zoom-fft", { ...f, fMin: "98", fMax: "104" }, [0])).toMatchObject({
      args: { fMin: 98, fMax: 104, nPoints: 512, window: "hanning", removeMean: true },
    });
  });

  it("says what is wrong instead of building params", () => {
    expect(sigopParamsFromForm("percentile", { ...f, percentile: "120" }, [0])).toMatch(/between 0 and 100/);
    expect(sigopParamsFromForm("binomial", { ...f, window: "4" }, [0])).toMatch(/odd/);
    expect(sigopParamsFromForm("coherence", f, [0])).toMatch(/exactly two/);
    expect(sigopParamsFromForm("coherence", { ...f, overlap: "1" }, [0, 1])).toMatch(/Overlap/);
    expect(sigopParamsFromForm("decimate-aa", { ...f, factor: "1" }, [0])).toMatch(/factor/);
    expect(sigopParamsFromForm("decimate-aa", { ...f, factor: "20" }, [0])).toMatch(/13/);
    expect(sigopParamsFromForm("decimate-aa", { ...f, factor: "20", aaFilter: "fir" }, [0])).toMatchObject({ args: { factor: 20, filter: "fir" } });
    expect(sigopParamsFromForm("zoom-fft", f, [0])).toMatch(/Band/);
    expect(sigopParamsFromForm("zoom-fft", { ...f, fMin: "5", fMax: "2" }, [0])).toMatch(/Band/);
    expect(sigopParamsFromForm("unwrap", f, [])).toMatch(/at least one column/);
  });

  it("offers the same-length extras an X range and the new-axis ones none", () => {
    for (const m of ["unwrap", "percentile", "binomial", "envelope-extrema"] as const) {
      expect(FILTERS_WITH_RANGE).toContain(m);
      expect(sigopParamsFromForm(m, { ...f, useRange: true, xMin: "1", xMax: "4" }, [0])).toMatchObject({ args: { xMin: 1, xMax: 4 } });
    }
    for (const m of ["coherence", "decimate-aa", "zoom-fft"] as const) {
      expect(FILTERS_WITH_RANGE).not.toContain(m);
      const ch = m === "coherence" ? [0, 1] : [0];
      const p = sigopParamsFromForm(m, { ...f, fMin: "1", fMax: "2", useRange: true, xMin: "1", xMax: "4" }, ch);
      expect(typeof p === "object" && "xMin" in p.args).toBe(false);
    }
  });
});

describe("signal extras: replay and recipe plumbing", () => {
  it("every extra is a picker filter, a known method, and round-trips through replay validation", () => {
    for (const m of EXTRAS) {
      expect(isSigopFilter(m)).toBe(true);
      expect(SIGOP_METHODS).toContain(m);
      const p = sigopParamsFromForm(m, { ...f, fMin: "1", fMax: "2" }, m === "coherence" ? [0, 1] : [0]);
      expect(typeof p).toBe("object");
      expect(sigopParamsOf(p as unknown as Record<string, unknown>)).toEqual(p);
      expect(sigopScriptParams(p as unknown as Record<string, unknown>).method).toBe(m);
    }
  });

  it("a Zoom FFT band recorded in one X unit is refused on another", () => {
    const step = { op: "sigop", method: "zoom-fft", args: { fMin: 1, fMax: 2 }, xUnit: "s" };
    expect(stepNeedsXUnit(step)).toBe(true);
    expect(() => assertStepXUnit(step, "ms")).toThrow(/recorded for X in s/);
    expect(stepNeedsXUnit({ op: "sigop", method: "unwrap", args: {} })).toBe(false);
  });

  it("finds the Nyquist frequency from the median X spacing", () => {
    expect(nyquistOf([0, 0.001, 0.002, 0.003])).toBeCloseTo(500, 6);
    expect(nyquistOf([1, 1])).toBeNull();
  });
});
