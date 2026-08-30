// P3.5 slice 1 — the adapter layer over all six recipe systems.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PlotRecipe } from "./plotRecipeSchema";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import { setFavorite, setTags } from "./recipeIndex";
import { collectRecipes, liveKeys, type RecipeSourceInput } from "./recipeSources";

const SECRET_EQUATION = "y = a*exp(-x/tau_UNPUBLISHED) + c";
const SECRET_COLUMN = "Moment_collabCompound";

const plot = (id: string, name: string): PlotRecipe =>
  ({
    id,
    name,
    description: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    modifiedAt: "2026-08-02T00:00:00.000Z",
    schemaVersion: 1,
    provenance: { sourceDatasetLabel: SECRET_COLUMN, appVersion: "0.23.2" },
    technique: "xrd.powder",
    signature: [{ id: "c0" }, { id: "c1" }],
    mapping: {},
    visual: {},
  }) as unknown as PlotRecipe;

const quick = (id: string, name: string): QuickPlotTemplate =>
  ({
    id,
    name,
    createdAt: "2026-08-01T00:00:00.000Z",
    scope: { kind: "schema" },
    technique: "sims",
    signature: { channels: [{ label: SECRET_COLUMN }] },
  }) as unknown as QuickPlotTemplate;

const input: RecipeSourceInput = {
  plotProject: [plot("p1", "Project plot")],
  plotGlobal: [plot("g1", "Global plot")],
  quickPlot: [quick("q1", "Quick one")],
};

const realStorage = globalThis.localStorage;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(
    "qz.analysisTemplates",
    JSON.stringify([
      {
        version: 1,
        name: "Batch fit",
        // Real steps: loadTemplates() validates via parseTemplate/isStep and
        // silently drops malformed ones, so a lazy fixture would have made
        // this test assert on an empty system without saying so.
        steps: [
          { kind: "expression", label: "Add column", code: "qz.addColumn()", params: {} },
          { kind: "fit", label: "Fit", code: "qz.fit()", params: {} },
        ],
        outputs: ["A"],
      },
    ]),
  );
  localStorage.setItem(
    "qz.peakRecipes",
    JSON.stringify([
      {
        version: 1,
        name: "XRD peaks",
        range: { lo: null, hi: null },
        baseline: { method: "als", lam: 1, p: 1, radius: 1, order: 1 },
        find: { snr_threshold: 1, min_prominence: 1, max_peaks: 1 },
        model: { shape: "pseudovoigt", bgDegree: 1, linkMode: "none", constrain: false },
        report: { mode: "fit", regionWidth: 1 },
      },
    ]),
  );
  localStorage.setItem(
    "qz.graphTemplates",
    JSON.stringify([{ name: "House style", style: "publication", overrides: null, seriesStyles: null }]),
  );
  localStorage.setItem(
    "qz.customFitModels",
    JSON.stringify([
      {
        version: 1,
        name: "Stretched exp",
        equation: SECRET_EQUATION,
        params: ["a", "tau", "c"],
        guesses: [1, 1, 0],
        lower: [null, null, null],
        upper: [null, null, null],
      },
    ]),
  );
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: realStorage, configurable: true });
});

describe("collectRecipes covers every system that actually exists", () => {
  it("lists all six kinds in one collection", () => {
    const kinds = new Set(collectRecipes(input).recipes.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(["analysis", "fitModel", "graph", "peak", "plot", "quickPlot"]);
  });

  it("distinguishes project from global scope for plot recipes", () => {
    const plots = collectRecipes(input).recipes.filter((r) => r.kind === "plot");
    expect(plots.map((r) => r.ref.scope).sort()).toEqual(["global", "project"]);
  });

  it("keys the name-keyed systems by their name, which IS their id", () => {
    const analysis = collectRecipes(input).recipes.find((r) => r.kind === "analysis");
    expect(analysis?.ref.id).toBe("Batch fit");
    expect(analysis?.capabilities.stableId).toBe(false);
  });

  it("carries sidecar metadata onto the descriptor", () => {
    setFavorite({ kind: "analysis", scope: "global", id: "Batch fit" }, true);
    setTags({ kind: "analysis", scope: "global", id: "Batch fit" }, ["nightly"]);
    const analysis = collectRecipes(input).recipes.find((r) => r.kind === "analysis");
    expect(analysis?.favorite).toBe(true);
    expect(analysis?.tags).toEqual(["nightly"]);
  });

  it("reports an empty system as empty rather than absent", () => {
    localStorage.setItem("qz.peakRecipes", "[]");
    expect(collectRecipes(input).recipes.some((r) => r.kind === "peak")).toBe(false);
    expect(collectRecipes(input).complete).toBe(true);
  });
});

describe("summaries describe shape, never the user's science", () => {
  it("never quotes an equation, a column label, or a sample name", () => {
    const blob = collectRecipes(input)
      .recipes.map((r) => `${r.summary ?? ""} ${r.description ?? ""}`)
      .join("\n");
    expect(blob).not.toContain(SECRET_EQUATION);
    expect(blob).not.toContain("tau_UNPUBLISHED");
    expect(blob).not.toContain(SECRET_COLUMN);
  });

  it("still says enough to tell two recipes apart", () => {
    const by = (k: string) => collectRecipes(input).recipes.find((r) => r.kind === k)?.summary;
    expect(by("fitModel")).toBe("3 parameters");
    expect(by("analysis")).toBe("2 steps, 1 output");
    expect(by("peak")).toBe("als baseline, pseudovoigt");
    expect(by("plot")).toBe("2 channels");
  });

  it("pluralizes honestly at one", () => {
    localStorage.setItem(
      "qz.customFitModels",
      JSON.stringify([{ version: 1, name: "One", equation: "y=a", params: ["a"], guesses: [1], lower: [null], upper: [null] }]),
    );
    expect(collectRecipes(input).recipes.find((r) => r.kind === "fitModel")?.summary).toBe("1 parameter");
  });
});

describe("completeness is reported honestly", () => {
  it("is false when localStorage is unreachable, so pruning stays disarmed", () => {
    // The load functions swallow their own errors and return [], so without
    // this probe an unreachable store is indistinguishable from an empty one
    // — and pruning against it would wipe every favorite.
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem() {
          throw new DOMException("denied", "SecurityError");
        },
        setItem() {
          throw new DOMException("denied", "SecurityError");
        },
        removeItem() {},
        clear() {},
        key: () => null,
        length: 0,
      },
      configurable: true,
    });

    const collection = collectRecipes(input);
    expect(collection.complete).toBe(false);
    // The workspace-backed kinds still come through — they never needed
    // localStorage in the first place.
    expect(collection.recipes.some((r) => r.kind === "plot")).toBe(true);
  });

  it("liveKeys covers every descriptor it collected", () => {
    const collection = collectRecipes(input);
    expect(liveKeys(collection).size).toBe(collection.recipes.length);
  });
});
