// P3.5 slice 4 — the shape-sniffer the library-level import button uses to
// route a picked file without asking the user what it is. Every positive
// case below runs through the SYSTEM'S OWN serializer, not a hand-typed
// fixture, so a drift in what a real export looks like breaks this test
// before it breaks the import path.
import { beforeEach, describe, expect, it } from "vitest";

import { makeStep } from "./pipeline";
import { exportNameKeyed } from "./nameKeyedRecipes";
import { saveCustomModel } from "./fitmodels";
import { saveGraphTemplate } from "./figuredoc";
import { captureRecipe } from "./plotRecipe";
import { exportRecipeFile } from "./plotRecipeStorage";
import { defaultPlotView } from "./plotview";
import { DEFAULT_RECIPE, saveRecipe as savePeakRecipe } from "./peakwizard";
import { sniffRecipeKind, sniffRecipeKindFromText } from "./recipeFile";
import { serializeTemplate } from "./template";
import type { Dataset } from "./types";

const dataset: Dataset = {
  id: "x1",
  name: "x1.xy",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 100],
      [20, 200],
      [30, 300],
    ],
    labels: ["2theta", "Intensity"],
    units: ["deg", "cps"],
    metadata: { technique: "xrd.powder" },
  },
};

function exportOrThrow(kind: "peak" | "graph" | "fitModel", name: string): string {
  const r = exportNameKeyed(kind, name);
  if (!r.ok) throw new Error(`export failed for ${kind}`);
  return r.text;
}

beforeEach(() => {
  localStorage.clear();
});

describe("sniffRecipeKind", () => {
  it("identifies a plot recipe from its own exporter", () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(dataset, view, null, { id: "p1", name: "P", appVersion: "0" });
    const text = exportRecipeFile(recipe);
    expect(sniffRecipeKind(JSON.parse(text))).toBe("plot");
  });

  it("identifies an analysis template from its own exporter", () => {
    const t = {
      version: 1 as const,
      name: "T",
      steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
      outputs: ["R2"],
    };
    expect(sniffRecipeKind(JSON.parse(serializeTemplate(t)))).toBe("analysis");
  });

  it("identifies a peak recipe from its own exporter", () => {
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "Peaks" });
    expect(sniffRecipeKind(JSON.parse(exportOrThrow("peak", "Peaks")))).toBe("peak");
  });

  it("identifies a fit model from its own exporter", () => {
    saveCustomModel({ version: 1, name: "M", equation: "y=a*x", params: ["a"], guesses: [1], lower: [null], upper: [null] });
    expect(sniffRecipeKind(JSON.parse(exportOrThrow("fitModel", "M")))).toBe("fitModel");
  });

  it("identifies a graph template from its own exporter", () => {
    saveGraphTemplate({ name: "G", style: "line", overrides: null, seriesStyles: null });
    expect(sniffRecipeKind(JSON.parse(exportOrThrow("graph", "G")))).toBe("graph");
  });

  it("returns null for ambiguous, partial, or non-object input — never throws", () => {
    expect(sniffRecipeKind({})).toBeNull();
    expect(sniffRecipeKind({ version: 1 })).toBeNull();
    expect(sniffRecipeKind({ name: "just a name" })).toBeNull();
    expect(sniffRecipeKind(null)).toBeNull();
    expect(sniffRecipeKind(undefined)).toBeNull();
    expect(sniffRecipeKind("a string")).toBeNull();
    expect(sniffRecipeKind(42)).toBeNull();
    expect(sniffRecipeKind([1, 2, 3])).toBeNull();
  });

  it("returns null for a quickPlot-shaped object — it has no serializer of its own", () => {
    const quickPlotLike = {
      id: "q1",
      name: "Q",
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      scope: { kind: "schema" },
      technique: "generic",
      signature: { channels: [{ label: "A", unit: "", errorRole: "value" }] },
      mapping: { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] },
      style: "line", // QuickPlotStyle is itself a string union — the trap this guards against
      labels: { 0: "A" },
    };
    expect(sniffRecipeKind(quickPlotLike)).toBeNull();
  });
});

describe("sniffRecipeKindFromText", () => {
  it("reports bad JSON as a refusal", () => {
    const r = sniffRecipeKindFromText("{{{ not json");
    expect("error" in r ? r.error : null).toMatch(/bad JSON/);
  });

  it("reports an unrecognised shape as a refusal", () => {
    const r = sniffRecipeKindFromText("{}");
    expect(r).toEqual({ error: "not a recognised recipe file" });
  });

  it("returns the kind for a recognised file", () => {
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "P" });
    expect(sniffRecipeKindFromText(exportOrThrow("peak", "P"))).toEqual({ kind: "peak" });
  });
});
