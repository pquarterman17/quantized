// P2.7 follow-up — saved fit models in the .dwk. One test per merge-rule case
// (lib/fitModelsProject.ts's header), the unreadable-record carry, the
// workspace round trip, and a legacy file with no field.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCustomFitModel,
  DAMAGED_BACKUP_KEY,
  loadCustomModels,
  loadCustomModelsChecked,
  unreadableFitModelsWarning,
  type CustomFitModel,
} from "./fitmodels";
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
    expect(mergeProjectFitModels([incoming])).toEqual({
      ...none,
      renamed: [{ from: "Arrhenius", to: "Arrhenius (from project)", reason: "local" }],
    });
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
      { from: "A (from project)", to: "A (from project 2)", reason: "local" },
    ]);
  });

  it("rule 3: a third distinct version takes the next free suffix", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A", "y = a")]));
    mergeProjectFitModels([model("A", "y = b*x")]);
    expect(mergeProjectFitModels([model("A", "y = c*x^2")]).renamed).toEqual([
      { from: "A", to: "A (from project 2)", reason: "local" },
    ]);
    expect(names()).toEqual(["A", "A (from project)", "A (from project 2)"]);
  });

  it("rule 3: a name held by an UNREADABLE local record counts as taken, and that record survives", () => {
    const future = { version: 9, name: "A", whatever: true };
    localStorage.setItem(KEY, JSON.stringify([future]));
    expect(mergeProjectFitModels([model("A")]).renamed).toEqual([{ from: "A", to: "A (from project)", reason: "unreadable" }]);
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
    const msg = adoptionMessage({ ...none, added: ["B"], renamed: [{ from: "A", to: "A (from project)", reason: "local" }] });
    expect(msg).toContain('"B"');
    expect(msg).toContain('"A" as "A (from project)"');
    expect(msg).toContain("yours was kept");
  });

  it("the message says WHY each rename happened — 'yours was kept' only when there was one of yours (PR #432 review)", () => {
    // Within the project: two different models share a name, nothing local.
    const within = mergeProjectFitModels([model("P", "y = a"), model("P", "y = b")]);
    expect(within.renamed).toEqual([{ from: "P", to: "P (from project)", reason: "project" }]);
    const withinMsg = adoptionMessage(within)!;
    expect(withinMsg).not.toContain("yours");
    expect(withinMsg).toContain("already taken by another model from this project");
    expect(withinMsg).toContain('"P" as "P (from project)"');

    // A name THIS open just gave another project model (a rename) is also
    // "another model from this project" — never "the project holds two".
    localStorage.setItem(KEY, JSON.stringify([model("Foo", "y = 3")]));
    const chained = mergeProjectFitModels([model("Foo", "y = 1"), model("Foo (from project)", "y = 2")]);
    expect(chained.renamed).toEqual([
      { from: "Foo", to: "Foo (from project)", reason: "local" },
      { from: "Foo (from project)", to: "Foo (from project 2)", reason: "project" },
    ]);
    expect(adoptionMessage(chained)).toContain('1 fit model\'s name was already taken by another model from this project; added as "Foo (from project)" as "Foo (from project 2)"');
    localStorage.clear();

    // An unreadable local record holds the name: it is not "yours was kept".
    localStorage.setItem(KEY, JSON.stringify([{ version: 9, name: "U" }]));
    const unreadable = adoptionMessage(mergeProjectFitModels([model("U")]))!;
    expect(unreadable).not.toContain("yours");
    expect(unreadable).toContain("cannot read (left untouched)");
    expect(unreadable).toContain('"U" as "U (from project)"');

    // A different readable local model: now it IS yours that was kept.
    localStorage.setItem(KEY, JSON.stringify([model("L", "y = a")]));
    expect(adoptionMessage(mergeProjectFitModels([model("L", "y = z")]))).toContain("yours was kept");
  });

  it("a DAMAGED local slot is left untouched by an open: nothing appended, nothing moved aside, and the toast says so", () => {
    // PR #432 review: an open used to move the damaged slot aside and
    // overwrite the library, silently.
    localStorage.setItem(KEY, "{not json");
    const incoming = model("A");
    const result = mergeProjectFitModels([incoming]);
    expect(result).toEqual({ ...none, unstored: [incoming], libraryDamaged: true });
    expect(localStorage.getItem(KEY)).toBe("{not json");
    expect(localStorage.getItem(DAMAGED_BACKUP_KEY)).toBeNull();
    const msg = adoptionMessage(result)!;
    expect(msg).toContain("your saved fit model list could not be read");
    expect(msg).toContain("left untouched");
    expect(msg).toContain("kept in the project");
    expect(msg).not.toContain("browser storage refused");
    // The workshop's own warning (and a later user save) still own the backup.
    expect(loadCustomModelsChecked().warning).toContain(DAMAGED_BACKUP_KEY);
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
    // One wording, shared with the local slot's own warning (lib/fitmodels.ts).
    expect(warnings[0]).toBe(unreadableFitModelsWarning([future, damaged], " in this project", "kept in the project file"));
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
    const split = splitProjectFitModels(JSON.parse(JSON.stringify(projectFitModelsForSave([]))), warnings);
    expect(split).toEqual({ models: [m], carry: [] });
    expect(warnings).toEqual([]);
    expect(projectFitModelsForSave(split.carry)).toEqual([m]);
  });

  it("a save drops a READABLE carried record the library already holds (base name + definition)", () => {
    const lib = model("A", "y = a");
    localStorage.setItem(KEY, JSON.stringify([lib]));
    const refusedEarlier = { ...model("A", "y = a"), guesses: [9, 9] }; // since stored; starts differ
    expect(projectFitModelsForSave([refusedEarlier])).toEqual([lib]);
  });

  it("a save writes ONE record per name: the library wins, a different carried model is renamed (PR #432 review)", () => {
    const lib = model("A", "y = a");
    localStorage.setItem(KEY, JSON.stringify([lib, model("A (from project)", "y = q")]));
    const differentModel = model("A", "y = b");
    const future = { version: 9, name: "A", extra: [1] };
    const saved = projectFitModelsForSave([differentModel, future]);
    // Renamed past the library's own "(from project)" to the first free name;
    // the unreadable record keeps every other field untouched.
    expect(saved).toEqual([
      lib,
      model("A (from project)", "y = q"),
      { ...differentModel, name: "A (from project 2)" },
      { ...future, name: "A (from project 3)" },
    ]);
    const writtenNames = saved.map((r) => (r as { name: string }).name);
    expect(new Set(writtenNames).size).toBe(writtenNames.length);
  });

  it("a save's rename never lands on a name a LATER carried record keeps — no swapped names (review)", () => {
    localStorage.setItem(KEY, JSON.stringify([model("X", "y = a")]));
    const first = { version: 9, name: "X", v: 1 };
    const second = { version: 9, name: "X (from project)", v: 2 };
    expect(projectFitModelsForSave([first, second])).toEqual([
      model("X", "y = a"),
      { ...first, name: "X (from project 2)" },
      second, // keeps its own name
    ]);
  });

  it("a save renames a collision WITHIN the carry too (two appended projects' records), but writes an exact duplicate once", () => {
    const a = { version: 9, name: "F", v: 1 };
    const b = { version: 9, name: "F", v: 2 };
    expect(projectFitModelsForSave([a, b, { ...a }])).toEqual([a, { ...b, name: "F (from project)" }]);
  });

  it("a save of a readable carried model the library holds under a SUFFIXED name writes it once", () => {
    localStorage.setItem(KEY, JSON.stringify([model("A (from project)", "y = a")]));
    expect(projectFitModelsForSave([model("A", "y = a")])).toEqual([model("A (from project)", "y = a")]);
  });

  it("a crash restore merges nothing and CARRIES what the autosave carried; a model the library holds again is dropped", () => {
    localStorage.setItem(KEY, JSON.stringify([model("Held", "y = a")]));
    const refused = model("Refused", "y = r");
    const future = { version: 9, name: "F" };
    // The autosave embeds the carry only (no library): see lib/autosave.ts.
    const text = serializeWorkspace({ datasets: [ds], fitModelCarry: [refused, future, model("Held", "y = a")] }, { fitModelLibrary: false });
    expect(JSON.parse(text).customFitModels).toEqual([refused, future, model("Held", "y = a")]);
    const restored = autosaveRestoreFitModels(parseWorkspace(text));
    expect(restored.projectFitModels).toEqual([]);
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
    expect(projectFitModelsForSave([future, { ...future }])).toEqual([model("L"), future]);
  });
});

