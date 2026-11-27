// Resample's preset adapter: the shared contract plus what is specific to it
// (a preset never stores a dataset id).

import { describe, expect, it } from "vitest";

import { describePresetAdapterContract } from "../../../lib/presetAdapterContract.testkit";
import { createResampleAdapter, settingsFromForm } from "./presetAdapter";
import { defaultForm, type ResampleForm } from "./resampleForm";

const state = { form: defaultForm("keep-me") as ResampleForm };
const adapter = createResampleAdapter({ getForm: () => state.form, replaceForm: (f) => { state.form = f; } });
const sample = {
  mode: "range", nPoints: "12", step: "0.5", start: "1", stop: "9", rangeStep: "-0.25",
  method: "pchip", outOfRange: "clip", sortUnsorted: true,
} as const;

describePresetAdapterContract({
  adapter,
  sample: { ...sample },
  wrongType: { field: "sortUnsorted", value: "yes" },
  outOfRange: { field: "rangeStep", value: "0" }, // a field the sample's mode (range) shows
});

describe("resample adapter specifics", () => {
  it("checks only the grid fields the mode shows; a hidden bad value is neither refused nor stored", () => {
    const base = adapter.defaults();
    expect(adapter.parse({ ...base, mode: "n_points", step: "-1", rangeStep: "0" })).not.toHaveProperty("error");
    expect(adapter.parse({ ...base, mode: "step", nPoints: "1", rangeStep: "0" })).not.toHaveProperty("error");
    expect(adapter.parse({ ...base, mode: "match", step: "-1", nPoints: "0" })).not.toHaveProperty("error");
    expect(adapter.parse({ ...base, mode: "step", nPoints: "abc" })).toMatchObject({ error: expect.stringContaining("'nPoints'") }); // still a number
    state.form = { ...defaultForm("keep-me"), mode: "n_points", nPoints: "300", step: "-4", rangeStep: "0" };
    expect(adapter.capture()).toMatchObject({ nPoints: "300", step: "", rangeStep: "" });
    expect(adapter.parse(adapter.capture())).not.toHaveProperty("error");
  });

  it("never stores a dataset id, and keeps the dataset chosen to match when applying", () => {
    expect(Object.keys(settingsFromForm(defaultForm("secret-id")))).not.toContain("matchId");
    expect(JSON.stringify(adapter.capture())).not.toContain("keep-me");
    adapter.apply({ ...sample, mode: "match" });
    expect(state.form.matchId).toBe("keep-me");
  });

  it("rejects each bad number with its field named", () => {
    const base = adapter.defaults();
    expect(adapter.parse({ ...base, mode: "step", step: "-1" })).toEqual({ error: "setting 'step' must be positive" });
    expect(adapter.parse({ ...base, mode: "range", rangeStep: "0" })).toEqual({ error: "setting 'rangeStep' must not be zero" });
    expect(adapter.parse({ ...base, start: "abc" })).toEqual({ error: "setting 'start' must be a number" });
    expect(adapter.parse({ ...base, mode: "n_points", nPoints: "1" })).toEqual({ error: "setting 'nPoints' must be a whole number of 2 or more" });
    expect(adapter.parse({ ...base, method: "cubic-ish" })).toMatchObject({ error: expect.stringContaining("'method'") });
  });
});
