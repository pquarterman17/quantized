// P3.5 slice 4 — the per-row Details data, one build per kind + the
// vanished-record race. `collectRecipes` builds the descriptor the same way
// the real panel does, so these tests exercise the real wiring between
// `recipeSources.ts` and `recipeDetails.ts`, not a hand-typed stand-in.
import { beforeEach, describe, expect, it } from "vitest";

import { saveGraphTemplate } from "./figuredoc";
import { saveCustomModel } from "./fitmodels";
import { makeStep } from "./pipeline";
import { captureRecipe } from "./plotRecipe";
import { defaultPlotView } from "./plotview";
import { DEFAULT_RECIPE, saveRecipe as savePeakRecipe } from "./peakwizard";
import type { RecipeDetails } from "./recipeDetails";
import { recipeDetails } from "./recipeDetails";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import { RECIPE_KINDS, supportsOperation, type RecipeDescriptor, type RecipeKind } from "./recipeLibrary";
import { collectRecipes, type RecipeSourceInput } from "./recipeSources";
import { saveTemplate } from "./template";
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

const quickPlotTemplate: QuickPlotTemplate = {
  id: "qp1",
  name: "Quick",
  createdAt: "2026-01-01T00:00:00.000Z",
  modifiedAt: "2026-01-02T00:00:00.000Z",
  scope: { kind: "schema" },
  technique: "xrd.powder",
  signature: {
    channels: [
      { label: "2theta", unit: "deg", errorRole: "value" },
      { label: "Intensity", unit: "cps", errorRole: "value" },
    ],
  },
  mapping: { xKey: 0, yKeys: [1], errorBindings: [], ignoredKeys: [] },
  style: "line",
  labels: { 0: "2theta", 1: "Intensity" },
};

function buildSources(): RecipeSourceInput {
  const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
  const plotRecipe = captureRecipe(dataset, view, null, { id: "plot1", name: "Plot", appVersion: "0" });
  return {
    plotProject: [plotRecipe],
    plotGlobal: [],
    quickPlot: [quickPlotTemplate],
    plotSourcesComplete: true,
  };
}

function seedNameKeyed() {
  saveTemplate({
    version: 1,
    name: "Analysis",
    steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
    outputs: ["R2"],
  });
  savePeakRecipe({ ...DEFAULT_RECIPE, name: "Peak" });
  saveGraphTemplate({ name: "Graph", style: "scatter", overrides: null, seriesStyles: null });
  saveCustomModel({
    version: 1,
    name: "Model",
    equation: "y = a*exp(-x/t) + c",
    params: ["a", "t", "c"],
    guesses: [1, 2, 3],
    lower: [null, 0, null],
    upper: [10, null, null],
  });
}

function rowFor(kind: RecipeKind, sources: RecipeSourceInput): RecipeDescriptor {
  const row = collectRecipes(sources).recipes.find((r) => r.kind === kind);
  if (!row) throw new Error(`no ${kind} row in collection`);
  return row;
}

function fieldValue(details: RecipeDetails, label: string): string | undefined {
  return details.fields.find((f) => f.label === label)?.value;
}

beforeEach(() => {
  localStorage.clear();
});

