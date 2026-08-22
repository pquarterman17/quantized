// P1.3 wave 3, Lane D: the global-scope Plot Recipe cache. Uses a real
// localStorage-backed round trip (jsdom provides one) rather than mocking
// lib/plotRecipeStorage.ts -- the same "exercise the real store" convention
// store/plotRecipes.test.ts uses for the project-scope slice.

import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, type PlotRecipe } from "../lib/plotRecipe";
import { defaultPlotView } from "../lib/plotview";
import type { Dataset } from "../lib/types";
import { useGlobalPlotRecipes } from "./globalPlotRecipes";

function dataset(): Dataset {
  return {
    id: "d1",
    name: "d1.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function recipe(id: string, name: string): PlotRecipe {
  const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
  return captureRecipe(dataset(), view, null, { id, name, appVersion: "0" });
}

beforeEach(() => {
  localStorage.clear();
  useGlobalPlotRecipes.setState({ recipes: [], hydrated: false });
});

describe("hydrate", () => {
  it("loads from localStorage exactly once", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify([recipe("r1", "Saved")]));
    useGlobalPlotRecipes.getState().hydrate();
    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(1);
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Saved");

    // A second hydrate call must NOT clobber an in-session edit with the
    // stale disk read.
    useGlobalPlotRecipes.getState().rename("r1", "Renamed");
    useGlobalPlotRecipes.getState().hydrate();
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Renamed");
  });

  it("degrades to an empty list when storage is empty", () => {
    useGlobalPlotRecipes.getState().hydrate();
    expect(useGlobalPlotRecipes.getState().recipes).toEqual([]);
  });
});

describe("setAll", () => {
  it("persists to localStorage AND updates in-memory state", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "One")]);
    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(1);
    const raw = localStorage.getItem("qz.plotRecipes");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toHaveLength(1);
  });
});

describe("rename", () => {
  it("renames and persists", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "Original")]);
    useGlobalPlotRecipes.getState().rename("r1", "Renamed");
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Renamed");
    expect(JSON.parse(localStorage.getItem("qz.plotRecipes")!)[0].name).toBe("Renamed");
  });

  it("is a no-op for an unknown id or a blank name", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "Original")]);
    useGlobalPlotRecipes.getState().rename("nope", "X");
    useGlobalPlotRecipes.getState().rename("r1", "   ");
    expect(useGlobalPlotRecipes.getState().recipes[0].name).toBe("Original");
  });

  it("dedupes rather than colliding with an existing global name", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "Original"), recipe("r2", "Taken")]);
    useGlobalPlotRecipes.getState().rename("r1", "Taken");
    const names = useGlobalPlotRecipes.getState().recipes.map((r) => r.name);
    expect(names).toEqual(["Taken (2)", "Taken"]);
  });
});

describe("duplicate", () => {
  it("duplicates under a deduped '<name> copy' name and persists", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "Original")]);
    const newId = useGlobalPlotRecipes.getState().duplicate("r1");
    expect(newId).not.toBeNull();
    expect(newId).not.toBe("r1");
    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.name)).toEqual(["Original", "Original copy"]);
    expect(JSON.parse(localStorage.getItem("qz.plotRecipes")!)).toHaveLength(2);
  });

  it("is a no-op (null) for an unknown id", () => {
    expect(useGlobalPlotRecipes.getState().duplicate("nope")).toBeNull();
  });
});

describe("remove", () => {
  it("removes and persists", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "One"), recipe("r2", "Two")]);
    useGlobalPlotRecipes.getState().remove("r1");
    expect(useGlobalPlotRecipes.getState().recipes.map((r) => r.id)).toEqual(["r2"]);
    expect(JSON.parse(localStorage.getItem("qz.plotRecipes")!)).toHaveLength(1);
  });

  it("is a no-op for an unknown id", () => {
    useGlobalPlotRecipes.getState().setAll([recipe("r1", "One")]);
    useGlobalPlotRecipes.getState().remove("nope");
    expect(useGlobalPlotRecipes.getState().recipes).toHaveLength(1);
  });
});

// ORCHESTRATOR RULING B (code-review findings 2+3): copy-with-a-fresh-id is
// the cross-scope transfer primitive (replacing "move", which both lost data
// on undo and could leave two scopes holding the SAME id). `copyIn` accepts
// an EXTERNAL recipe (e.g. from the project scope) and adds it here under a
// fresh id + a name deduped against this scope's OWN list -- the source is
// never touched by this store.
describe("copyIn", () => {
  it("adds the recipe under a FRESH id, deduped name, and persists", () => {
    const external = recipe("external-id", "Original");
    useGlobalPlotRecipes.getState().setAll([recipe("g1", "Original")]); // force a name collision

    const newId = useGlobalPlotRecipes.getState().copyIn(external);

    expect(newId).not.toBe("external-id"); // fresh id, never the source's own
    const names = useGlobalPlotRecipes.getState().recipes.map((r) => r.name);
    expect(names).toEqual(["Original", "Original (2)"]);
    const ids = useGlobalPlotRecipes.getState().recipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(2); // never two rows sharing one id
    expect(JSON.parse(localStorage.getItem("qz.plotRecipes")!)).toHaveLength(2);
  });
});

// FINDING 5 (code-review): every mutating action must hydrate from
// localStorage FIRST, before computing the list it persists -- otherwise a
// mutation that runs before App.tsx's boot hydrate() lands (or before any
// caller has ever hydrated this session) reads the in-memory `[]` default,
// and persisting a list built from THAT clobbers whatever was already on
// disk down to just the one new entry.
describe("finding 5 — hydrate-before-mutate guard", () => {
  it("copyIn before any hydrate() call does not clobber previously-persisted entries", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify([recipe("r1", "Existing")]));
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: false }); // a fresh, never-hydrated store

    useGlobalPlotRecipes.getState().copyIn(recipe("r2", "New"));

    const persisted = JSON.parse(localStorage.getItem("qz.plotRecipes")!) as PlotRecipe[];
    expect(persisted.map((r) => r.id)).toContain("r1"); // survived
    expect(persisted).toHaveLength(2);
  });

  it("rename before any hydrate() call does not clobber previously-persisted entries", () => {
    localStorage.setItem(
      "qz.plotRecipes",
      JSON.stringify([recipe("r1", "Existing"), recipe("r2", "Other")]),
    );
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: false });

    useGlobalPlotRecipes.getState().rename("r1", "Renamed");

    const persisted = JSON.parse(localStorage.getItem("qz.plotRecipes")!) as PlotRecipe[];
    expect(persisted).toHaveLength(2);
    expect(persisted.find((r) => r.id === "r1")?.name).toBe("Renamed");
  });

  it("remove before any hydrate() call does not clobber previously-persisted entries", () => {
    localStorage.setItem(
      "qz.plotRecipes",
      JSON.stringify([recipe("r1", "Existing"), recipe("r2", "Other")]),
    );
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: false });

    useGlobalPlotRecipes.getState().remove("r2");

    const persisted = JSON.parse(localStorage.getItem("qz.plotRecipes")!) as PlotRecipe[];
    expect(persisted.map((r) => r.id)).toEqual(["r1"]);
  });

  it("duplicate before any hydrate() call does not clobber previously-persisted entries", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify([recipe("r1", "Existing")]));
    useGlobalPlotRecipes.setState({ recipes: [], hydrated: false });

    useGlobalPlotRecipes.getState().duplicate("r1");

    const persisted = JSON.parse(localStorage.getItem("qz.plotRecipes")!) as PlotRecipe[];
    expect(persisted.map((r) => r.id)).toContain("r1");
    expect(persisted).toHaveLength(2);
  });
});
