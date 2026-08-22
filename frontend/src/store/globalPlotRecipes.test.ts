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