describe("recipeDetails — schema version is always visible", () => {
  it("plot: versioned, shows v1", () => {
    const sources = buildSources();
    const details = recipeDetails(rowFor("plot", sources), sources);
    expect(details && fieldValue(details, "Schema version")).toBe("v1");
  });

  it("quickPlot: unversioned by construction", () => {
    const sources = buildSources();
    const details = recipeDetails(rowFor("quickPlot", sources), sources);
    expect(details && fieldValue(details, "Schema version")).toBe("unversioned");
  });

  it("quickPlot channels: exact label where the mapping references a column, the signature's label otherwise — never a bare #i", () => {
    // Three columns in the signature, but `labels` only carries the two the
    // mapping references (that is how captureLabels writes it). The third
    // still exists and must be named, marked unused, and carry its role.
    const sources = buildSources();
    const withSigma: QuickPlotTemplate = {
      ...quickPlotTemplate,
      signature: {
        channels: [
          ...quickPlotTemplate.signature.channels,
          { label: "sigma", unit: "cps", errorRole: "error-y" },
        ],
      },
    };
    const details = recipeDetails(
      rowFor("quickPlot", sources),
      { ...sources, quickPlot: [withSigma] },
    );
    const channels = details?.sections?.find((s) => s.title === "Channels")?.items ?? [];
    expect(channels).toEqual(["2theta (deg)", "Intensity (cps)", "sigma (cps) · error-y · not used"]);
    expect(channels.some((c) => /#\d/.test(c))).toBe(false);
  });

  it("quickPlot channels: usage comes from the MAPPING, so a referenced column with no saved label is still marked used (self-review on #290)", () => {
    // `labels` omits a referenced column whose label was empty at save time
    // (quickPlotTemplates.ts's own doc) — membership in `labels` is not the
    // same as "used". Column 2 is bound as an error channel but absent from
    // `labels`; column 3 is an ignored extra.
    const sources = buildSources();
    const t: QuickPlotTemplate = {
      ...quickPlotTemplate,
      signature: {
        channels: [
          ...quickPlotTemplate.signature.channels,
          { label: "", unit: "cps", errorRole: "error-y" },
          { label: "temp", unit: "K", errorRole: "value" },
        ],
      },
      mapping: { xKey: 0, yKeys: [1], errorBindings: [{ channel: 2, target: 1, axis: "y", side: "both" }], ignoredKeys: [3] },
    };
    const details = recipeDetails(rowFor("quickPlot", sources), { ...sources, quickPlot: [t] });
    const channels = details?.sections?.find((s) => s.title === "Channels")?.items ?? [];
    expect(channels).toEqual(["2theta (deg)", "Intensity (cps)", " (cps) · error-y", "temp (K) · not used"]);
  });

  it("analysis/peak/fitModel: versioned, show v1", () => {
    seedNameKeyed();
    const sources = buildSources();
    for (const kind of ["analysis", "peak", "fitModel"] as const) {
      const details = recipeDetails(rowFor(kind, sources), sources);
      expect(details && fieldValue(details, "Schema version"), kind).toBe("v1");
    }
  });

  it("graph: unversioned by construction", () => {
    seedNameKeyed();
    const sources = buildSources();
    const details = recipeDetails(rowFor("graph", sources), sources);
    expect(details && fieldValue(details, "Schema version")).toBe("unversioned");
  });
});

describe("recipeDetails — kind-specific content a user deliberately opened may show", () => {
  it("shows a fit model's equation and formats its parameter bounds' open sides with the glyphs, not the word null", () => {
    seedNameKeyed();
    const sources = buildSources();
    const details = recipeDetails(rowFor("fitModel", sources), sources);
    expect(details).not.toBeNull();
    if (!details) return;
    const equation = details.fields.find((f) => f.label === "Equation");
    expect(equation).toEqual({ label: "Equation", value: "y = a*exp(-x/t) + c", mono: true });
    const params = details.sections?.find((s) => s.title === "Parameters")?.items;
    expect(params).toEqual([
      "a = 1 [−∞, 10]",
      "t = 2 [0, ∞]",
      "c = 3 [−∞, ∞]",
    ]);
  });

  it("shows an analysis template's step labels and outputs", () => {
    seedNameKeyed();
    const sources = buildSources();
    const details = recipeDetails(rowFor("analysis", sources), sources);
    expect(details?.sections).toEqual([
      { title: "Steps", items: ["expression: smooth"] },
      { title: "Outputs", items: ["R2"] },
    ]);
  });

  it("shows peak recipe range/baseline/find/model/report fields", () => {
    seedNameKeyed();
    const sources = buildSources();
    const details = recipeDetails(rowFor("peak", sources), sources);
    expect(details && fieldValue(details, "Baseline method")).toBe("none");
    expect(details && fieldValue(details, "Report mode")).toBe("fit");
  });

  it("shows graph style, override/series-style counts, and source", () => {
    seedNameKeyed();
    const sources = buildSources();
    const details = recipeDetails(rowFor("graph", sources), sources);
    expect(details && fieldValue(details, "Style")).toBe("scatter");
    expect(details && fieldValue(details, "Overrides")).toBe("0");
    expect(details && fieldValue(details, "Series styles")).toBe("0");
    expect(details && fieldValue(details, "Source")).toBe("saved in Figure Builder");
  });
});

describe("recipeDetails — 'Available actions' is derived, never hardcoded", () => {
  it("matches supportsOperation for every kind, including exclusions", () => {
    seedNameKeyed();
    const sources = buildSources();
    const OP_LABEL: Record<string, string> = {
      rename: "Rename",
      duplicate: "Duplicate",
      copyScope: "Copy to other scope",
      export: "Export",
      delete: "Delete",
    };
    for (const kind of RECIPE_KINDS) {
      const details = recipeDetails(rowFor(kind, sources), sources);
      expect(details, kind).not.toBeNull();
      if (!details) continue;
      const actions = fieldValue(details, "Available actions") ?? "";
      for (const [op, label] of Object.entries(OP_LABEL)) {
        const expected = supportsOperation(kind, op as never);
        expect(actions.includes(label), `${kind}: "${label}" in "${actions}"`).toBe(expected);
      }
    }
  });

  it("a quickPlot row's available actions do NOT list Export", () => {
    const sources = buildSources();
    const details = recipeDetails(rowFor("quickPlot", sources), sources);
    expect(details && fieldValue(details, "Available actions")).not.toMatch(/Export/);
  });

  it("the four name-keyed kinds show 'Open in <workshop>', never 'Apply'", () => {
    seedNameKeyed();
    const sources = buildSources();
    const expected: Record<string, string> = {
      analysis: "Open in Pipeline",
      peak: "Open in Peak Analyzer",
      graph: "Open in Figure Builder",
      fitModel: "Open in Curve Fit",
    };
    for (const [kind, verb] of Object.entries(expected)) {
      const details = recipeDetails(rowFor(kind as RecipeKind, sources), sources);
      expect(details && fieldValue(details, "Available actions")?.startsWith(verb), kind).toBe(true);
    }
    for (const kind of ["plot", "quickPlot"] as const) {
      const details = recipeDetails(rowFor(kind, sources), sources);
      expect(details && fieldValue(details, "Available actions")?.startsWith("Apply"), kind).toBe(true);
    }
  });
});

describe("recipeDetails — a vanished record is a normal race, not an error", () => {
  it("returns null when the underlying storage record is gone (name-keyed)", () => {
    seedNameKeyed();
    const sources = buildSources();
    const row = rowFor("peak", sources);
    localStorage.clear(); // the recipe was deleted elsewhere between render and open
    expect(recipeDetails(row, sources)).toBeNull();
  });

  it("returns null when the underlying workspace record is gone (plot)", () => {
    const sources = buildSources();
    const row = rowFor("plot", sources);
    const emptied: RecipeSourceInput = { ...sources, plotProject: [] };
    expect(recipeDetails(row, emptied)).toBeNull();
  });
});
