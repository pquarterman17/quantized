// The preset adapters of the Reductions window's Williamson-Hall, Pawley,
// Reflectivity FFT and XRD reference pattern methods: the shared contract plus
// what is specific to each (every option the method offers is accepted, columns
// by label, the hidden-field rule, nothing that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { REFERENCE_AXIS_MODES } from "../../../lib/xrdReferencePattern";
import { PAWLEY_DEFAULT_FIELDS, type PawleyFields, type PawleyTie } from "./pawleyInputs";
import { PAWLEY_CENTERING_OPTIONS, PAWLEY_TIE_OPTIONS } from "./pawleyOptions";
import { createPawleyAdapter, type PawleyHandle, type PawleyPreset } from "./pawleyPresetAdapter";
import { REFLECTIVITY_FFT_PREPROCESS, REFLECTIVITY_FFT_WINDOWS } from "./reflectivityFftOptions";
import { createReflectivityFftAdapter, type ReflectivityFftHandle, type ReflectivityFftPreset } from "./reflectivityFftPresetAdapter";
import { createReferencePatternAdapter, type ReferencePatternHandle, type ReferencePatternPreset } from "./referencePatternPresetAdapter";
import { createWilliamsonHallAdapter, type WilliamsonHallHandle, type WilliamsonHallPreset } from "./williamsonHallPresetAdapter";

const COLUMNS = [{ index: 0, label: "Intensity" }, { index: 1, label: "Counts" }, { index: 2, label: "dup" }, { index: 3, label: "dup" }];

// ---- Williamson-Hall
const wh = {
  wavelength: 1.5406, kFactor: 0.9, instrumentalBroadening: 0, calls: [] as string[],
  setWavelength(v: number) { wh.wavelength = v; wh.calls.push("wavelength"); },
  setKFactor(v: number) { wh.kFactor = v; wh.calls.push("kFactor"); },
  setInstrumentalBroadening(v: number) { wh.instrumentalBroadening = v; wh.calls.push("broadening"); },
} satisfies WilliamsonHallHandle & { calls: string[] };
const whAdapter = createWilliamsonHallAdapter(wh);
const whSample: WilliamsonHallPreset = { wavelength: 0.7107, kFactor: 0.94, instrumentalBroadening: 0.05 };

describePresetAdapterContract({ adapter: whAdapter, sample: whSample, wrongType: { field: "kFactor", value: "0.9" }, outOfRange: { field: "wavelength", value: 0 } });

describe("Williamson-Hall adapter specifics", () => {
  it("rejects each bad value with its field named; zero broadening is fine", () => {
    expect(whAdapter.parse({ ...whSample, kFactor: -1 })).toMatchObject({ error: expect.stringContaining("'kFactor'") });
    expect(whAdapter.parse({ ...whSample, instrumentalBroadening: -0.1 })).toMatchObject({ error: expect.stringContaining("'instrumentalBroadening'") });
    expect(whAdapter.parse({ ...whSample, instrumentalBroadening: 0 })).not.toHaveProperty("error");
  });
  it("stores no peaks, and only writes a value that changes (a setter retires the shown result)", () => {
    expect(whAdapter.parse({ ...whSample, rows: [{ twoTheta: 30, fwhm: 0.2 }] })).toMatchObject({ error: expect.stringContaining("'rows'") });
    wh.calls.length = 0;
    Object.assign(wh, { wavelength: 0.7107, kFactor: 0.9, instrumentalBroadening: 0 });
    const out = whAdapter.apply(whSample);
    expect(wh.calls).toEqual(["kFactor", "broadening"]);
    expect(out).toMatchObject({ ok: true, notes: [expect.stringContaining("does not store them")] });
  });
});

// ---- Pawley
const pw = {
  columns: COLUMNS, col: 0, fields: { ...PAWLEY_DEFAULT_FIELDS } as PawleyFields, tie: "abc" as PawleyTie, symmetry: "P" as PawleyPreset["symmetry"], refineCell: true as boolean,
  setCol(i: number) { pw.col = i; },
  setSymmetry(s: PawleyPreset["symmetry"]) { pw.symmetry = s; },
  setRefineCell(v: boolean) { pw.refineCell = v; },
  applyFields(next: PawleyFields, tie: PawleyTie) { pw.fields = { ...next }; pw.tie = tie; },
} satisfies PawleyHandle;
const pwAdapter = createPawleyAdapter(pw);
const pwSample: PawleyPreset = {
  column: "Counts", a: "4.05", b: "4.1", c: "6.2", alpha: "90", beta: "95", gamma: "120", wavelength: "0.7107", fwhm: "0.2", tie: "none", symmetry: "F", refineCell: false,
};

describePresetAdapterContract({
  adapter: pwAdapter,
  sample: pwSample,
  wrongType: { field: "refineCell", value: "yes" },
  outOfRange: { field: "symmetry", value: "Z" },
  missingColumn: { settings: { ...pwSample, column: "ghost" }, field: "column", labels: ["Intensity"], required: false },
});

