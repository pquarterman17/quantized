// P2.7 follow-up — saved fit models in the .dwk. One test per merge-rule case
// (lib/fitModelsProject.ts's header), the unreadable-record carry, the
// workspace round trip, and a legacy file with no field.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCustomFitModel, loadCustomModels, type CustomFitModel } from "./fitmodels";
import {
  adoptionMessage,
  autosaveRestoreFitModels,
  mergeProjectFitModels,
  projectFitModelsForSave,
  splitProjectFitModels,
} from "./fitModelsProject";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import type { Dataset } from "./types";

const KEY = "qz.customFitModels";

function model(name: string, equation = "y = a*x + b", extra: { description?: string } = {}): CustomFitModel {
  return buildCustomFitModel({
    name,
    equation,
    params: ["a", "b"],
    guesses: [1, 0],
    lower: [null, null],
    upper: [null, null],
    ...extra,
  });
}

const stored = (): unknown[] => JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown[];
const names = (): string[] => loadCustomModels().map((m) => m.name);

const ds: Dataset = {
  id: "d1",
  name: "scan",
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
};

beforeEach(() => localStorage.clear());

describe("merge rule on open", () => {
  const none = { added: [], renamed: [], unstored: [] };

  it("rule 1: an identical record under the same name is a no-op (nothing written)", () => {
    const m = model("Linear");
    localStorage.setItem(KEY, JSON.stringify([m]));
    const before = localStorage.getItem(KEY);
    expect(mergeProjectFitModels([m])).toEqual(none);
    expect(localStorage.getItem(KEY)).toBe(before);
  });

  it("rule 1: the same model with different last-used starts/bounds is a no-op — the local starts win", () => {
    const local = buildCustomFitModel({ name: "L", equation: "y = a*x + b", params: ["a", "b"], guesses: [3, 4], lower: [0, null], upper: [null, null] });
    localStorage.setItem(KEY, JSON.stringify([local]));
    expect(mergeProjectFitModels([model("L")])).toEqual(none);
    expect(loadCustomModels()).toEqual([local]);
  });

  it("rule 1: version and blank units/description do not make a different model", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A")]));
    const v2 = { ...model("A"), version: 2 as const, description: "", units: ["", ""] };
    expect(mergeProjectFitModels([v2])).toEqual(none);
  });

  it("rule 2: a name free locally is added under its own name", () => {
    localStorage.setItem(KEY, JSON.stringify([model("Other")]));
    const incoming = model("Arrhenius", "y = A*exp(-E/x)");
    expect(mergeProjectFitModels([incoming])).toEqual({ ...none, added: ["Arrhenius"] });
    expect(loadCustomModels()).toEqual([model("Other"), incoming]);
  });

  it("rule 3: same name, different model keeps the local one and adds the project's under a suffix", () => {
    const local = model("Arrhenius", "y = A*exp(-E/x)");
    localStorage.setItem(KEY, JSON.stringify([local]));
    const incoming = model("Arrhenius", "y = A*exp(-E/(k*x))");
    expect(mergeProjectFitModels([incoming])).toEqual({ ...none, renamed: [["Arrhenius", "Arrhenius (from project)"]] });
    const lib = loadCustomModels();
    expect(lib[0]).toEqual(local); // never overwritten
    expect(lib[1]).toEqual({ ...incoming, name: "Arrhenius (from project)" });
  });

  it("rule 3: reopening the same project does not pile up copies", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A", "y = a")]));
    const incoming = model("A", "y = b*x");
    mergeProjectFitModels([incoming]);
    expect(mergeProjectFitModels([incoming])).toEqual(none);
    expect(names()).toEqual(["A", "A (from project)"]);
  });

  it("rule 1 looks past a GAP in the suffixes (a deleted '(from project)')", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A", "y = a"), model("A (from project 2)", "y = b*x")]));
    expect(mergeProjectFitModels([model("A", "y = b*x")])).toEqual(none);
  });

  it("a model that went A -> B -> A comes home instead of growing a second suffix", () => {
    // Machine B saved our "A" as "A (from project)"; it is our own model.
    localStorage.setItem(KEY, JSON.stringify([model("A", "y = a")]));
    expect(mergeProjectFitModels([model("A (from project)", "y = a")])).toEqual(none);
    // And a different one under that name is suffixed from the BASE name.
    expect(mergeProjectFitModels([model("A (from project)", "y = z")]).renamed).toEqual([]);
    expect(names()).toEqual(["A", "A (from project)"]);
    expect(mergeProjectFitModels([model("A (from project)", "y = w")]).renamed).toEqual([
      ["A (from project)", "A (from project 2)"],
    ]);
  });

  it("rule 3: a third distinct version takes the next free suffix", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A", "y = a")]));
    mergeProjectFitModels([model("A", "y = b*x")]);
    expect(mergeProjectFitModels([model("A", "y = c*x^2")]).renamed).toEqual([["A", "A (from project 2)"]]);
    expect(names()).toEqual(["A", "A (from project)", "A (from project 2)"]);
  });

  it("rule 3: a name held by an UNREADABLE local record counts as taken, and that record survives", () => {
    const future = { version: 9, name: "A", whatever: true };
    localStorage.setItem(KEY, JSON.stringify([future]));
    expect(mergeProjectFitModels([model("A")]).renamed).toEqual([["A", "A (from project)"]]);
    expect(stored()[0]).toEqual(future);
    expect(names()).toEqual(["A (from project)"]);
  });

  it("a description difference is a different model", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A")]));
    expect(mergeProjectFitModels([model("A", "y = a*x + b", { description: "line" })]).renamed).toHaveLength(1);
  });

  it("everything is ONE storage write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem");
    mergeProjectFitModels([model("A"), model("B"), model("C")]);
    expect(spy.mock.calls.filter(([k]) => k === KEY)).toHaveLength(1);
    spy.mockRestore();
  });

  it("a write storage refuses is reported UNSTORED, not added", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const incoming = model("A");
    expect(mergeProjectFitModels([incoming])).toEqual({ ...none, unstored: [incoming] });
    spy.mockRestore();
    expect(adoptionMessage({ ...none, unstored: [incoming] })).toContain("could not be saved");
  });

  it("the message names what happened, once, and is null for an ordinary reopen", () => {
    expect(adoptionMessage(none)).toBeNull();
    const msg = adoptionMessage({ ...none, added: ["B"], renamed: [["A", "A (from project)"]] });
    expect(msg).toContain('"B"');
    expect(msg).toContain('"A" as "A (from project)"');
    expect(msg).toContain("kept");
  });
});


