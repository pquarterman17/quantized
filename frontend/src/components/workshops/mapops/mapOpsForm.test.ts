import { describe, expect, it } from "vitest";

import { buildRequest, emptyForm, opLabel } from "./mapOpsForm";

describe("buildRequest", () => {
  it("crop: empty bounds are unbounded, junk and all-empty are refused", () => {
    expect(buildRequest({ ...emptyForm(), op: "crop", xmin: "1", ymax: "5" }).req).toEqual({ op: "crop", xmin: 1, xmax: null, ymin: null, ymax: 5 });
    expect(buildRequest({ ...emptyForm(), op: "crop", xmin: "abc" }).error).toMatch(/numbers/);
    expect(buildRequest({ ...emptyForm(), op: "crop" }).error).toMatch(/at least one/);
  });

  it("geometry ops", () => {
    expect(buildRequest({ ...emptyForm(), op: "flip", flipAxis: "v" }).req).toEqual({ op: "flip", axis: "v" });
    expect(buildRequest({ ...emptyForm(), op: "rotate", degrees: "270" }).req).toEqual({ op: "rotate", degrees: 270 });
    expect(buildRequest({ ...emptyForm(), op: "transpose" }).req).toEqual({ op: "transpose" });
    expect(buildRequest({ ...emptyForm(), op: "level", order: "2", restoreMean: true }).req).toEqual({ op: "plane_level", order: 2, restore_mean: true });
  });

  it("arithmetic needs map B; scalar needs a number", () => {
    expect(buildRequest({ ...emptyForm(), op: "arith" }).error).toMatch(/second map/);
    const ok = buildRequest({ ...emptyForm(), op: "arith", otherId: "b", arith: "div", interpolate: true });
    expect(ok.req).toEqual({ op: "arith", arith: "div", interpolate: true, allow_mismatch: false });
    expect(buildRequest({ ...emptyForm(), op: "scalar", scalar: "" }).error).toMatch(/number/);
    expect(buildRequest({ ...emptyForm(), op: "scalar", scalar: "2.5", arith: "mul", reverse: true }).req).toEqual({ op: "scalar", arith: "mul", value: 2.5, reverse: true });
  });

  it("names the result by its operation", () => {
    expect(opLabel({ ...emptyForm(), op: "rotate", degrees: "90" })).toBe("rotate 90°");
    expect(opLabel({ ...emptyForm(), op: "arith", arith: "sub" }, "dark.xrdml")).toBe("A − dark.xrdml");
    expect(opLabel({ ...emptyForm(), op: "scalar", arith: "div", scalar: "4", reverse: true })).toBe("4 ÷ A");
  });

  it("FFT, FFT filter and image filter requests (and refusals)", () => {
    expect(buildRequest({ ...emptyForm(), op: "fft", fftOutput: "phase", fftWindow: "hann", fftRemoveMean: true }).req).toEqual({ op: "fft2d", fft_output: "phase", window: "hann", remove_mean: true });
    expect(buildRequest({ ...emptyForm(), op: "fftfilter", fMode: "lowpass" }).error).toMatch(/cutoff/);
    expect(buildRequest({ ...emptyForm(), op: "fftfilter", fMode: "lowpass", cutHigh: "2", edgeSigma: "0.1" }).req).toEqual({ op: "fft_filter", filter_mode: "lowpass", cutoff_low: null, cutoff_high: 2, edge_sigma: 0.1 });
    expect(buildRequest({ ...emptyForm(), op: "fftfilter", fMode: "bandpass", cutLow: "1" }).error).toMatch(/cutoff/);
    expect(buildRequest({ ...emptyForm(), op: "fftfilter", fMode: "highpass", cutLow: "1", edgeSigma: "-1" }).error).toMatch(/softness/);
    expect(buildRequest({ ...emptyForm(), op: "imgfilter", imgKind: "gaussian", sigma: "0" }).error).toMatch(/sigma/);
    expect(buildRequest({ ...emptyForm(), op: "imgfilter", imgKind: "gaussian", sigma: "2" }).req).toEqual({ op: "image_filter", filter_kind: "gaussian", edge_mode: "reflect", sigma: 2 });
    expect(buildRequest({ ...emptyForm(), op: "imgfilter", imgKind: "median", size: "2.5" }).error).toMatch(/whole/);
    expect(buildRequest({ ...emptyForm(), op: "imgfilter", imgKind: "uniform", size: "5", edgeMode: "constant", cval: "1" }).req).toEqual({ op: "image_filter", filter_kind: "uniform", edge_mode: "constant", cval: 1, size: 5 });
    expect(buildRequest({ ...emptyForm(), op: "imgfilter", imgKind: "sobel", gradient: "x" }).req).toEqual({ op: "image_filter", filter_kind: "sobel", edge_mode: "reflect", gradient: "x" });
    expect(opLabel({ ...emptyForm(), op: "fftfilter", fMode: "highpass" })).toBe("FFT highpass");
  });

  it("2-D wavelet requests (and refusals)", () => {
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d" }).req).toEqual({ op: "wavelet2d", wt_action: "denoise", wt_wavelet: "db4", wt_mode: "symmetric", wt_threshold: "soft" });
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d", wtLevel: "2", wtValue: "0", wtThreshold: "hard" }).req).toEqual({ op: "wavelet2d", wt_action: "denoise", wt_wavelet: "db4", wt_mode: "symmetric", wt_level: 2, wt_threshold: "hard", wt_value: 0 });
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d", wtAction: "smooth", wtZero: "1, 2" }).req).toMatchObject({ wt_action: "smooth", wt_zero: "1,2" });
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d", wtAction: "smooth", wtZero: "" }).error).toMatch(/levels/);
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d", wtLevel: "1.5" }).error).toMatch(/whole/);
    expect(buildRequest({ ...emptyForm(), op: "wavelet2d", wtValue: "-1" }).error).toMatch(/threshold/);
    expect(opLabel({ ...emptyForm(), op: "wavelet2d", wtAction: "smooth", wtWavelet: "haar" })).toBe("wavelet smooth haar");
  });
});
