// P3.5 slice 3 — the capability-gated dispatcher behind every Library row
// action. The cases that matter are the refusals: a UI bug that fails to grey
// a button out must not be able to perform an operation the underlying system
// cannot take, and every "no longer exists" path is a real race with another
// tab, an undo, or a stale render — not a theoretical one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "../../../lib/figuredoc";
import { makeStep } from "../../../lib/pipeline";
import { metaFor, setFavorite } from "../../../lib/recipeIndex";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import { loadTemplates, saveTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import {
  applyOrOpen,
  copyToOtherScope,
  deleteRecipe,
  duplicateRecipe,
  exportRecipe,
  importRecipe,
  primaryActionLabel,
  renameRecipe,
} from "./recipeActions";

vi.mock("../../../lib/download", () => ({ saveBlob: vi.fn() }));

const ref = (kind: RecipeRef["kind"], id: string, scope: RecipeRef["scope"] = "global"): RecipeRef =>
  ({ kind, scope, id });

const dataset: Dataset = {
  id: "d1",
  name: "d1.dat",
  data: {
    time: [0, 1],
    values: [[1], [2]],
    labels: ["A"],
    units: ["emu"],
    metadata: { technique: "magnetometry.mvsh" },
  },
};

function seedAnalysis(name: string) {
  saveTemplate({
    version: 1,
    name,
    steps: [makeStep("expression", "smooth", "qz.smooth(5)", { window: 5 })],
    outputs: ["R2"],
  });
}

beforeEach(() => {
  localStorage.clear();
  useApp.setState({
    datasets: [dataset],
    activeId: null,
    plotRecipes: [],
    quickPlotTemplates: [],
    pipelineOpen: false,
    peakWizardOpen: false,
    figureBuilderOpen: false,
    curveFitOpen: false,
    status: "",
  });
});

describe("capability gating happens BEFORE anything is touched", () => {
  it("refuses operations the kind genuinely cannot do", () => {
    saveGraphTemplate({ name: "G", style: "line", overrides: null, seriesStyles: null });

    // No serializer exists for graph templates; the dispatcher must not
    // invent a JSON shape just because a button was clicked.
    expect(exportRecipe(ref("graph", "G"))).toEqual({
      ok: false,
      reason: "Graph templates cannot be exported yet",
    });
    expect(importRecipe("graph", "global", "{}").ok).toBe(false);
    // Quick Plot templates have no duplicate action in their store slice.
    expect(duplicateRecipe(ref("quickPlot", "q1", "project")).ok).toBe(false);
    // The name-keyed four have no project-file representation at all.
    expect(copyToOtherScope(ref("graph", "G")).ok).toBe(false);

    expect(loadGraphTemplates()).toHaveLength(1); // nothing was mutated by any refusal
  });

  it("refuses a stale ref instead of throwing or half-acting", () => {
    for (const act of [
      () => renameRecipe(ref("plot", "ghost", "project"), "New"),
      () => duplicateRecipe(ref("plot", "ghost", "project")),
      () => deleteRecipe(ref("plot", "ghost", "project")),
      () => exportRecipe(ref("plot", "ghost", "project")),
      () => copyToOtherScope(ref("plot", "ghost", "project")),
      () => deleteRecipe(ref("quickPlot", "ghost", "project")),
      () => renameRecipe(ref("analysis", "ghost"), "New"),
    ]) {
      const r = act();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/no longer exists/);
    }
  });
});

describe("apply vs open — two different verbs, labelled apart", () => {
  it("opens the owning workshop for the four that cannot be applied here", async () => {
    expect(primaryActionLabel("analysis")).toBe("Open in Pipeline");
    expect(primaryActionLabel("peak")).toBe("Open in Peak Analyzer");
    expect(primaryActionLabel("graph")).toBe("Open in Figure Builder");
    expect(primaryActionLabel("fitModel")).toBe("Open in Curve Fit");
    expect(primaryActionLabel("plot")).toBe("Apply");
    expect(primaryActionLabel("quickPlot")).toBe("Apply");

    await applyOrOpen(ref("analysis", "T"));
    expect(useApp.getState().pipelineOpen).toBe(true);
    await applyOrOpen(ref("peak", "P"));
    expect(useApp.getState().peakWizardOpen).toBe(true);
    await applyOrOpen(ref("graph", "G"));
    expect(useApp.getState().figureBuilderOpen).toBe(true);
    await applyOrOpen(ref("fitModel", "M"));
    expect(useApp.getState().curveFitOpen).toBe(true);
  });

  it("refuses to apply with no active dataset, naming what to do", async () => {
    // An apply needs a target. Silently picking one would apply a recipe to
    // data the user was not looking at.
    expect(await applyOrOpen(ref("plot", "p1", "project"))).toEqual({
      ok: false,
      reason: "select a dataset first",
    });
    expect(await applyOrOpen(ref("quickPlot", "q1", "project"))).toEqual({
      ok: false,
      reason: "select a dataset first",
    });
  });

  it("passes the store's own refusal through rather than talking over it", async () => {
    // The store writes a specific reason (which channel failed to resolve);
    // replacing it with a generic one loses the only useful part.
    useApp.setState({ activeId: "d1" });
    const r = await applyOrOpen(ref("quickPlot", "no-such-template", "project"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Quick Plot With unavailable");
  });
});

describe("name-keyed operations route through the safe layer", () => {
  it("rename carries the sidecar and reports the name actually used", () => {
    seedAnalysis("A");
    seedAnalysis("B");
    setFavorite(ref("analysis", "A"), true);

    // Renaming onto a taken name dedupes rather than merging two recipes.
    expect(renameRecipe(ref("analysis", "A"), "B")).toEqual({
      ok: true,
      message: 'renamed to "B (2)"',
    });
    expect(metaFor(ref("analysis", "B (2)")).favorite).toBe(true);
    expect(loadTemplates().map((t) => t.name).sort()).toEqual(["B", "B (2)"]);
  });

  it("delete drops the sidecar for kinds whose deletion is NOT undoable", () => {
    seedAnalysis("Doomed");
    setFavorite(ref("analysis", "Doomed"), true);
    expect(deleteRecipe(ref("analysis", "Doomed"))).toEqual({ ok: true, message: "deleted" });
    expect(metaFor(ref("analysis", "Doomed")).favorite).toBe(false);
  });

  it("round-trips an analysis template through export and import", () => {
    seedAnalysis("Shared");
    expect(exportRecipe(ref("analysis", "Shared"))).toEqual({ ok: true, message: "exported" });
    expect(importRecipe("analysis", "global", JSON.stringify({
      version: 1,
      name: "Shared",
      steps: [{ kind: "expression", label: "s", code: "c", params: {} }],
      outputs: [],
    }))).toEqual({ ok: true, message: 'imported as "Shared (2)"' });
    expect(loadTemplates()).toHaveLength(2); // an import never overwrites
  });

  it("surfaces a malformed import file as a refusal", () => {
    expect(importRecipe("analysis", "global", "{{{ not json").ok).toBe(false);
  });
});

describe("delete tells the truth about whether undo will help", () => {
  it("promises an undo only where one exists", () => {
    // Project-scope plot recipes are undo-tracked; the global store carries no
    // history by design, so promising an undo there would be a lie.
    useApp.setState({
      plotRecipes: [{ id: "p1", name: "P", schemaVersion: 1, signature: [], mapping: {}, visual: {} } as never],
    });
    expect(deleteRecipe(ref("plot", "p1", "project"))).toEqual({
      ok: true,
      message: "deleted — undo restores it",
    });
  });
});