describe("unreadable records in the file", () => {
  it("are skipped with ONE warning naming them, and carried untouched", () => {
    const future = { version: 9, name: "Future", equation: "y = a" };
    const damaged = { version: 1, name: "Broken", equation: "y = a", params: ["a"], guesses: [] };
    const warnings: string[] = [];
    const { models, carry } = splitProjectFitModels([model("Ok"), future, damaged], warnings);
    expect(models.map((m) => m.name)).toEqual(["Ok"]);
    expect(carry).toEqual([future, damaged]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"Future", "Broken"');
    expect(warnings[0]).toContain("kept in the project file");
  });

  it("the project boundary accepts what the local slot accepts — extra keys stripped", () => {
    // PR #432 review: a record the local library holds (an older workshop
    // saved min > max, or a blank start outside its bounds) must not come back
    // from its own project as "could not be read".
    const infeasible = { version: 1, name: "X", equation: "y = a", params: ["a"], guesses: [5], lower: [10], upper: [0] };
    const extra = { ...model("Ok"), evil: { payload: 1 } };
    const warnings: string[] = [];
    const { models, carry } = splitProjectFitModels([infeasible, extra], warnings);
    expect(carry).toEqual([]);
    expect(warnings).toEqual([]);
    expect(models).toEqual([infeasible, model("Ok")]);
    expect("evil" in models[1]).toBe(false);
  });

  it("an own model the library holds round-trips through its project as a model: no warning, no duplicate", () => {
    // The #432 probe, P1: blank start -> 1 with min 5, saved to the library.
    const m = buildCustomFitModel({ name: "Decay", equation: "y = a*exp(-x/t)", params: ["a", "t"], guesses: [1, 1], lower: [null, 5], upper: [null, null] });
    localStorage.setItem(KEY, JSON.stringify([m]));
    const warnings: string[] = [];
    const split = splitProjectFitModels(JSON.parse(JSON.stringify(projectFitModelsForSave(undefined, []))), warnings);
    expect(split).toEqual({ models: [m], carry: [] });
    expect(warnings).toEqual([]);
    expect(projectFitModelsForSave(undefined, split.carry)).toEqual([m]);
  });

  it("a save drops a READABLE carried record the library already holds (base name + definition)", () => {
    const lib = model("A", "y = a");
    localStorage.setItem(KEY, JSON.stringify([lib]));
    const refusedEarlier = { ...model("A", "y = a"), guesses: [9, 9] }; // since stored; starts differ
    const differentModel = model("A", "y = b");
    const future = { version: 9, name: "A" };
    expect(projectFitModelsForSave(undefined, [refusedEarlier, differentModel, future])).toEqual([lib, differentModel, future]);
  });

  it("a crash restore drops the models the library holds and CARRIES the rest (a refused one survives)", () => {
    localStorage.setItem(KEY, JSON.stringify([model("Held", "y = a")]));
    const refused = model("Refused", "y = r");
    const future = { version: 9, name: "F" };
    // The #432 probe, P2: autosave writes library + carry; restore splits them.
    const text = serializeWorkspace({ datasets: [ds], fitModelCarry: [refused, future] });
    const restored = autosaveRestoreFitModels(parseWorkspace(text));
    expect(restored.customFitModels).toEqual([]);
    expect(restored.fitModelCarry).toEqual([future, refused]);
  });

  it("a field that is not an array is carried as one record, not dropped", () => {
    const warnings: string[] = [];
    expect(splitProjectFitModels({ oops: 1 }, warnings)).toEqual({ models: [], carry: [{ oops: 1 }] });
    expect(warnings).toHaveLength(1);
  });

  it("an absent field is an empty, whole source with no warning", () => {
    const warnings: string[] = [];
    expect(splitProjectFitModels(undefined, warnings)).toEqual({ models: [], carry: [] });
    expect(warnings).toEqual([]);
  });

  it("the carry is written back after the library, exact duplicates once", () => {
    localStorage.setItem(KEY, JSON.stringify([model("L")]));
    const future = { version: 9, name: "F" };
    expect(projectFitModelsForSave(undefined, [future, { ...future }])).toEqual([model("L"), future]);
  });
});

describe(".dwk round trip", () => {
  it("a save embeds the local library; opening it yields the same models", () => {
    const a = model("Arrhenius", "y = A*exp(-E/x)", { description: "activation" });
    localStorage.setItem(KEY, JSON.stringify([a, model("Line")]));
    const text = serializeWorkspace({ datasets: [ds] });
    expect(JSON.parse(text).customFitModels).toEqual([a, model("Line")]);
    const loaded = parseWorkspace(text);
    expect(loaded.customFitModels).toEqual([a, model("Line")]);
    expect(loaded.fitModelCarry).toEqual([]);
    expect(loaded.recipeSourcesComplete).toBe(true);
    // A parsed project re-serialized carries ITS models, not the local library.
    localStorage.clear();
    expect(JSON.parse(serializeWorkspace(loaded)).customFitModels).toEqual([a, model("Line")]);
  });

  it("an unreadable embedded model survives open + save and clears recipeSourcesComplete", () => {
    const future = { version: 9, name: "Future", equation: "y = a" };
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    doc.customFitModels = [model("Ok"), future];
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.customFitModels?.map((m) => m.name)).toEqual(["Ok"]);
    expect(loaded.fitModelCarry).toEqual([future]);
    expect(loaded.recipeSourcesComplete).toBe(false);
    expect(loaded.migrationWarnings.some((w) => w.includes('"Future"'))).toBe(true);
    // The store saves with the LIBRARY (no customFitModels) plus the carry.
    localStorage.setItem(KEY, JSON.stringify([model("Ok")]));
    const resaved = JSON.parse(serializeWorkspace({ datasets: loaded.datasets, fitModelCarry: loaded.fitModelCarry }));
    expect(resaved.customFitModels).toEqual([model("Ok"), future]);
  });

  it("a legacy .dwk with no customFitModels key loads with none, whole, and no warning", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    expect("customFitModels" in doc).toBe(false); // nothing saved => key absent, byte-identical to before
    const loaded = parseWorkspace(JSON.stringify({ ...doc, version: 3 }));
    expect(loaded.customFitModels).toEqual([]);
    expect(loaded.fitModelCarry).toEqual([]);
    expect(loaded.recipeSourcesComplete).toBe(true);
    expect(loaded.migrationWarnings).toEqual([]);
  });

  it("the parser ignores top-level keys it does not know — why a new file opens in an older build", () => {
    // The previous build's parseWorkspace is this one minus the
    // customFitModels read: it picks fields by name, so the extra key is
    // inert there exactly as this unknown one is here. No version bump.
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    const loaded = parseWorkspace(JSON.stringify({ ...doc, someFutureField: [{ x: 1 }] }));
    expect(loaded.datasets.map((d) => d.id)).toEqual(["d1"]);
    expect(loaded.migrationWarnings).toEqual([]);
  });
});
