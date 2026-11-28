// The preset adapters of the SIMS workshop's Compare, Align and Region tabs: the
// shared contract plus what is specific to each (every option the tab offers is
// accepted, species by label, the hidden-field rule, nothing that names data).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createSimsAlignAdapter, type SimsAlignHandle, type SimsAlignPreset } from "./simsAlignPresetAdapter";
import { createSimsCompareAdapter, type SimsCompareHandle, type SimsComparePreset } from "./simsComparePresetAdapter";
import { createSimsRegionAdapter, type SimsRegionHandle, type SimsRegionPreset } from "./simsRegionPresetAdapter";
import { SIMS_ALIGN_BY_OPTIONS, SIMS_THRESHOLD_MODE_OPTIONS } from "./simsOptions";

const SPECIES = ["Si", "O", "B", "P"];

const compare = {
  speciesOptions: SPECIES.map((name) => ({ name, count: 2 })), species: ["Si", "O", "B", "P"], stagger: "0",
  setSpecies(names: string[]) { compare.species = SPECIES.filter((s) => names.includes(s)); },
  setStagger(v: string) { compare.stagger = v; },
} satisfies SimsCompareHandle;
const compareSample: SimsComparePreset = { species: ["Si", "B"], stagger: "3" };

describePresetAdapterContract({
  adapter: createSimsCompareAdapter(compare),
  sample: compareSample,
  wrongType: { field: "stagger", value: 2 },
  outOfRange: { field: "stagger", value: "9" },
});

describe("SIMS compare adapter specifics", () => {
  const adapter = createSimsCompareAdapter(compare);
  it("rejects each bad value with its field named", () => {
    expect(adapter.parse({ ...compareSample, species: [] })).toMatchObject({ error: expect.stringContaining("'species'") });
    expect(adapter.parse({ ...compareSample, species: ["Si", "Si"] })).toMatchObject({ error: expect.stringContaining("'species'") });
    expect(adapter.parse({ ...compareSample, stagger: "1.5" })).toMatchObject({ error: expect.stringContaining("'stagger'") });
    expect(adapter.parse({ ...compareSample, stagger: "" })).not.toHaveProperty("error");
    expect(adapter.parse({ ...compareSample, profiles: ["s1"] })).toMatchObject({ error: expect.stringContaining("'profiles'") });
  });
  it("a species no picked profile has is skipped and named; with none left the choice is untouched", () => {
    compare.species = ["Si"];
    expect(adapter.apply({ species: ["Si", "Ge"], stagger: "1" })).toMatchObject({ ok: true, skipped: [{ field: "species", reason: "species 'Ge' is in none of the picked profiles" }] });
    expect(compare.species).toEqual(["Si"]);
    compare.species = ["O"];
    const out = adapter.apply({ species: ["Ge"], stagger: "1" });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "species" }] });
    expect(compare.species).toEqual(["O"]);
    if (out.ok) expect(out.applied).toEqual(["stagger"]);
  });
});

const align = {
  by: "peak" as SimsAlignPreset["by"], reference: "Si", commonSpecies: SPECIES, thresholdPct: "50", extra: [] as string[],
  setBy(v: SimsAlignPreset["by"]) { align.by = v; },
  setReference(v: string) { align.reference = v; },
  setThresholdPct(v: string) { align.thresholdPct = v; },
  setExtra(v: string[]) { align.extra = v; },
} satisfies SimsAlignHandle;
const alignAdapter = createSimsAlignAdapter(align);
const alignSample: SimsAlignPreset = { by: "junction", reference: "B", thresholdPct: "30", extra: ["Si", "P"] };

describePresetAdapterContract({
  adapter: alignAdapter,
  sample: alignSample,
  wrongType: { field: "extra", value: "Si" },
  outOfRange: { field: "thresholdPct", value: "100" },
  missingColumn: { settings: { ...alignSample, reference: "Ge" }, field: "reference", labels: SPECIES, required: false },
});

