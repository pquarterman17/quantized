// Film thickness (FFT)'s preset adapter: the shared contract plus what is
// specific to it (the channel by label, every window the select offers is
// accepted, the 2-theta window rule, nothing that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { FFT_THICKNESS_WINDOWS } from "./fftThicknessOptions";
import { createFftThicknessAdapter, type FftThicknessPreset } from "./fftThicknessPresetAdapter";

const handle = {
  columns: [{ index: 0, label: "Intensity" }, { index: 1, label: "Counts" }, { index: 2, label: "dup" }, { index: 3, label: "dup" }],
  col: 0, wavelength: 1.5406, twoThetaMin: null as number | null, twoThetaMax: null as number | null, windowFn: "hann", maxThicknessNm: 200,
  setCol(i: number) { handle.col = i; },
  setWavelength(v: number) { handle.wavelength = v; },
  setTwoThetaMin(v: number | null) { handle.twoThetaMin = v; },
  setTwoThetaMax(v: number | null) { handle.twoThetaMax = v; },
  setWindowFn(w: string) { handle.windowFn = w; },
  setMaxThicknessNm(v: number) { handle.maxThicknessNm = v; },
};
const adapter = createFftThicknessAdapter(handle);

const sample: FftThicknessPreset = { column: "Counts", wavelength: 1.7889, twoThetaMin: 30, twoThetaMax: 45.5, windowFn: "blackman", maxThicknessNm: 120 };

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "wavelength", value: "1.54" },
  outOfRange: { field: "windowFn", value: "kaiser" },
  missingColumn: { settings: { ...sample, column: "ghost" }, field: "column", labels: ["Intensity"], required: false },
});

describe("FFT thickness adapter specifics", () => {
  it("every window the section offers is accepted", () => {
    for (const w of FFT_THICKNESS_WINDOWS) expect(adapter.parse({ ...sample, windowFn: w.value }), w.value).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named", () => {
    expect(adapter.parse({ ...sample, wavelength: 0 })).toMatchObject({ error: expect.stringContaining("'wavelength'") });
    expect(adapter.parse({ ...sample, maxThicknessNm: -5 })).toMatchObject({ error: expect.stringContaining("'maxThicknessNm'") });
    expect(adapter.parse({ ...sample, twoThetaMin: "10" })).toMatchObject({ error: expect.stringContaining("'twoThetaMin'") });
    expect(adapter.parse({ ...sample, twoThetaMin: 50, twoThetaMax: 40 })).toMatchObject({ error: expect.stringContaining("'twoThetaMin'") });
    expect(adapter.parse({ ...sample, twoThetaMin: null, twoThetaMax: 40 })).not.toHaveProperty("error");
    expect(adapter.parse({ ...sample, column: "" })).toMatchObject({ error: expect.stringContaining("'column'") });
  });

  it("a missing channel is skipped and named, the rest applies, and the channel stays", () => {
    handle.col = 0;
    const out = adapter.apply({ ...sample, column: "ghost" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "column", reason: "column 'ghost' is not on this sheet" }] });
    expect(handle.col).toBe(0);
    expect(handle.wavelength).toBe(1.7889);
  });

  it("a channel label that appears twice is not guessed", () => {
    handle.col = 0;
    const out = adapter.apply({ ...sample, column: "dup" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "column", reason: expect.stringContaining("more than once") }] });
    expect(handle.col).toBe(0);
  });

  it("stores no dataset or row range", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(["column", "maxThicknessNm", "twoThetaMax", "twoThetaMin", "windowFn", "wavelength"].sort());
    expect(adapter.parse({ ...sample, datasetId: "d1" })).toMatchObject({ error: expect.stringContaining("'datasetId'") });
  });
});