describe(".dwk round trip", () => {
  it("a save embeds the local library; opening it yields the same models", () => {
    const a = model("Arrhenius", "y = A*exp(-E/x)", { description: "activation" });
    localStorage.setItem(KEY, JSON.stringify([a, model("Line")]));
    const text = serializeWorkspace({ datasets: [ds] });
    expect(JSON.parse(text).customFitModels).toEqual([a, model("Line")]);
    const loaded = parseWorkspace(text);
    expect(loaded.projectFitModels).toEqual([a, model("Line")]);
    expect(loaded.fitModelCarry).toEqual([]);
    expect(loaded.recipeSourcesComplete).toBe(true);
  });

  it("re-serializing a PARSED workspace writes the library + carry, never the file's own models (PR #432 review)", () => {
    // The old "present = exactly these" branch: a parsed file handed to
    // serializeWorkspace wrote ITS models, not the library's.
    const theirs = model("Theirs", "y = t");
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    const loaded = parseWorkspace(JSON.stringify({ ...doc, customFitModels: [theirs, { version: 9, name: "Future" }] }));
    localStorage.setItem(KEY, JSON.stringify([model("Mine", "y = m")]));
    expect(JSON.parse(serializeWorkspace(loaded)).customFitModels).toEqual([model("Mine", "y = m"), { version: 9, name: "Future" }]);
    localStorage.clear();
    expect(JSON.parse(serializeWorkspace(loaded)).customFitModels).toEqual([{ version: 9, name: "Future" }]);
  });

  it("an unreadable embedded model survives open + save (carried; the store derives completeness from the carry)", () => {
    const future = { version: 9, name: "Future", equation: "y = a" };
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    doc.customFitModels = [model("Ok"), future];
    const loaded = parseWorkspace(JSON.stringify(doc));
    expect(loaded.projectFitModels?.map((m) => m.name)).toEqual(["Ok"]);
    expect(loaded.fitModelCarry).toEqual([future]);
    // The LIST verdict: plot recipes / quick-plot templates were whole. The
    // carry makes the store's `recipeSourcesWhole` false (fitModelsWorkspace.test).
    expect(loaded.recipeSourcesComplete).toBe(true);
    expect(loaded.migrationWarnings.some((w) => w.includes('"Future"'))).toBe(true);
    // The store saves the LIBRARY plus the carry.
    localStorage.setItem(KEY, JSON.stringify([model("Ok")]));
    const resaved = JSON.parse(serializeWorkspace({ datasets: loaded.datasets, fitModelCarry: loaded.fitModelCarry }));
    expect(resaved.customFitModels).toEqual([model("Ok"), future]);
  });

  it("a legacy .dwk with no customFitModels key loads with none, whole, and no warning", () => {
    const doc = JSON.parse(serializeWorkspace({ datasets: [ds] }));
    expect("customFitModels" in doc).toBe(false); // nothing saved => key absent, byte-identical to before
    const loaded = parseWorkspace(JSON.stringify({ ...doc, version: 3 }));
    expect(loaded.projectFitModels).toEqual([]);
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
