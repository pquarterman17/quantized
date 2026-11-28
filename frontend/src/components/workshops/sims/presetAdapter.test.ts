// SIMS' preset adapter: the shared contract plus what is specific to it (every
// option the Process tab offers is accepted, the hidden-field rule, species by
// label with a missing one skipped and named, nothing that names a profile).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { genericBackend } from "../../../lib/presets";
import { SIMS_LENGTH_UNITS, SIMS_SMOOTH_METHODS, SIMS_TIME_UNITS } from "../../../lib/transformSims";
import { createSimsAdapter, type SimsPreset } from "./presetAdapter";
import { defaultForm, type SimsForm } from "./simsForm";
import { SIMS_CAL_METHOD_OPTIONS, SIMS_SCALE_MODE_OPTIONS } from "./simsOptions";

const LABELS = ["Si", "O", "B", "P"];
const handle = {
  form: { ...defaultForm(), bgLo: "5", bgHi: "9", timeUnit: "min" } as SimsForm,
  labels: LABELS,
  setForm(patch: Partial<SimsForm>) { handle.form = { ...handle.form, ...patch }; },
};
const adapter = createSimsAdapter(handle);

const sample: SimsPreset = {
  calOn: true, calMethod: "rate", sputterRate: "0.5", rateLen: "A", rateTime: "min", craterDepth: "250", craterUnit: "um", totalTime: "900",
  depthUnit: "um", scaleMode: "divide", scaleValue: "4", offset: "-2", bgOn: true, bgKeep: ["Si", "O"], normOn: true, reference: "Si",
  rsf: { B: "1.5e21", P: "2" }, rsfUnit: "atoms/cm3", smoothOn: true, smoothMethod: "savitzky-golay", window: "4", polyOrder: "3",
};

describePresetAdapterContract({
  adapter,
  sample,
  wrongType: { field: "bgOn", value: "yes" },
  outOfRange: { field: "smoothMethod", value: "median" },
  missingColumn: { settings: { ...sample, reference: "Ge" }, field: "reference", labels: LABELS, required: false },
});

const parse = (patch: Record<string, unknown>) => adapter.parse({ ...sample, ...patch });

