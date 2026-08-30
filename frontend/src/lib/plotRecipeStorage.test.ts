// P1.3 wave 2, Lane C: global-scope recipe persistence (localStorage) +
// standalone recipe file import/export.

import { beforeEach, describe, expect, it } from "vitest";

import { captureRecipe, serializeRecipe, type PlotRecipe } from "./plotRecipe";
import {
  exportRecipeFile,
  importRecipeFile,
  loadGlobalPlotRecipes,
  saveGlobalPlotRecipes,
} from "./plotRecipeStorage";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

function xrdDataset(): Dataset {
  return {
    id: "d1",
    name: "xrd-scan.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function view(overrides: Partial<PlotView> = {}): PlotView {
  return { ...defaultPlotView(), ...overrides };
}

function recipe(id = "r1"): PlotRecipe {
  return captureRecipe(xrdDataset(), view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } }), null, {
    id,
    name: "XRD standard",
    appVersion: "0",
    now: () => "2026-08-22T00:00:00.000Z",
  });
}

describe("loadGlobalPlotRecipes / saveGlobalPlotRecipes", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a saved list", () => {
    expect(loadGlobalPlotRecipes()).toEqual([]);
    saveGlobalPlotRecipes([recipe("r1"), recipe("r2")]);
    expect(loadGlobalPlotRecipes()).toEqual([recipe("r1"), recipe("r2")]);
  });

  it("tolerates missing storage — empty list, never throws", () => {
    expect(loadGlobalPlotRecipes()).toEqual([]);
  });

  it("tolerates corrupt JSON in storage — empty list, never throws", () => {
    localStorage.setItem("qz.plotRecipes", "not json {{{");
    expect(loadGlobalPlotRecipes()).toEqual([]);
  });

  it("tolerates a non-array payload — empty list, never throws", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify({ not: "a list" }));
    expect(loadGlobalPlotRecipes()).toEqual([]);
  });

  it("drops a malformed entry within an otherwise well-formed list", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify([recipe("r1"), { garbage: true }]));
    expect(loadGlobalPlotRecipes()).toEqual([recipe("r1")]);
  });

  it("saveGlobalPlotRecipes stores under the qz.plotRecipes key", () => {
    saveGlobalPlotRecipes([recipe("r1")]);
    const raw = localStorage.getItem("qz.plotRecipes");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual([recipe("r1")]);
  });

  it("saveGlobalPlotRecipes never throws when storage is unavailable", () => {
    let rejected = 0;
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        setItem: (): never => {
          rejected += 1;
          throw new Error("quota exceeded");
        },
      },
    });
    try {
      expect(saveGlobalPlotRecipes([recipe("r1")])).toBe(false);
      expect(rejected, "the unavailable-storage path must actually run").toBe(1);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});

describe("exportRecipeFile / importRecipeFile", () => {
  it("exportRecipeFile matches plotRecipe.ts's own serializer", () => {
    expect(exportRecipeFile(recipe())).toBe(serializeRecipe(recipe()));
  });

  it("importRecipeFile round-trips every field except id", () => {
    const r = recipe("original-id");
    const imported = importRecipeFile(exportRecipeFile(r));
    expect(imported).toEqual({ ...r, id: imported.id });
  });

  it("importRecipeFile mints a fresh id, never the file's own", () => {
    const r = recipe("original-id");
    const imported = importRecipeFile(exportRecipeFile(r));
    expect(imported.id).not.toBe("original-id");
  });

  it("importRecipeFile mints distinct ids across repeated imports of the same file", () => {
    const r = recipe("original-id");
    const text = exportRecipeFile(r);
    const a = importRecipeFile(text);
    const b = importRecipeFile(text);
    expect(a.id).not.toBe(b.id);
  });

  it("importRecipeFile throws a clear message on invalid JSON, like parseRecipe", () => {
    expect(() => importRecipeFile("{not json")).toThrow(/bad JSON/);
  });
});
