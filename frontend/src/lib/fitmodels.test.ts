// Saved custom fit models (GOTO #1): localStorage persistence — upsert by
// name, delete, malformed entries dropped on load (the analysis-template
// pattern).

import { beforeEach, describe, expect, it } from "vitest";

import {
  deleteCustomModel,
  isCustomFitModel,
  loadCustomModels,
  saveCustomModel,
  type CustomFitModel,
} from "./fitmodels";

const KEY = "qz.customFitModels";

function model(over: Partial<CustomFitModel> = {}): CustomFitModel {
  return {
    version: 1,
    name: "Decay",
    equation: "y = a*exp(-x/t) + c",
    params: ["a", "t", "c"],
    guesses: [2, 1.5, 0.5],
    lower: [0, 0, null],
    upper: [null, null, null],
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("fitmodels persistence", () => {
  it("loads [] when nothing is stored", () => {
    expect(loadCustomModels()).toEqual([]);
  });

  it("save + load roundtrips a model", () => {
    saveCustomModel(model());
    expect(loadCustomModels()).toEqual([model()]);
  });

  it("save upserts by name (no duplicates)", () => {
    saveCustomModel(model());
    const updated = model({ guesses: [3, 2, 1] });
    const list = saveCustomModel(updated);
    expect(list).toEqual([updated]);
    expect(loadCustomModels()).toEqual([updated]);
  });

  it("keeps other models when upserting one", () => {
    saveCustomModel(model());
    saveCustomModel(model({ name: "Growth", equation: "a*(1 - exp(-x/t))", params: ["a", "t"], guesses: [1, 1], lower: [null, null], upper: [null, null] }));
    expect(loadCustomModels().map((m) => m.name).sort()).toEqual(["Decay", "Growth"]);
  });

  it("delete removes by name and returns the remaining list", () => {
    saveCustomModel(model());
    const list = deleteCustomModel("Decay");
    expect(list).toEqual([]);
    expect(loadCustomModels()).toEqual([]);
  });

  it("drops malformed entries on load instead of crashing", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        model(),
        { version: 2, name: "bad-version" },
        { ...model({ name: "misaligned" }), guesses: [1] }, // guesses !== params length
        "not-an-object",
        null,
      ]),
    );
    expect(loadCustomModels()).toEqual([model()]);
  });

  it("tolerates non-JSON storage content", () => {
    localStorage.setItem(KEY, "{nope");
    expect(loadCustomModels()).toEqual([]);
  });
});

describe("isCustomFitModel", () => {
  it("accepts a well-formed model", () => {
    expect(isCustomFitModel(model())).toBe(true);
  });

  it("rejects blank name/equation, bad bounds, non-finite guesses", () => {
    expect(isCustomFitModel(model({ name: " " }))).toBe(false);
    expect(isCustomFitModel(model({ equation: "" }))).toBe(false);
    expect(isCustomFitModel(model({ lower: [0, 0] }))).toBe(false);
    expect(isCustomFitModel(model({ guesses: [Number.NaN, 1, 1] }))).toBe(false);
    expect(isCustomFitModel({ ...model(), upper: ["hi", null, null] })).toBe(false);
  });
});