describe("SIMS adapter specifics", () => {
  it("every option list the tab offers is accepted, on the stage that shows it", () => {
    for (const o of SIMS_CAL_METHOD_OPTIONS) expect(parse({ calMethod: o.value }), o.value).not.toHaveProperty("error");
    for (const o of SIMS_SCALE_MODE_OPTIONS) expect(parse({ calMethod: "scale", scaleMode: o.value }), o.value).not.toHaveProperty("error");
    for (const u of SIMS_LENGTH_UNITS) expect(parse({ depthUnit: u, rateLen: u, craterUnit: u }), u).not.toHaveProperty("error");
    for (const u of SIMS_TIME_UNITS) expect(parse({ rateTime: u }), u).not.toHaveProperty("error");
    for (const m of SIMS_SMOOTH_METHODS) expect(parse({ smoothMethod: m }), m).not.toHaveProperty("error");
  });

  it("rejects each bad value with its field named, where the stage shows it", () => {
    expect(parse({ calMethod: "magic" })).toMatchObject({ error: expect.stringContaining("'calMethod'") });
    expect(parse({ sputterRate: "-1" })).toMatchObject({ error: expect.stringContaining("'sputterRate'") });
    expect(parse({ calMethod: "crater", craterDepth: "0" })).toMatchObject({ error: expect.stringContaining("'craterDepth'") });
    expect(parse({ calMethod: "scale", scaleValue: "abc" })).toMatchObject({ error: expect.stringContaining("'scaleValue'") });
    expect(parse({ rateLen: "mm" })).toMatchObject({ error: expect.stringContaining("'rateLen'") });
    expect(parse({ window: "1.5" })).toMatchObject({ error: expect.stringContaining("'window'") });
    expect(parse({ polyOrder: "-1" })).toMatchObject({ error: expect.stringContaining("'polyOrder'") });
    expect(parse({ rsf: { B: "-2" } })).toMatchObject({ error: expect.stringContaining("'rsf'") });
    expect(parse({ bgKeep: ["Si", "Si"] })).toMatchObject({ error: expect.stringContaining("'bgKeep'") });
    expect(parse({ extra: 1 })).toMatchObject({ error: expect.stringContaining("'extra'") });
  });

  it("hidden knobs are neither refused nor stored: a refused value there never blocks Save", () => {
    // a stage that is off hides all its options
    expect(parse({ calOn: false, calMethod: "zzz", sputterRate: "-1", depthUnit: "mm", scaleValue: "x" })).not.toHaveProperty("error");
    expect(parse({ bgOn: false, bgKeep: "Si" })).toMatchObject({ error: expect.stringContaining("'bgKeep'") }); // a wrong KIND is still refused
    expect(parse({ bgOn: false, bgKeep: ["Si", "Si"] })).not.toHaveProperty("error");
    expect(parse({ normOn: false, reference: "", rsf: { B: "-3" }, rsfUnit: "x".repeat(40) })).not.toHaveProperty("error");
    expect(parse({ smoothOn: false, window: "0", polyOrder: "x", smoothMethod: "zzz" })).not.toHaveProperty("error");
    // a method hides the other methods' options, and only Savitzky-Golay uses the order
    expect(parse({ calMethod: "rate", craterDepth: "-1", scaleValue: "0", craterUnit: "mm" })).not.toHaveProperty("error");
    expect(parse({ calMethod: "crater", sputterRate: "-1", rateLen: "mm", offset: "abc" })).not.toHaveProperty("error");
    expect(parse({ smoothMethod: "moving", polyOrder: "-4" })).not.toHaveProperty("error");
    expect(parse({ smoothMethod: "savitzky-golay", polyOrder: "-4" })).toMatchObject({ error: expect.stringContaining("'polyOrder'") });

    handle.form = { ...defaultForm(), calOn: false, sputterRate: "-5", calMethod: "rate", smoothOn: false, window: "0", normOn: false, rsf: { B: "-1" } };
    const captured = adapter.capture();
    expect(captured).toMatchObject({ calOn: false, sputterRate: "", window: "2", rsf: {} });
    expect(adapter.parse(captured)).not.toHaveProperty("error");
    localStorage.clear();
    expect(genericBackend(adapter).save("hidden", captured)).toMatchObject({ ok: true });
    localStorage.clear();
  });

  it("stores no profile, background region or time-unit statement, and says to enter them", () => {
    expect(Object.keys(adapter.capture()).sort()).toEqual(Object.keys(sample).sort());
    expect(adapter.parse({ ...sample, bgLo: "5" })).toMatchObject({ error: expect.stringContaining("'bgLo'") });
    expect(adapter.parse({ ...sample, timeUnit: "min" })).toMatchObject({ error: expect.stringContaining("'timeUnit'") });
    handle.form = { ...defaultForm(), bgLo: "5", bgHi: "9", timeUnit: "min" };
    const out = adapter.apply(sample);
    expect(out).toMatchObject({ ok: true, notes: [expect.stringContaining("background region"), expect.stringContaining("time unit")] });
    expect(handle.form).toMatchObject({ bgLo: "5", bgHi: "9", timeUnit: "min" }); // the profile's own region and unit stand
  });

  it("species are stored by label: a missing reference, kept species or RSF entry is skipped and named", () => {
    handle.form = { ...defaultForm(), reference: "O", bgKeep: ["O"], rsf: {} };
    const out = adapter.apply({ ...sample, reference: "Ge", bgKeep: ["Si", "Ge", "Ar"], rsf: { B: "1.5", Zr: "3" } });
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) return;
    expect(out.skipped).toEqual([
      { field: "reference", reason: "column 'Ge' is not on this sheet" },
      { field: "bgKeep", reason: "column 'Ge' is not on this sheet" },
      { field: "bgKeep", reason: "column 'Ar' is not on this sheet" },
      { field: "rsf", reason: "column 'Zr' is not on this sheet" },
    ]);
    expect(out.applied).not.toContain("reference");
    expect(out.applied).not.toContain("bgKeep");
    expect(handle.form).toMatchObject({ reference: "O", bgKeep: ["Si"], rsf: { B: "1.5" } });
  });

  it("an Apply keeps what the form holds in place of a refused hidden value", () => {
    handle.form = { ...defaultForm(), sputterRate: "7" };
    adapter.apply({ ...sample, calOn: false, sputterRate: "-1" });
    expect(handle.form).toMatchObject({ calOn: false, sputterRate: "7" });
  });
});
