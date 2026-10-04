// P2.5 box 4 — saved analysis templates / transformation recipes ride the
// .dwk: a save embeds the local library, an open (through the REAL store's
// load/append) merges it into another machine's library by the fit-model
// rule, and a recipe survives the trip with its description, revision and
// expected input.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeStep } from "./pipeline";
import { deriveExpectations } from "./recipeExpect";
import { loadTemplates, saveTemplate, toTemplate, type AnalysisTemplate } from "./template";
import { definitionKey, mergeProjectTemplates, splitProjectTemplates } from "./templatesProject";
import type { Dataset } from "./types";
import { parseWorkspace, serializeWorkspace } from "./workspace";
import { useToasts } from "../store/toasts";
import { useApp } from "../store/useApp";

const ds: Dataset = {
  id: "d1",
  name: "d1.dat",
  data: { time: [0, 1], values: [[1, 2], [3, 4]], labels: ["T", "M"], units: ["K", "emu"], metadata: {} },
};

const STACK = makeStep("transform", "Stack d1.dat", 'qz.transform("stack")', { op: "stack", channels: [1] });
const recipe = (name: string, description = "stack M"): AnalysisTemplate =>
  toTemplate(name, [STACK], [], { description, revision: 2, expects: deriveExpectations([STACK], ds) });

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
  useApp.getState().clearAll();
});

describe("save → open round trip", () => {
  it("a save embeds the library; an open on another machine adds it back, whole", async () => {
    saveTemplate(recipe("Stack M"));
    const text = serializeWorkspace({ datasets: [ds] });
    expect(JSON.parse(text).analysisTemplates).toHaveLength(1);

    localStorage.clear(); // "another machine"
    const ws = parseWorkspace(text);
    expect(ws.projectTemplates?.map((t) => t.name)).toEqual(["Stack M"]);
    useApp.getState().loadWorkspace(ws);
    await vi.waitFor(() => expect(loadTemplates()).toHaveLength(1));
    const [t] = loadTemplates();
    expect(t).toMatchObject({ name: "Stack M", description: "stack M", revision: 2 });
    expect(t.expects).toEqual(recipe("x").expects);
    expect(t.steps.map((s) => [s.kind, s.params])).toEqual([["transform", STACK.params]]);
    expect(useToasts.getState().toasts.map((x) => x.msg)).toContain('added 1 saved template from the project: "Stack M"');
  });

  it("append merges too; appending the same project again adds nothing", async () => {
    saveTemplate(recipe("Stack M"));
    const text = serializeWorkspace({ datasets: [ds] });
    localStorage.clear();
    useApp.getState().appendWorkspace(parseWorkspace(text));
    await vi.waitFor(() => expect(loadTemplates().map((t) => t.name)).toEqual(["Stack M"]));
    // Again, plus one new recipe: its arrival proves this merge RAN, and
    // "Stack M" (the same definition) is still there once.
    const again = JSON.parse(text) as { analysisTemplates: unknown[] };
    again.analysisTemplates.push(JSON.parse(JSON.stringify(recipe("Other"))));
    useApp.getState().appendWorkspace(parseWorkspace(JSON.stringify(again)));
    await vi.waitFor(() => expect(loadTemplates().map((t) => t.name)).toEqual(["Stack M", "Other"]));
  });

  it("an open whose write storage refuses says so and does not claim it added the recipe", async () => {
    saveTemplate(recipe("Stack M"));
    const text = serializeWorkspace({ datasets: [ds] });
    localStorage.clear();
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation((key: string) => {
      if (key === "qz.analysisTemplates") throw new Error("QuotaExceededError");
    });
    try {
      useApp.getState().loadWorkspace(parseWorkspace(text));
      await vi.waitFor(() => expect(useToasts.getState().toasts.some((t) => t.msg.includes("could not be saved"))).toBe(true));
    } finally {
      set.mockRestore();
    }
    const msgs = useToasts.getState().toasts.map((t) => t.msg).join(" ");
    expect(msgs).toContain('"Stack M" could not be saved to your library');
    expect(msgs).not.toContain("added 1 saved template");
    expect(loadTemplates()).toEqual([]);
  });

  it("no templates → no key (a project without them is unchanged); the autosave never embeds them", () => {
    expect(JSON.parse(serializeWorkspace({ datasets: [ds] })).analysisTemplates).toBeUndefined();
    saveTemplate(recipe("Stack M"));
    expect(JSON.parse(serializeWorkspace({ datasets: [ds] }, { fitModelLibrary: false })).analysisTemplates).toBeUndefined();
  });
});

