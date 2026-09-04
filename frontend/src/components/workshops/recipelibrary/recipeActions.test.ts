// P3.5 slice 3 — the capability-gated dispatcher behind every Library row
// action. The cases that matter are the refusals: a UI bug that fails to grey
// a button out must not be able to perform an operation the underlying system
// cannot take, and every "no longer exists" path is a real race with another
// tab, an undo, or a stale render — not a theoretical one.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "../../../lib/figuredoc";
import { saveCustomModel } from "../../../lib/fitmodels";
import { exportNameKeyed } from "../../../lib/nameKeyedRecipes";
import { DEFAULT_RECIPE, saveRecipe as savePeakRecipe } from "../../../lib/peakwizard";
import { makeStep } from "../../../lib/pipeline";
import { captureRecipe } from "../../../lib/plotRecipe";
import { exportRecipeFile } from "../../../lib/plotRecipeStorage";
import { defaultPlotView } from "../../../lib/plotview";
import { metaFor, setFavorite } from "../../../lib/recipeIndex";
import type { RecipeRef } from "../../../lib/recipeLibrary";
import { loadTemplates, saveTemplate } from "../../../lib/template";
import type { Dataset } from "../../../lib/types";
import { useApp } from "../../../store/useApp";
import {
  applyOrOpen,
  copyToOtherScope,
  deleteIsUndoable,
  deleteRecipe,
  duplicateRecipe,
  exportRecipe,
  importAnyRecipe,
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

/** A three-column XRD set whose Y label can be swapped to force an UNMATCHED
 *  (staged, not refused) resolution -- the same shape store/plotRecipes.test.ts
 *  uses for its staging case. */
const xrd = (labels: string[]): Dataset => ({
  id: "x1",
  name: "x1.xy",
  data: {
    time: [0, 1, 2],
    values: [
      [10, 100, 1],
      [20, 200, 2],
      [30, 300, 3],
    ],
    labels,
    units: ["deg", "cps", "cps"],
    metadata: { technique: "xrd.powder" },
  },
});

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
    // quickPlot is the one kind that STILL genuinely lacks import/export
    // (P3.5 gave peak/graph/fitModel real serializers — see
    // lib/nameKeyedRecipes.ts) and copyScope (only `plot` lives in two
    // scopes). No template needs to exist for any of this: the capability
    // gate runs before any store lookup, so the dispatcher must not invent
    // behaviour for an unsupported kind just because a button was clicked.
    expect(exportRecipe(ref("quickPlot", "Q", "project"))).toEqual({
      ok: false,
      reason: "Quick Plot templates cannot be exported yet",
    });
    // Asserting the exact REASON, not merely `.ok === false`: without the
    // capability guard this falls through to a store lookup and refuses with
    // "no longer exists" — still false, so an `.ok` assertion passes against
    // the bug (measured). The reason is what proves the guard ran.
    expect(importRecipe("quickPlot", "project", "{}")).toEqual({
      ok: false,
      reason: "Quick Plot templates cannot be imported yet",
    });
    expect(copyToOtherScope(ref("quickPlot", "Q", "project"))).toEqual({
      ok: false,
      reason: "Quick Plot templates cannot be copied between project and global yet",
    });

    expect(useApp.getState().quickPlotTemplates).toHaveLength(0); // nothing was mutated by any refusal
  });

  it("peak, graph, and fit model now genuinely support export/import — the capability gate lets them through", () => {
    saveGraphTemplate({ name: "G", style: "line", overrides: null, seriesStyles: null });
    expect(exportRecipe(ref("graph", "G")).ok).toBe(true);
    expect(loadGraphTemplates()).toHaveLength(1); // export never mutates
    // Still global-only: gaining a serializer did not give it a second scope.
    expect(copyToOtherScope(ref("graph", "G"))).toEqual({
      ok: false,
      reason: "Graph templates cannot be copied between project and global yet",
    });
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
      // `renameQuickPlotTemplate` silently no-ops for an unknown id, so
      // without an explicit existence check this reported SUCCESS while
      // nothing happened — a false success, worse than a throw.
      () => renameRecipe(ref("quickPlot", "ghost", "project"), "New"),
    ]) {
      const r = act();
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/no longer exists/);
      else throw new Error(`a stale ref reported success: ${JSON.stringify(r)}`);
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
    // `ref` must report where the row ACTUALLY ended up — "B (2)", not the "B"
    // the user typed. The panel focuses the row by this id after a rename, so
    // deriving it from the typed name instead would send focus to a different
    // recipe's row on every collision.
    expect(renameRecipe(ref("analysis", "A"), "B")).toEqual({
      ok: true,
      message: 'renamed to "B (2)"',
      ref: { kind: "analysis", scope: "global", id: "B (2)" },
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
    }))).toEqual({
      ok: true,
      message: 'imported "Shared (2)"',
      ref: { kind: "analysis", scope: "global", id: "Shared (2)" },
    });
    expect(loadTemplates()).toHaveLength(2); // an import never overwrites
  });

  it("surfaces a malformed import file as a refusal", () => {
    expect(importRecipe("analysis", "global", "{{{ not json").ok).toBe(false);
  });

  it("duplicates a quickPlot template and refuses a stale ref", () => {
    const id = useApp.getState().saveQuickPlotTemplate(
      "d1",
      { xKey: null, yKeys: [0], errorBindings: [], ignoredKeys: [] },
      "line",
      "Q",
      { kind: "schema" },
    )!;
    expect(duplicateRecipe(ref("quickPlot", id, "project"))).toEqual({ ok: true, message: "duplicated" });
    expect(useApp.getState().quickPlotTemplates).toHaveLength(2);
    expect(useApp.getState().quickPlotTemplates.map((t) => t.name).sort()).toEqual(["Q", "Q copy"]);

    expect(duplicateRecipe(ref("quickPlot", "ghost", "project"))).toEqual({
      ok: false,
      reason: "that template no longer exists",
    });
  });
});

