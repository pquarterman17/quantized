// PRIMARY_SOFTWARE_AUDIT_PLAN — "Migration fixtures for supported
// contract/workspace versions". Exercises the FROZEN v1 fixture in
// `./__fixtures__/fitModels/` (see that directory's README for provenance)
// through the REAL public load path (`loadCustomModelsChecked`, reading the
// same `localStorage` key the app writes) rather than an inline record
// built fresh in the test file.

import { beforeEach, describe, expect, it } from "vitest";

import v1 from "./__fixtures__/fitModels/v1.json";
import { loadCustomModelsChecked, saveCustomModel } from "./fitmodels";

const KEY = "qz.customFitModels";

beforeEach(() => {
  localStorage.clear();
});

describe("fitmodels migration — frozen v1 fixture", () => {
  it("loads unchanged, with no warning (v1 records need no field migration)", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { models, warning } = loadCustomModelsChecked();
    expect(warning).toBeNull();
    expect(models).toEqual(v1);
  });

  it("name, equation, params, guesses, and bounds survive verbatim", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { models } = loadCustomModelsChecked();
    expect(models).toHaveLength(1);
    const [m] = models;
    expect(m.version).toBe(1);
    expect(m.name).toBe("Exponential decay");
    expect(m.equation).toBe("y = a*exp(-x/t) + c");
    expect(m.params).toEqual(["a", "t", "c"]);
    expect(m.guesses).toEqual([2, 1.5, 0.5]);
    expect(m.lower).toEqual([0, 0, null]);
    expect(m.upper).toEqual([null, null, null]);
    expect(m).not.toHaveProperty("description");
    expect(m).not.toHaveProperty("units");
  });

  it("re-saving (upsert) then reloading is stable — a v1 record with no description/units is rewritten as v1, not promoted", () => {
    localStorage.setItem(KEY, JSON.stringify(v1));
    const { models: firstLoad } = loadCustomModelsChecked();
    saveCustomModel(firstLoad[0]); // upsert-by-name round trip
    const { models: secondLoad, warning } = loadCustomModelsChecked();
    expect(warning).toBeNull();
    expect(secondLoad).toEqual(firstLoad);
    expect(secondLoad[0].version).toBe(1);
  });
});
