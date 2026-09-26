// Saved custom fit models (GOTO #1): localStorage persistence — upsert by
// name, delete, malformed entries dropped on load (the analysis-template
// pattern).

import { beforeEach, describe, expect, it } from "vitest";

import {
  buildCustomFitModel,
  DAMAGED_BACKUP_KEY,
  deleteCustomModel,
  isCustomFitModel,
  loadCustomModels,
  loadCustomModelsChecked,
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

// ── v2: description + per-parameter units (audit P2.7 slice 3) ─────────────

describe("fitmodels v2 (description + units)", () => {
  const v2 = (over: Partial<CustomFitModel> = {}): CustomFitModel =>
    model({ version: 2, description: "decay with offset", units: ["V", "s", "V"], ...over });

  it("round-trips a v2 record", () => {
    saveCustomModel(v2());
    expect(loadCustomModels()).toEqual([v2()]);
  });

  it("loads an old v1 record unchanged, byte for byte", () => {
    const raw = JSON.stringify([model()]);
    localStorage.setItem(KEY, raw);
    expect(loadCustomModels()).toEqual([model()]);
    expect(loadCustomModelsChecked()).toEqual({ models: [model()], warning: null });
    expect(localStorage.getItem(KEY)).toBe(raw); // loading never rewrites
  });

  it("validates the v2 fields", () => {
    expect(isCustomFitModel(v2())).toBe(true);
    expect(isCustomFitModel(v2({ units: ["V", "s"] }))).toBe(false); // misaligned
    expect(isCustomFitModel({ ...v2(), units: ["V", 1, "V"] })).toBe(false);
    expect(isCustomFitModel({ ...v2(), description: 7 })).toBe(false);
    expect(isCustomFitModel({ ...model(), version: 3 })).toBe(false);
  });

  it("buildCustomFitModel writes the lowest version that holds the record", () => {
    const base = { name: "D", equation: "a*x", params: ["a"], guesses: [1], lower: [null], upper: [null] };
    expect(buildCustomFitModel({ ...base, description: "  ", units: [""] })).toEqual({ version: 1, ...base });
    expect(buildCustomFitModel({ ...base, units: [" s "] })).toEqual({ version: 2, ...base, units: ["s"] });
    expect(buildCustomFitModel({ ...base, description: " fast " })).toEqual({
      version: 2,
      ...base,
      description: "fast",
    });
  });
});

describe("fitmodels tolerant load (audit P2.7 slice 3)", () => {
  it("skips malformed records with ONE warning naming them", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([model(), { version: 9, name: "Future" }, { ...model({ name: "Bent" }), units: [1] }, 42]),
    );
    const { models, warning } = loadCustomModelsChecked();
    expect(models).toEqual([model()]);
    expect(warning).toBe(
      '3 saved fit models could not be read and were skipped: "Future", "Bent" (left in storage untouched)',
    );
  });

  it("never destroys an unreadable record on save or delete", () => {
    const future = { version: 9, name: "Future", equation: "a*x" };
    localStorage.setItem(KEY, JSON.stringify([model(), future]));
    saveCustomModel(model({ name: "Other" }));
    deleteCustomModel("Decay");
    // Even a save UNDER the unreadable record's name keeps it.
    saveCustomModel(model({ name: "Future" }));
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[];
    expect(raw).toContainEqual(future);
    expect(loadCustomModels().map((m) => m.name)).toEqual(["Other", "Future"]);
  });
});

describe("fitmodels damaged slot (review: never destroy on write)", () => {
  it("warns once and moves the damaged text aside before the first save", () => {
    localStorage.setItem(KEY, '[{"version":1,"name":"Lost"'); // truncated JSON
    expect(loadCustomModelsChecked()).toMatchObject({ models: [], warning: expect.stringMatching(/could not be read/) });
    saveCustomModel(model());
    expect(localStorage.getItem(DAMAGED_BACKUP_KEY)).toBe('[{"version":1,"name":"Lost"');
    expect(loadCustomModels()).toEqual([model()]);
  });

  it("never replaces an earlier backup; a second one gets a numbered key", () => {
    localStorage.setItem(DAMAGED_BACKUP_KEY, "first");
    localStorage.setItem(KEY, '{"not":"an array"}');
    deleteCustomModel("x");
    expect(localStorage.getItem(DAMAGED_BACKUP_KEY)).toBe("first");
    expect(localStorage.getItem(`${DAMAGED_BACKUP_KEY}.2`)).toBe('{"not":"an array"}');
    expect(localStorage.getItem(KEY)).toBe("[]");
  });
});
