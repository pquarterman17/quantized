// P3.5 operation layer for the four name-keyed recipe systems.
//
// The rename cases are the point of this file. Because `save*` upserts by name
// and `delete*` removes by name, a rename is a delete plus a create, and each
// of the three ways to get that wrong destroys real user data rather than
// merely misbehaving. Each has a test that fails if the guard is removed.
import { beforeEach, describe, expect, it } from "vitest";

import { loadGraphTemplates, saveGraphTemplate } from "./figuredoc";
import { loadCustomModels, saveCustomModel } from "./fitmodels";
import { loadRecipes as loadPeakRecipes, saveRecipe as savePeakRecipe, DEFAULT_RECIPE } from "./peakwizard";
import {
  deleteNameKeyed,
  duplicateNameKeyed,
  exportNameKeyed,
  importNameKeyed,
  NAME_KEYED_KINDS,
  renameNameKeyed,
} from "./nameKeyedRecipes";
import { uniqueTemplateName } from "./uniqueName";
import { metaFor, setFavorite, setTags } from "./recipeIndex";
import { makeStep } from "./pipeline";
import { loadTemplates, saveTemplate } from "./template";

const analysisRef = (name: string) => ({ kind: "analysis" as const, scope: "global" as const, id: name });

/** A template `parseTemplate` accepts in FULL — `loadTemplates` re-parses
 *  every stored record, so a fixture missing `label`, `code`, or a valid
 *  `kind` is silently dropped on the way back in and every assertion below
 *  would then be testing an empty system. Built with `makeStep`, the canonical
 *  constructor, rather than a hand-rolled literal, so it cannot drift from
 *  what the validator demands. */
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
});

