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

  it("reports the kinds that genuinely have no serializer, rather than inventing one", () => {
    for (const kind of ["peak", "graph", "fitModel"] as const) {
      expect(exportNameKeyed(kind, "anything")).toEqual({
        ok: false,
        reason: `${kind} recipes cannot be exported yet`,
      });
      expect(importNameKeyed(kind, "{}")).toEqual({
        ok: false,
        reason: `${kind} recipes cannot be imported yet`,
      });
    }
  });

  it("surfaces a parse failure as a refusal, not an exception", () => {
    expect(importNameKeyed("analysis", "{{{ not json").ok).toBe(false);
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