describe("Pawley adapter specifics", () => {
  const parse = (patch: Record<string, unknown>) => pwAdapter.parse({ ...pwSample, ...patch });
  it("every centering and tie the section offers is accepted", () => {
    for (const o of PAWLEY_CENTERING_OPTIONS) expect(parse({ symmetry: o.value }), o.value).not.toHaveProperty("error");
    for (const o of PAWLEY_TIE_OPTIONS) expect(parse({ tie: o.value }), o.value).not.toHaveProperty("error");
  });
  it("rejects each bad value with its field named", () => {
    expect(parse({ a: "0" })).toMatchObject({ error: expect.stringContaining("'a'") });
    expect(parse({ a: "" })).toMatchObject({ error: expect.stringContaining("'a'") });
    expect(parse({ beta: "180" })).toMatchObject({ error: expect.stringContaining("'beta'") });
    expect(parse({ wavelength: "11" })).toMatchObject({ error: expect.stringContaining("'wavelength'") });
    expect(parse({ fwhm: "-1" })).toMatchObject({ error: expect.stringContaining("'fwhm'") });
    expect(parse({ alpha: "20", beta: "20", gamma: "170" })).toMatchObject({ error: expect.stringContaining("positive-volume") });
  });
  it("b and c are hidden while the tie fixes them: not checked, not stored, never written", () => {
    expect(parse({ tie: "abc", b: "-1", c: "" })).not.toHaveProperty("error");
    expect(parse({ tie: "ab", b: "-1", c: "6" })).not.toHaveProperty("error");
    expect(parse({ tie: "ab", b: "-1", c: "" })).toMatchObject({ error: expect.stringContaining("'c'") });
    expect(parse({ tie: "abc", b: 7 })).toMatchObject({ error: expect.stringContaining("'b'") }); // wrong KIND is still refused
    Object.assign(pw, { fields: { ...PAWLEY_DEFAULT_FIELDS, b: "oops", c: "" }, tie: "abc" });
    expect(pwAdapter.capture()).toMatchObject({ b: PAWLEY_DEFAULT_FIELDS.b, c: PAWLEY_DEFAULT_FIELDS.c });
    pw.fields = { ...PAWLEY_DEFAULT_FIELDS, b: "5.5", c: "5.6" };
    pwAdapter.apply({ ...pwSample, tie: "abc", b: "-1", c: "" });
    expect(pw.fields).toMatchObject({ b: "5.5", c: "5.6" });
  });
  it("a missing or repeated channel is skipped and named, and the channel stays", () => {
    pw.col = 0;
    expect(pwAdapter.apply({ ...pwSample, column: "ghost" })).toMatchObject({ ok: true, skipped: [{ field: "column", reason: "column 'ghost' is not on this sheet" }] });
    expect(pwAdapter.apply({ ...pwSample, column: "dup" })).toMatchObject({ ok: true, skipped: [{ field: "column", reason: expect.stringContaining("more than once") }] });
    expect(pw.col).toBe(0);
    expect(pw.fields.wavelength).toBe("0.7107"); // the rest still applied
  });
  it("stores no scan, 2θ range or dataset", () => {
    expect(Object.keys(pwAdapter.capture()).sort()).toEqual(Object.keys(pwSample).sort());
    expect(parse({ range: [10, 90] })).toMatchObject({ error: expect.stringContaining("'range'") });
  });
});

// ---- Reflectivity FFT
const rf = {
  columns: COLUMNS, col: 0, isNeutron: false as boolean, wavelength: 1.5406, xMin: null as number | null, xMax: null as number | null, windowFn: "hann",
  preprocess: "logR" as ReflectivityFftPreset["preprocess"], maxThicknessNm: 500, peakProminence: 0.05,
  setCol(i: number) { rf.col = i; },
  setIsNeutron(v: boolean) { rf.isNeutron = v; },
  setWavelength(v: number) { rf.wavelength = v; },
  setXMin(v: number | null) { rf.xMin = v; },
  setXMax(v: number | null) { rf.xMax = v; },
  setWindowFn(v: string) { rf.windowFn = v; },
  setPreprocess(v: ReflectivityFftPreset["preprocess"]) { rf.preprocess = v; },
  setMaxThicknessNm(v: number) { rf.maxThicknessNm = v; },
  setPeakProminence(v: number) { rf.peakProminence = v; },
} satisfies ReflectivityFftHandle;
const rfAdapter = createReflectivityFftAdapter(rf);
const rfSample: ReflectivityFftPreset = { column: "Counts", isNeutron: false, wavelength: 1.7889, xMin: 0.5, xMax: 8, windowFn: "blackman", preprocess: "RQ4", maxThicknessNm: 120, peakProminence: 0.2 };

describePresetAdapterContract({
  adapter: rfAdapter,
  sample: rfSample,
  wrongType: { field: "isNeutron", value: "no" },
  outOfRange: { field: "preprocess", value: "sqrt" },
  missingColumn: { settings: { ...rfSample, column: "ghost" }, field: "column", labels: ["Intensity"], required: false },
});

