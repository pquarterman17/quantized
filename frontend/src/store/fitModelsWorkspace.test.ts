// P2.7 follow-up through the REAL store: opening / appending a project merges
// its saved fit models into the local library (lib/fitModelsProject.ts's
// rule), carries the ones this build cannot read, and a save of the store's
// state writes both back. The pure rule has its own cases in
// lib/fitModelsProject.test.ts; these pin the store wiring
// (store/workspaceHydration.ts's `adoptFitModels`).

import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildCustomFitModel, loadCustomModels } from "../lib/fitmodels";
import type { Dataset } from "../lib/types";
import { parseWorkspace, serializeWorkspace } from "../lib/workspace";
import { useToasts } from "./toasts";
import { useApp } from "./useApp";

const KEY = "qz.customFitModels";

const ds = (id: string): Dataset => ({
  id,
  name: id,
  data: { time: [0, 1], values: [[1], [2]], labels: ["y"], units: [""], metadata: {} },
});

const model = (name: string, equation: string) =>
  buildCustomFitModel({ name, equation, params: ["a"], guesses: [1], lower: [null], upper: [null] });

const FUTURE = { version: 9, name: "Future", equation: "y = a" };

/** A project file as another machine would have written it. */
function projectText(models: unknown[], id = "d1"): string {
  const doc = JSON.parse(serializeWorkspace({ datasets: [ds(id)], customFitModels: [] }));
  return JSON.stringify({ ...doc, customFitModels: models });
}

const names = () => loadCustomModels().map((m) => m.name);

beforeEach(() => {
  localStorage.clear();
  useToasts.setState({ toasts: [] });
  useApp.getState().clearAll();
});

describe("store load/append merge the project's fit models", () => {
  it("open: adds new models, suffixes a same-named different one, toasts once, carries the unreadable", async () => {
    const local = model("Arrhenius", "y = a*exp(-1/x)");
    localStorage.setItem(KEY, JSON.stringify([local]));
    const ws = parseWorkspace(projectText([model("Arrhenius", "y = a*exp(-2/x)"), model("Line", "y = a*x"), FUTURE]));

    useApp.getState().loadWorkspace(ws);
    // The carry is set synchronously with the rest of the load.
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE]);
    expect(useApp.getState().recipeSourcesComplete).toBe(false);

    await vi.waitFor(() => expect(names()).toEqual(["Arrhenius", "Arrhenius (from project)", "Line"]));
    expect(loadCustomModels()[0]).toEqual(local); // the local one is never overwritten
    const toasts = useToasts.getState().toasts.filter((t) => t.msg.includes("fit model"));
    expect(toasts).toHaveLength(1);
    expect(toasts[0].msg).toContain('"Arrhenius" as "Arrhenius (from project)"');

    // Saving the store's state writes the library and the carry back.
    const saved = JSON.parse(serializeWorkspace(useApp.getState())) as { customFitModels: { name: string }[] };
    expect(saved.customFitModels.map((m) => m.name)).toEqual([
      "Arrhenius",
      "Arrhenius (from project)",
      "Line",
      "Future",
    ]);
  });

  it("reopening a project whose models are all already here changes nothing and says nothing", async () => {
    localStorage.setItem(KEY, JSON.stringify([model("Line", "y = a*x")]));
    useApp.getState().loadWorkspace(parseWorkspace(projectText([model("Line", "y = a*x")])));
    // A second open queued behind the first proves the first adoption RAN
    // (same codec promise, FIFO) before its no-op is asserted.
    useApp.getState().loadWorkspace(parseWorkspace(projectText([model("Line", "y = a*x"), model("New", "y = a")])));
    await vi.waitFor(() => expect(names()).toEqual(["Line", "New"]));
    const toasts = useToasts.getState().toasts.filter((t) => t.msg.includes("fit model"));
    expect(toasts.map((t) => t.msg)).toEqual(['added 1 fit model from the project to your library: "New"']);
  });

  it("a load REPLACES the carry — the previous project's unreadable records do not leak", () => {
    useApp.getState().loadWorkspace(parseWorkspace(projectText([FUTURE])));
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE]);
    useApp.getState().loadWorkspace(parseWorkspace(projectText([])));
    expect(useApp.getState().fitModelCarry).toEqual([]);
    expect(useApp.getState().recipeSourcesComplete).toBe(true);
  });

  it("append: merges under the same rule and GROWS the carry in the same set() as its datasets", async () => {
    useApp.getState().loadWorkspace(parseWorkspace(projectText([FUTURE], "d1")));
    const other = { version: 7, name: "Other" };
    useApp.getState().appendWorkspace(parseWorkspace(projectText([model("Line", "y = a*x"), other], "d2")));
    // Synchronous: a crash (or a second open) before the async merge cannot lose it.
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE, other]);
    expect(useApp.getState().recipeSourcesComplete).toBe(false);
    await vi.waitFor(() => expect(names()).toEqual(["Line"]));
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE, other]);
  });

  it("an open replaced before its merge lands does not write into the NEW project's carry", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      // A's model cannot be stored, so A's merge WOULD carry it — but B was
      // opened in between, and B must not inherit A's record.
      useApp.getState().loadWorkspace(parseWorkspace(projectText([model("OnlyInA", "y = a")], "a1")));
      useApp.getState().loadWorkspace(parseWorkspace(projectText([], "b1")));
      await vi.waitFor(() =>
        expect(useToasts.getState().toasts.some((t) => t.msg.includes("could not be saved"))).toBe(true),
      );
      expect(useApp.getState().fitModelCarry).toEqual([]);
      // ...and the toast does not claim it was kept (PR #432 review).
      const msg = useToasts.getState().toasts.find((t) => t.msg.includes("could not be saved"))!.msg;
      expect(msg).not.toContain("kept in the project");
      expect(msg).toContain("replaced before it could be kept");
    } finally {
      spy.mockRestore();
    }
  });

  it("a model storage refuses is carried, so the next save still writes it into the project", async () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    try {
      const m = model("Kept", "y = a");
      useApp.getState().loadWorkspace(parseWorkspace(projectText([m])));
      await vi.waitFor(() => expect(useApp.getState().fitModelCarry).toEqual([m]));
      expect(useToasts.getState().toasts.some((t) => t.msg.includes("kept in the project"))).toBe(true);
      const saved = JSON.parse(serializeWorkspace(useApp.getState())) as { customFitModels: unknown[] };
      expect(saved.customFitModels).toEqual([m]);
    } finally {
      spy.mockRestore();
    }
  });

  it("remove all (clearAll, now in store/workspaceHydration.ts) empties the carry; undo brings it back", () => {
    useApp.getState().loadWorkspace(parseWorkspace(projectText([FUTURE])));
    useApp.getState().clearAll();
    expect(useApp.getState().fitModelCarry).toEqual([]);
    useApp.getState().undo();
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE]);
  });

  it("undo of an open restores the previous project's carry (it is project content)", () => {
    useApp.getState().loadWorkspace(parseWorkspace(projectText([FUTURE], "a1")));
    useApp.getState().recordHistory("open workspace");
    useApp.getState().loadWorkspace(parseWorkspace(projectText([{ version: 8, name: "B's" }], "b1")));
    useApp.getState().undo();
    expect(useApp.getState().fitModelCarry).toEqual([FUTURE]);
  });
});