describe("rename — a delete plus a create, with teeth", () => {
  it("carries favorites and tags across (the whole reason moveEntry exists)", () => {
    seedAnalysis("Loop fit");
    setFavorite(analysisRef("Loop fit"), true);
    setTags(analysisRef("Loop fit"), ["mvsh", "paper"]);

    const result = renameNameKeyed("analysis", "Loop fit", "Hysteresis fit");
    expect(result).toEqual({ ok: true, name: "Hysteresis fit" });

    expect(loadTemplates().map((t) => t.name)).toEqual(["Hysteresis fit"]);
    const moved = metaFor(analysisRef("Hysteresis fit"));
    expect(moved.favorite).toBe(true);
    expect(moved.tags).toEqual(["mvsh", "paper"]);
    expect(metaFor(analysisRef("Loop fit")).favorite).toBe(false); // no orphan left behind
  });

  it("renaming to the SAME name is a no-op, not a self-destruct", () => {
    // Save-then-remove with from === to writes the record and then deletes
    // exactly what it just wrote. Without the early return this loses it.
    seedAnalysis("Keep me");
    setFavorite(analysisRef("Keep me"), true);

    expect(renameNameKeyed("analysis", "Keep me", "Keep me")).toEqual({ ok: true, name: "Keep me" });
    expect(loadTemplates().map((t) => t.name)).toEqual(["Keep me"]);
    expect(metaFor(analysisRef("Keep me")).favorite).toBe(true);
  });

  it("dedupes onto a taken name instead of merging two recipes into one", () => {
    seedAnalysis("A");
    seedAnalysis("B");
    const result = renameNameKeyed("analysis", "A", "B");
    expect(result).toEqual({ ok: true, name: "B (2)" });
    expect(loadTemplates().map((t) => t.name).sort()).toEqual(["B", "B (2)"]);
  });

  it("refuses an empty name and a record that is already gone", () => {
    seedAnalysis("A");
    expect(renameNameKeyed("analysis", "A", "   ")).toEqual({ ok: false, reason: "name cannot be empty" });
    expect(renameNameKeyed("analysis", "ghost", "B")).toEqual({
      ok: false,
      reason: '"ghost" no longer exists',
    });
    expect(loadTemplates().map((t) => t.name)).toEqual(["A"]); // nothing touched
  });

  it("works for every name-keyed kind, not just the one with a serializer", () => {
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "peaks" });
    saveGraphTemplate({ name: "graph", style: "line", overrides: null, seriesStyles: null });
    saveCustomModel({ version: 1, name: "model", equation: "y=a*x", params: ["a"], guesses: [1], lower: [null], upper: [null] });

    expect(renameNameKeyed("peak", "peaks", "peaks2").ok).toBe(true);
    expect(renameNameKeyed("graph", "graph", "graph2").ok).toBe(true);
    expect(renameNameKeyed("fitModel", "model", "model2").ok).toBe(true);

    expect(loadPeakRecipes().map((r) => r.name)).toEqual(["peaks2"]);
    expect(loadGraphTemplates().map((t) => t.name)).toEqual(["graph2"]);
    expect(loadCustomModels().map((m) => m.name)).toEqual(["model2"]);
  });

  it("saves under the new name BEFORE dropping the old one", () => {
    // The ordering only shows itself when the SECOND write fails, so force
    // that. Save-then-remove leaves the record under one name or the other;
    // remove-then-save can leave it under NEITHER, which is a silent loss of
    // the user's recipe. Both writers swallow storage errors by design
    // ("stays session-local"), so nothing else would surface this.
    //
    // Replaces the `globalThis.localStorage` binding rather than patching
    // `Storage.prototype` — the repo's proven cross-Node pattern, enforced by
    // architecture.test.ts — and counts rejections so the test cannot pass
    // without actually reaching the forced failure.
    seedAnalysis("Original");
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    const backing = window.localStorage;
    let writes = 0;
    let rejected = 0;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (k: string) => backing.getItem(k),
        removeItem: (k: string) => backing.removeItem(k),
        clear: () => backing.clear(),
        key: (i: number) => backing.key(i),
        get length() {
          return backing.length;
        },
        setItem: (k: string, v: string) => {
          writes += 1;
          if (writes >= 2) {
            rejected += 1;
            throw new DOMException("QuotaExceededError");
          }
          backing.setItem(k, v);
        },
      },
    });
    try {
      renameNameKeyed("analysis", "Original", "Renamed");
    } finally {
      if (real) Object.defineProperty(globalThis, "localStorage", real);
    }

    expect(rejected, "the second write must actually have been rejected").toBe(1);
    const names = loadTemplates().map((t) => t.name);
    expect(names.length, `record lost entirely — names: ${names.join(", ")}`).toBeGreaterThan(0);
    expect(names).toContain("Renamed"); // the new name is the one that landed
  });

  it("preserves the record payload verbatim — only the name changes", () => {
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "peaks", find: { ...DEFAULT_RECIPE.find, max_peaks: 17 } });
    renameNameKeyed("peak", "peaks", "renamed");
    expect(loadPeakRecipes()[0].find.max_peaks).toBe(17);
  });
});

describe("duplicate", () => {
  it("copies the payload under a deduped name", () => {
    seedAnalysis("Base");
    expect(duplicateNameKeyed("analysis", "Base")).toEqual({ ok: true, name: "Base copy" });
    expect(duplicateNameKeyed("analysis", "Base")).toEqual({ ok: true, name: "Base copy (2)" });
    expect(loadTemplates().map((t) => t.name).sort()).toEqual(["Base", "Base copy", "Base copy (2)"]);
    expect(loadTemplates().find((t) => t.name === "Base copy")?.steps).toHaveLength(1);
  });

  it("does NOT inherit the original's favorite or tags", () => {
    // A copy is a new artifact; asserting the user's judgement about the
    // original onto it would be the library making something up.
    seedAnalysis("Base");
    setFavorite(analysisRef("Base"), true);
    setTags(analysisRef("Base"), ["keep"]);
    duplicateNameKeyed("analysis", "Base");
    expect(metaFor(analysisRef("Base copy")).favorite).toBe(false);
    expect(metaFor(analysisRef("Base copy")).tags).toEqual([]);
    expect(metaFor(analysisRef("Base")).favorite).toBe(true); // original untouched
  });

  it("refuses a record that is already gone", () => {
    expect(duplicateNameKeyed("analysis", "ghost").ok).toBe(false);
  });
});