describe("an imperfect match is PENDING, not refused", () => {
  const plotRecipe = (id: string) =>
    ({ id, name: id, schemaVersion: 1, signature: [], mapping: {}, visual: {} }) as never;

  it("reports a genuinely staged apply as PENDING, not as a refusal", async () => {
    // The positive half. Only pinning "a stale pending is not this call's"
    // left the whole `pending` variant removable: fold staging back into a
    // plain `ok: false` and that test still passes, because it only asserts
    // `pending` is FALSY. This one fails unless a real staging is reported as
    // pending, which is what stops the panel styling it as an error.
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const captured = captureRecipe(xrd(["2theta", "Intensity", "Ierr"]), view, null, {
      id: "p-stage",
      name: "staged",
      appVersion: "0",
    });
    // Rename the Y column the recipe bound: X resolves, Y does not -- unmatched,
    // which stages rather than refusing.
    useApp.setState({
      datasets: [xrd(["2theta", "Signal", "Ierr"])],
      activeId: "x1",
      plotRecipes: [captured],
      pendingRecipeApplication: null,
      status: "",
    });

    const r = await applyOrOpen(ref("plot", "p-stage", "project"));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending, "a real staging MUST be pending, not a refusal").toBe(true);
      expect(r.reason).toContain("confirm");
    }
    expect(useApp.getState().pendingRecipeApplication).not.toBeNull();
  });

  it("does not report a fresh refusal as staged just because something is pending", async () => {
    // Detecting staging by TRUTHINESS of `pendingRecipeApplication` meant a
    // pending application left over from an earlier apply swallowed the next
    // refusal's real reason and pointed the user at the wrong recipe to
    // confirm. Identity, not truthiness.
    useApp.setState({
      activeId: "d1",
      plotRecipes: [plotRecipe("p1")],
      pendingRecipeApplication: { stale: true } as never,
      status: "",
    });

    const r = await applyOrOpen(ref("plot", "p1", "project"));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.pending, "a STALE pending must not be read as this call's").toBeFalsy();
      expect(r.reason).not.toBe("");
    }
    // The leftover is untouched — this call neither confirmed nor cleared it.
    expect(useApp.getState().pendingRecipeApplication).toEqual({ stale: true });
  });
});