describe("SIMS align adapter specifics", () => {
  it("every alignment the tab offers is accepted", () => {
    for (const o of SIMS_ALIGN_BY_OPTIONS) expect(alignAdapter.parse({ ...alignSample, by: o.value }), o.value).not.toHaveProperty("error");
    expect(alignAdapter.parse({ ...alignSample, by: "centre" })).toMatchObject({ error: expect.stringContaining("'by'") });
  });
  it("the junction threshold is hidden while aligning on the peak: not checked, not stored, never written", () => {
    expect(alignAdapter.parse({ ...alignSample, by: "peak", thresholdPct: "150" })).not.toHaveProperty("error");
    expect(alignAdapter.parse({ ...alignSample, by: "peak", thresholdPct: 150 })).toMatchObject({ error: expect.stringContaining("'thresholdPct'") }); // wrong KIND
    Object.assign(align, { by: "peak", thresholdPct: "-9", extra: [] });
    expect(alignAdapter.capture().thresholdPct).toBe("50");
    align.thresholdPct = "40";
    alignAdapter.apply({ ...alignSample, by: "peak", thresholdPct: "150" });
    expect(align.thresholdPct).toBe("40");
  });
  it("a missing reference or extra species is skipped and named", () => {
    Object.assign(align, { by: "peak", reference: "Si", extra: [] });
    const out = alignAdapter.apply({ ...alignSample, reference: "Ge", extra: ["O", "Ge"] });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "reference", reason: "column 'Ge' is not on this sheet" }, { field: "extra", reason: "species 'Ge' is not in every picked profile" }] });
    expect(align.reference).toBe("Si");
    expect(align.extra).toEqual(["O"]);
  });
});

const region = {
  labels: SPECIES,
  form: { lo: "3", hi: "99", species: ["Si", "O", "B", "P"], mode: "fraction", threshold: "50" } as SimsRegionHandle["form"],
  setForm(patch: Partial<SimsRegionHandle["form"]>) { region.form = { ...region.form, ...patch }; },
};
const regionAdapter = createSimsRegionAdapter(region as SimsRegionHandle);
const regionSample: SimsRegionPreset = { species: ["Si", "P"], mode: "absolute", threshold: "2.5e18" };

describePresetAdapterContract({
  adapter: regionAdapter,
  sample: regionSample,
  wrongType: { field: "species", value: "Si" },
  outOfRange: { field: "mode", value: "median" },
});

describe("SIMS region adapter specifics", () => {
  it("every threshold mode the tab offers is accepted, each with its own range", () => {
    for (const o of SIMS_THRESHOLD_MODE_OPTIONS) expect(regionAdapter.parse({ ...regionSample, mode: o.value, threshold: "40" }), o.value).not.toHaveProperty("error");
    expect(regionAdapter.parse({ ...regionSample, mode: "fraction", threshold: "100" })).toMatchObject({ error: expect.stringContaining("'threshold'") });
    expect(regionAdapter.parse({ ...regionSample, mode: "absolute", threshold: "" })).toMatchObject({ error: expect.stringContaining("'threshold'") });
  });
  it("the depth region and the profile are not part of a preset, and Apply leaves the region alone", () => {
    expect(Object.keys(regionAdapter.capture()).sort()).toEqual(["mode", "species", "threshold"]);
    expect(regionAdapter.parse({ ...regionSample, lo: "0", hi: "9" })).toMatchObject({ error: expect.stringContaining("'lo'") });
    regionAdapter.apply(regionSample);
    expect(region.form).toMatchObject({ lo: "3", hi: "99" });
  });
  it("a species this profile lacks is skipped and named", () => {
    region.form.species = ["O"];
    const out = regionAdapter.apply({ ...regionSample, species: ["Si", "Ge"] });
    expect(out).toMatchObject({ ok: true, skipped: [{ field: "species", reason: "species 'Ge' is not in this profile" }] });
    expect(region.form.species).toEqual(["Si"]);
  });
});