describe("the merge rule", () => {
  it("treats recursively reordered parameter keys as the same recipe definition", () => {
    const a = toTemplate("Stable", [makeStep("transform", "x", "", { op: "stack", options: { z: 2, a: 1 } })], []);
    const b = toTemplate("Stable", [makeStep("transform", "x", "", { options: { a: 1, z: 2 }, op: "stack" })], []);
    expect(definitionKey(a)).toBe(definitionKey(b));
    saveTemplate(a);
    expect(mergeProjectTemplates([b])).toEqual({ added: [], renamed: [], unstored: [] });
  });

  it("a same-named, different recipe is added as '(from project)'; the local one is kept", () => {
    saveTemplate(recipe("Stack M", "mine"));
    const r = mergeProjectTemplates([recipe("Stack M", "theirs"), recipe("Other")]);
    expect(r).toEqual({ added: ["Other"], renamed: [{ from: "Stack M", to: "Stack M (from project)" }], unstored: [] });
    expect(loadTemplates().map((t) => [t.name, t.description])).toEqual([
      ["Stack M", "mine"],
      ["Stack M (from project)", "theirs"],
      ["Other", "stack M"],
    ]);
    // Coming home: the renamed copy's base name matches and the definition is held.
    expect(mergeProjectTemplates([{ ...recipe("Stack M", "theirs"), name: "Stack M (from project)" }])).toEqual({ added: [], renamed: [], unstored: [] });
  });

  it("a different revision of the same definition is the same recipe", () => {
    saveTemplate(recipe("Stack M"));
    expect(mergeProjectTemplates([{ ...recipe("Stack M"), revision: 7 }])).toEqual({ added: [], renamed: [], unstored: [] });
  });

  it("an unreadable record is skipped with a migration warning, the readable ones kept", () => {
    const warnings: string[] = [];
    const got = splitProjectTemplates([{ version: 9, name: "future" }, JSON.parse(JSON.stringify(recipe("ok")))], warnings);
    expect(got.map((t) => t.name)).toEqual(["ok"]);
    expect(warnings).toEqual([expect.stringContaining("1 saved analysis template")]);
    expect(splitProjectTemplates(undefined, warnings)).toEqual([]);
  });

  // Finding #6: opening a project merges its templates into the local
  // library — that write must not silently drop a raw local record this
  // build cannot parse (a newer build's version, say).
  it("preserves a local record this build cannot parse when a project open rewrites the slot", () => {
    localStorage.setItem("qz.analysisTemplates", JSON.stringify([{ version: 99, name: "future-template" }]));
    const r = mergeProjectTemplates([recipe("Other")]);
    expect(r).toEqual({ added: ["Other"], renamed: [], unstored: [] });
    const raw = JSON.parse(localStorage.getItem("qz.analysisTemplates")!) as { name: string }[];
    expect(raw.map((x) => x.name)).toEqual(expect.arrayContaining(["future-template", "Other"]));
    // Unreadable, so it never shows up through the validated view either.
    expect(loadTemplates().map((t) => t.name)).toEqual(["Other"]);
  });

  // Finding #9: `expects.example` names the dataset the expectations were
  // READ FROM (display only) — it must not make two saves of the same
  // recipe look like different definitions.
  it("does not treat a different expects.example as a different definition", () => {
    saveTemplate(recipe("Stack M"));
    const sameDefinitionOtherExample: AnalysisTemplate = {
      ...recipe("Stack M"),
      expects: { ...recipe("Stack M").expects!, example: "some-other-dataset.dat" },
    };
    expect(mergeProjectTemplates([sameDefinitionOtherExample])).toEqual({ added: [], renamed: [], unstored: [] });
  });
});