describe("Reflectivity FFT adapter specifics", () => {
  const parse = (patch: Record<string, unknown>) => rfAdapter.parse({ ...rfSample, ...patch });
  it("every window and preprocess the section offers is accepted", () => {
    for (const o of REFLECTIVITY_FFT_WINDOWS) expect(parse({ windowFn: o.value }), o.value).not.toHaveProperty("error");
    for (const o of REFLECTIVITY_FFT_PREPROCESS) expect(parse({ preprocess: o.value }), o.value).not.toHaveProperty("error");
  });
  it("rejects each bad value with its field named", () => {
    expect(parse({ peakProminence: 0 })).toMatchObject({ error: expect.stringContaining("'peakProminence'") });
    expect(parse({ maxThicknessNm: -5 })).toMatchObject({ error: expect.stringContaining("'maxThicknessNm'") });
    expect(parse({ xMin: 9, xMax: 8 })).toMatchObject({ error: expect.stringContaining("'xMin'") });
    expect(parse({ xMin: null, xMax: 8 })).not.toHaveProperty("error");
  });
  it("the wavelength is hidden in neutron mode: not checked, not stored, never written", () => {
    expect(parse({ isNeutron: true, wavelength: -1 })).not.toHaveProperty("error");
    expect(parse({ isNeutron: true, wavelength: "x" })).toMatchObject({ error: expect.stringContaining("'wavelength'") });
    Object.assign(rf, { isNeutron: true, wavelength: 0 });
    expect(rfAdapter.capture().wavelength).toBe(1.5406);
    rf.wavelength = 1.54;
    rfAdapter.apply({ ...rfSample, isNeutron: true, wavelength: -1 });
    expect(rf.wavelength).toBe(1.54);
  });
  it("a missing channel is skipped and named, and the channel stays", () => {
    rf.col = 1;
    expect(rfAdapter.apply({ ...rfSample, column: "ghost" })).toMatchObject({ ok: true, skipped: [{ field: "column", reason: "column 'ghost' is not on this sheet" }] });
    expect(rf.col).toBe(1);
  });
});

// ---- XRD reference pattern
const rp = {
  axisMode: "auto" as ReferencePatternPreset["axisMode"], baseline: "0.03", height: "0.18", color: "#d97706", showLabels: false as boolean, patternLoaded: true as boolean,
  setAxisMode(m: ReferencePatternPreset["axisMode"]) { rp.axisMode = m; },
  setBaseline(v: string) { rp.baseline = v; },
  setHeight(v: string) { rp.height = v; },
  setColor(v: string) { rp.color = v; },
  setShowLabels(v: boolean) { rp.showLabels = v; },
} satisfies ReferencePatternHandle;
const rpAdapter = createReferencePatternAdapter(rp);
const rpSample: ReferencePatternPreset = { axisMode: "two-theta", baseline: "0.1", height: "0.4", color: "#3366cc", showLabels: true };

describePresetAdapterContract({ adapter: rpAdapter, sample: rpSample, wrongType: { field: "showLabels", value: 1 }, outOfRange: { field: "axisMode", value: "q" } });

describe("XRD reference pattern adapter specifics", () => {
  const parse = (patch: Record<string, unknown>) => rpAdapter.parse({ ...rpSample, ...patch });
  it("every axis reading the section offers is accepted", () => {
    for (const m of REFERENCE_AXIS_MODES) expect(parse({ axisMode: m }), m).not.toHaveProperty("error");
  });
  it("rejects each bad value with its field named", () => {
    expect(parse({ baseline: "1" })).toMatchObject({ error: expect.stringContaining("'baseline'") });
    expect(parse({ height: "0" })).toMatchObject({ error: expect.stringContaining("'height'") });
    expect(parse({ baseline: "0.7", height: "0.5" })).toMatchObject({ error: expect.stringContaining("'height'") });
    expect(parse({ color: "orange" })).toMatchObject({ error: expect.stringContaining("'color'") });
  });
  it("the drawing knobs are hidden until a pattern is loaded: a refused value is replaced by its default when saved", () => {
    Object.assign(rp, { patternLoaded: false, baseline: "", height: "0.4", color: "#3366cc" });
    expect(rpAdapter.capture()).toMatchObject({ baseline: "0.03", height: "0.4", color: "#3366cc" }); // only the refused one is replaced
    Object.assign(rp, { baseline: "0.7", height: "0.5" }); // each fine alone, together over the plot
    expect(rpAdapter.capture()).toMatchObject({ baseline: "0.03", height: "0.18" });
    rp.patternLoaded = true;
    expect(rpAdapter.capture()).toMatchObject({ baseline: "0.7", height: "0.5" }); // visible: shown as the user has it, Save will refuse
  });
  it("stores no pattern, name or source wavelength, and says to choose the file", () => {
    expect(parse({ sourceWavelength: "1.54" })).toMatchObject({ error: expect.stringContaining("'sourceWavelength'") });
    expect(parse({ reflections: [] })).toMatchObject({ error: expect.stringContaining("'reflections'") });
    expect(rpAdapter.apply(rpSample)).toMatchObject({ ok: true, notes: [expect.stringContaining("does not store the pattern")] });
  });
});