describe("delete tells the truth about whether undo will help", () => {
  // This flag drives the confirm dialog's wording. An always-true bug promises
  // "You can undo this." before an irreversible delete — the exact scenario
  // `deleteIsUndoable`'s own doc calls worse than no dialog — so BOTH branches
  // need pinning, not just the true one.
  const plotRecipe = (id: string) =>
    ({ id, name: id, schemaVersion: 1, signature: [], mapping: {}, visual: {} }) as never;

  it("promises an undo for the two kinds that have one", () => {
    expect(deleteIsUndoable(ref("plot", "p1", "project"))).toBe(true);
    expect(deleteIsUndoable(ref("quickPlot", "q1", "project"))).toBe(true);

    useApp.setState({ plotRecipes: [plotRecipe("p1")] });
    expect(deleteRecipe(ref("plot", "p1", "project"))).toEqual({
      ok: true,
      message: "deleted — undo restores it",
    });
  });

  it("promises NOTHING for the kinds that cannot be undone", () => {
    // The global plot store carries no history by design, and the four
    // name-keyed systems write straight to localStorage.
    expect(deleteIsUndoable(ref("plot", "p1", "global"))).toBe(false);
    for (const kind of ["analysis", "peak", "graph", "fitModel"] as const) {
      expect(deleteIsUndoable(ref(kind, "x")), kind).toBe(false);
    }

    seedAnalysis("Gone");
    expect(deleteNameKeyedViaDispatcher("Gone")).toEqual({ ok: true, message: "deleted" });
  });
});

function deleteNameKeyedViaDispatcher(name: string) {
  return deleteRecipe(ref("analysis", name));
}

describe("importAnyRecipe — the library-level import button's one entry point", () => {
  it("sniffs a plot recipe and lands it in the requested scope, deduped on collision", async () => {
    const view = { ...defaultPlotView(), xKey: 0, yKeys: [1] };
    const recipe = captureRecipe(xrd(["2theta", "Intensity", "Ierr"]), view, null, {
      id: "p-orig",
      name: "X",
      appVersion: "0",
    });
    const text = exportRecipeFile(recipe);
    // Force a name collision: a DIFFERENT recipe already occupies "X" in the
    // destination (project) scope.
    useApp.setState({ plotRecipes: [{ ...recipe, id: "p-other", name: "X" }] });

    const result = importAnyRecipe(text, "project");
    expect(result.ok).toBe(true);
    if (!result.ok || !result.ref) throw new Error(`expected an ok import with a ref: ${JSON.stringify(result)}`);
    expect(result.ref.kind).toBe("plot");
    expect(result.ref.scope).toBe("project");
    const landed = useApp.getState().plotRecipes.find((r) => r.id === result.ref!.id);
    expect(landed?.name).toBe("X (2)");
    // The message carries the LANDED name and scope so the panel can show it
    // verbatim without reading the store (getState()-in-render ratchet).
    expect(result.message).toBe('imported "X (2)" into this project');
  });

  it("sniffs each name-keyed kind and dedupes its name on collision", () => {
    seedAnalysis("X");
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "X" });
    saveGraphTemplate({ name: "X", style: "line", overrides: null, seriesStyles: null });
    saveCustomModel({ version: 1, name: "X", equation: "y=x", params: [], guesses: [], lower: [], upper: [] });

    for (const kind of ["analysis", "peak", "graph", "fitModel"] as const) {
      const exported = exportNameKeyed(kind, "X");
      if (!exported.ok) throw new Error(`export failed for ${kind}`);
      expect(importAnyRecipe(exported.text, "project")).toEqual({
        ok: true,
        message: 'imported "X (2)"',
        ref: { kind, scope: "global", id: "X (2)" },
      });
    }
  });

  it("refuses quickPlot-shaped text — quickPlot has no serializer to sniff for", () => {
    const quickPlotLike = JSON.stringify({
      id: "q1",
      name: "Q",
      createdAt: "2026-01-01T00:00:00.000Z",
      modifiedAt: "2026-01-01T00:00:00.000Z",
      scope: { kind: "schema" },
      technique: "generic",
      signature: { channels: [] },
      mapping: { xKey: null, yKeys: [], errorBindings: [], ignoredKeys: [] },
      style: "line",
      labels: {},
    });
    const result = importAnyRecipe(quickPlotLike, "project");
    expect(result).toEqual({ ok: false, reason: "not a recognised recipe file" });
  });

  it("refuses garbage text", () => {
    expect(importAnyRecipe("{{{ not json", "project")).toEqual({
      ok: false,
      reason: "not a valid recipe file (bad JSON)",
    });
    expect(importAnyRecipe("{}", "project")).toEqual({
      ok: false,
      reason: "not a recognised recipe file",
    });
  });

  it("refuses a malformed graph file carrying only name and style", () => {
    const result = importAnyRecipe(JSON.stringify({ name: "G", style: "line" }), "project");
    expect(result.ok).toBe(false);
  });
});
