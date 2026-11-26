import { describe, expect, it } from "vitest";

import { fftColumnOf, fftOutputOf, fftRequestFor } from "./gadgetFftColumn";

describe("gadget FFT output", () => {
  it("magnitude sends nothing extra; psd and power ask for a PSD, only power asks for the per-bin scaling", () => {
    expect(fftRequestFor("magnitude")).toEqual({});
    expect(fftRequestFor("psd")).toEqual({ output_type: "psd" });
    expect(fftRequestFor("power")).toEqual({ output_type: "psd", scaling: "spectrum" });
  });
  it("labels and units: density is y²·x, power is y², magnitude is as before", () => {
    expect(fftColumnOf({ magnitude: [1] }, "V", "s")).toMatchObject({ label: "magnitude", unit: "" });
    expect(fftColumnOf({ psd: [1], scaling: "density" }, "V", "s")).toMatchObject({ label: "psd", unit: "V²·s" });
    expect(fftColumnOf({ psd: [1] }, "V", "")).toMatchObject({ label: "psd", unit: "V²" });
    expect(fftColumnOf({ psd: [1], scaling: "spectrum" }, "V", "s")).toMatchObject({ label: "power", unit: "V²" });
    expect(fftColumnOf({ psd: [1], scaling: "spectrum" }, "", "s")).toMatchObject({ label: "power", unit: "" });
  });
  it("records the output a result was computed as", () => {
    expect(fftOutputOf({ magnitude: [1] })).toBe("magnitude");
    expect(fftOutputOf({ psd: [1], scaling: "density" })).toBe("psd");
    expect(fftOutputOf({ psd: [1], scaling: "spectrum" })).toBe("power");
  });
});