describe("delete", () => {
  it("removes the record AND its sidecar entry", () => {
    // Not left to pruneEntries: pruning is guarded on every source reading
    // completely, so this favorite could otherwise outlive the recipe — and
    // then be inherited by the next recipe saved under the same name.
    seedAnalysis("Doomed");
    setFavorite(analysisRef("Doomed"), true);

    expect(deleteNameKeyed("analysis", "Doomed")).toEqual({ ok: true, name: "Doomed" });
    expect(loadTemplates()).toEqual([]);
    expect(metaFor(analysisRef("Doomed")).favorite).toBe(false);

    seedAnalysis("Doomed"); // a NEW recipe reusing the name inherits nothing
    expect(metaFor(analysisRef("Doomed")).favorite).toBe(false);
  });

  it("refuses a record that is already gone", () => {
    expect(deleteNameKeyed("analysis", "ghost").ok).toBe(false);
  });
});

describe("import / export", () => {
  it("round-trips an analysis template through its own serializer", () => {
    seedAnalysis("Shared");
    const exported = exportNameKeyed("analysis", "Shared");
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    localStorage.clear();
    expect(importNameKeyed("analysis", exported.text)).toEqual({ ok: true, name: "Shared" });
    expect(loadTemplates()[0].steps).toHaveLength(1);
  });

  it("an import never overwrites — it dedupes", () => {
    seedAnalysis("Shared");
    const exported = exportNameKeyed("analysis", "Shared");
    if (!exported.ok) throw new Error("export failed");
    expect(importNameKeyed("analysis", exported.text)).toEqual({ ok: true, name: "Shared (2)" });
    expect(loadTemplates()).toHaveLength(2);
  });

  // P3.5: peak/graph/fitModel used to have no serializer at all (this test
  // pinned that refusal, verbatim, until now). Inverted rather than deleted —
  // it now pins the opposite: every name-keyed kind round-trips.
  it("peak, graph, and fit model recipes round-trip through export and import", () => {
    savePeakRecipe({ ...DEFAULT_RECIPE, name: "Peaks" });
    saveGraphTemplate({ name: "Graph", style: "line", overrides: null, seriesStyles: null });
    saveCustomModel({ version: 1, name: "Model", equation: "y=a*x", params: ["a"], guesses: [1], lower: [null], upper: [null] });

    const peakExport = exportNameKeyed("peak", "Peaks");
    const graphExport = exportNameKeyed("graph", "Graph");
    const modelExport = exportNameKeyed("fitModel", "Model");
    expect(peakExport.ok, "peak export").toBe(true);
    expect(graphExport.ok, "graph export").toBe(true);
    expect(modelExport.ok, "fitModel export").toBe(true);
    if (!peakExport.ok || !graphExport.ok || !modelExport.ok) return;

    localStorage.clear();

    expect(importNameKeyed("peak", peakExport.text)).toEqual({ ok: true, name: "Peaks" });
    expect(importNameKeyed("graph", graphExport.text)).toEqual({ ok: true, name: "Graph" });
    expect(importNameKeyed("fitModel", modelExport.text)).toEqual({ ok: true, name: "Model" });

    expect(loadPeakRecipes()[0].find.max_peaks).toBe(DEFAULT_RECIPE.find.max_peaks);
    expect(loadGraphTemplates()[0].style).toBe("line");
    expect(loadCustomModels()[0].equation).toBe("y=a*x");
  });

  // Property-style: parse(serialize(r)) must deep-equal r for a real stored
  // record, field for field — not just "the name came back".
  it("round-trips DEFAULT_RECIPE losslessly through peak export/import", () => {
    const original = { ...DEFAULT_RECIPE, name: "Full peak recipe" };
    savePeakRecipe(original);
    const exported = exportNameKeyed("peak", original.name);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    expect(importNameKeyed("peak", exported.text)).toEqual({ ok: true, name: original.name });
    expect(loadPeakRecipes()[0]).toEqual(original);
  });

  it("round-trips a fit model with null bounds losslessly", () => {
    const original = {
      version: 1 as const,
      name: "Null bounds",
      equation: "y=a*x+b",
      params: ["a", "b"],
      guesses: [1, 2],
      lower: [null, 0],
      upper: [10, null],
    };
    saveCustomModel(original);
    const exported = exportNameKeyed("fitModel", original.name);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    expect(importNameKeyed("fitModel", exported.text)).toEqual({ ok: true, name: original.name });
    expect(loadCustomModels()[0]).toEqual(original);
  });

  it("round-trips a graph template with an Origin source and null overrides losslessly", () => {
    const original = { name: "Origin style", style: "scatter", overrides: null, seriesStyles: null, source: "origin" };
    saveGraphTemplate(original);
    const exported = exportNameKeyed("graph", original.name);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    expect(importNameKeyed("graph", exported.text)).toEqual({ ok: true, name: original.name });
    expect(loadGraphTemplates()[0]).toEqual(original);
  });

  it("round-trips a graph template with populated overrides and series styles losslessly", () => {
    const original = {
      name: "Populated",
      style: "line",
      overrides: { font_size: 12 },
      seriesStyles: [null, { color: "#ff0000" }],
    };
    saveGraphTemplate(original);
    const exported = exportNameKeyed("graph", original.name);
    if (!exported.ok) throw new Error("export failed");
    localStorage.clear();
    expect(importNameKeyed("graph", exported.text)).toEqual({ ok: true, name: original.name });
    expect(loadGraphTemplates()[0]).toEqual(original);
  });

  it("surfaces a parse failure as a refusal, not an exception", () => {
    expect(importNameKeyed("analysis", "{{{ not json").ok).toBe(false);
    expect(importNameKeyed("peak", "{{{ not json").ok).toBe(false);
    expect(importNameKeyed("graph", "{{{ not json").ok).toBe(false);
    expect(importNameKeyed("fitModel", "{{{ not json").ok).toBe(false);
  });

  it("refuses a garbage graph file carrying only name and style — the real shape always has more", () => {
    // A REAL GraphTemplate always serializes both `overrides` and
    // `seriesStyles` (required fields on the type); a file missing both is
    // not something the app's own exporter could ever have produced.
    expect(importNameKeyed("graph", JSON.stringify({ name: "G", style: "line" })).ok).toBe(false);
  });

  it("refuses an empty name on import, for every kind that gained a parser", () => {
    expect(importNameKeyed("peak", JSON.stringify({ ...DEFAULT_RECIPE, name: "" })).ok).toBe(false);
    expect(
      importNameKeyed(
        "graph",
        JSON.stringify({ name: "", style: "line", overrides: null, seriesStyles: null }),
      ).ok,
    ).toBe(false);
    expect(
      importNameKeyed(
        "fitModel",
        JSON.stringify({ version: 1, name: "", equation: "y=x", params: [], guesses: [], lower: [], upper: [] }),
      ).ok,
    ).toBe(false);
  });
});

describe("uniqueTemplateName", () => {
  it("returns the name untouched when free, then walks suffixes", () => {
    expect(uniqueTemplateName("A", new Set())).toBe("A");
    expect(uniqueTemplateName("A", new Set(["A"]))).toBe("A (2)");
    expect(uniqueTemplateName("A", new Set(["A", "A (2)"]))).toBe("A (3)");
  });
});

describe("the adapter table covers exactly the name-keyed kinds", () => {
  it("has an entry per kind and no others", () => {
    // A kind added to the union without an adapter would fail at the type
    // level; this pins the runtime list the UI iterates.
    expect([...NAME_KEYED_KINDS].sort()).toEqual(["analysis", "fitModel", "graph", "peak"]);
  });
});
