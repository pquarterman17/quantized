import { describe, expect, it } from "vitest";

import { assertStepXUnit, stepNeedsXUnit } from "../../../lib/signalXUnit";
import { sigopScriptParams } from "../../../lib/transformScriptParams";
import { SIGOP_METHODS, sigopParamsOf } from "../../../lib/transformSigop";
import { DEFAULT_SIGOP_FORM, isSigopFilter, sigopParamsFromForm } from "./sigopModel";
import { SIGOP_WAVELET_OPTIONS, levelTokens } from "./sigopWaveletModel";

const f = DEFAULT_SIGOP_FORM;

describe("wavelets: form -> params", () => {
  it("builds recordable params with the documented defaults", () => {
    expect(sigopParamsFromForm("cwt", f, [0])).toEqual({
      op: "sigop", method: "cwt", channels: [0],
      args: { bandwidth: 1.5, centerFrequency: 1, wavelet: "morlet", axis: "frequency", count: 64, spacing: "log", output: "scalogram" },
    });
    expect(sigopParamsFromForm("dwt", f, [0])).toMatchObject({ args: { wavelet: "db4", level: 4, mode: "symmetric" } });
    expect(sigopParamsFromForm("wavelet-denoise", f, [0])).toMatchObject({ args: { rule: "universal", threshold: "soft", scope: "global" } });
    expect(sigopParamsFromForm("wavelet-smooth", f, [0])).toMatchObject({ args: { level: 4, zero: "1" } });
    expect(sigopParamsFromForm("wavelet-reconstruct", f, [0])).toMatchObject({ args: { keep: "A,4,3,2,1" } });
  });

  it("a limit left blank is automatic; one that is typed is recorded", () => {
    const p = sigopParamsFromForm("cwt", { ...f, cwtMin: "2", cwtMax: "40", cwtFamily: "gaussian", cwtOrder: "3" }, [0]);
    expect(p).toMatchObject({ args: { axisMin: 2, axisMax: 40, order: 3, wavelet: "gaussian" } });
    expect(typeof p === "object" && "bandwidth" in p.args).toBe(false);
  });

  it("reconstruct keeps what is ticked and smooth zeroes what is ticked", () => {
    expect(sigopParamsFromForm("wavelet-reconstruct", { ...f, reconOff: "1,2" }, [0])).toMatchObject({ args: { keep: "A,4,3" } });
    expect(sigopParamsFromForm("wavelet-reconstruct", { ...f, dwtLevel: "2", reconOff: "A,1,2" }, [0])).toMatch(/at least one/);
    expect(sigopParamsFromForm("wavelet-smooth", { ...f, smoothZero: "1,2,9" }, [0])).toMatchObject({ args: { zero: "1,2" } });
    expect(sigopParamsFromForm("wavelet-smooth", { ...f, smoothZero: "" }, [0])).toMatch(/at least one detail level/);
    expect(levelTokens("A, 2,2,")).toEqual(["A", "2"]);
  });

  it("says what is wrong instead of building params", () => {
    expect(sigopParamsFromForm("cwt", f, [0, 1])).toMatch(/exactly one/);
    expect(sigopParamsFromForm("cwt", { ...f, cwtCount: "1" }, [0])).toMatch(/2 to 512/);
    expect(sigopParamsFromForm("cwt", { ...f, cwtMin: "5", cwtMax: "2" }, [0])).toMatch(/below the maximum/);
    expect(sigopParamsFromForm("cwt", { ...f, cwtMin: "-1" }, [0])).toMatch(/positive/);
    expect(sigopParamsFromForm("cwt", { ...f, cwtBandwidth: "0" }, [0])).toMatch(/Morlet/);
    expect(sigopParamsFromForm("cwt", { ...f, cwtFamily: "gaussian", cwtOrder: "9" }, [0])).toMatch(/1 to 8/);
    expect(sigopParamsFromForm("dwt", { ...f, dwtLevel: "0" }, [0])).toMatch(/Level/);
    expect(sigopParamsFromForm("dwt", f, [])).toMatch(/at least one column/);
  });

  it("has no X range: the backend refuses one for these methods", () => {
    const p = sigopParamsFromForm("dwt", { ...f, useRange: true, xMin: "1", xMax: "4" }, [0]);
    expect(typeof p === "object" && "xMin" in p.args).toBe(false);
  });
});

describe("wavelets: replay and recipe plumbing", () => {
  it("every method is a picker filter, a known method, and round-trips through replay validation", () => {
    for (const { value } of SIGOP_WAVELET_OPTIONS) {
      expect(isSigopFilter(value)).toBe(true);
      expect(SIGOP_METHODS).toContain(value);
      const p = sigopParamsFromForm(value, f, [0]);
      expect(typeof p).toBe("object");
      expect(sigopParamsOf(p as unknown as Record<string, unknown>)).toEqual(p);
      expect(sigopScriptParams(p as unknown as Record<string, unknown>).method).toBe(value);
    }
  });

  it("a CWT frequency range recorded in one X unit is refused on another; a scale range is unit-free", () => {
    const step = { op: "sigop", method: "cwt", args: { axis: "frequency", axisMin: 1, axisMax: 9 }, xUnit: "s" };
    expect(stepNeedsXUnit(step)).toBe(true);
    expect(() => assertStepXUnit(step, "ms")).toThrow(/recorded for X in s/);
    expect(stepNeedsXUnit({ ...step, args: { axis: "scale", axisMin: 2, axisMax: 40 } })).toBe(false);
    expect(stepNeedsXUnit({ ...step, args: { axis: "frequency" } })).toBe(false);
    expect(stepNeedsXUnit({ op: "sigop", method: "dwt", args: { level: 3 } })).toBe(false);
  });
});
