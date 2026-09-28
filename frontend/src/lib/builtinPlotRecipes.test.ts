// PRIMARY_SOFTWARE_AUDIT_PLAN P2.1 — schema-level pins for the built-in
// Plot Recipe set. Store-level apply/confirm/undo/suggestion-surface
// coverage lives in store/plotRecipes.test.ts (the real `useApp` store);
// this file only pins the DATA itself against `plotRecipeSchema.ts`'s
// contract, independent of any store.

import { describe, expect, it } from "vitest";

import { BUILTIN_PLOT_RECIPES, isBuiltinPlotRecipeId } from "./builtinPlotRecipes";
import { PLOT_RECIPE_SCHEMA_VERSION } from "./plotRecipeSchema";

describe("BUILTIN_PLOT_RECIPES", () => {
  it("every entry is a well-formed PlotRecipe on the current schema version", () => {
    for (const r of BUILTIN_PLOT_RECIPES) {
      expect(r.schemaVersion).toBe(PLOT_RECIPE_SCHEMA_VERSION);
      expect(r.id).toMatch(/^builtin:/);
      expect(r.name.trim()).not.toBe("");
      expect(r.technique).not.toBe("generic"); // resolveRecipe refuses generic outright
      // Exactly one Y signature entry, referenced by mapping.yIds, and no
      // other channel role captured (see the module doc: no X entry, so
      // each recipe binds to the target dataset's OWN .time axis).
      expect(r.signature).toHaveLength(1);
      expect(r.signature[0].role).toBe("y");
      expect(r.signature[0].errorRole).toBe("value");
      expect(r.mapping.xId).toBeNull();
      expect(r.mapping.yIds).toEqual([r.signature[0].id]);
      expect(r.mapping.y2Ids).toEqual([]);
      expect(r.mapping.groupId).toBeNull();
      expect(r.mapping.facetId).toBeNull();
      expect(r.mapping.errors).toEqual([]);
    }
  });

  it("ids are unique", () => {
    const ids = BUILTIN_PLOT_RECIPES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("XRD θ–2θ and XRR both use a log Y axis; M(H) stays linear (lib/techniqueDefaults.ts's own table, ported verbatim)", () => {
    const byTechnique = new Map(BUILTIN_PLOT_RECIPES.map((r) => [r.technique, r]));
    expect(byTechnique.get("xrd.powder")?.visual.yScale).toBe("log");
    expect(byTechnique.get("reflectometry")?.visual.yScale).toBe("log");
    expect(byTechnique.get("magnetometry.mvsh")?.visual.yScale).toBe("linear");
  });

  it("the M(H) loop carries exactly the H=0 and M=0 zero lines; the other two carry none", () => {
    const byTechnique = new Map(BUILTIN_PLOT_RECIPES.map((r) => [r.technique, r]));
    expect(byTechnique.get("magnetometry.mvsh")?.visual.refLines).toEqual([
      { id: "builtin-zero-h", axis: "x", value: 0 },
      { id: "builtin-zero-m", axis: "y", value: 0 },
    ]);
    expect(byTechnique.get("xrd.powder")?.visual.refLines).toEqual([]);
    expect(byTechnique.get("reflectometry")?.visual.refLines).toEqual([]);
  });

  it("no fixed/symmetric range is set on any axis -- a real symmetric sweep already renders symmetric under 'auto'", () => {
    for (const r of BUILTIN_PLOT_RECIPES) {
      expect(r.visual.xRange).toEqual({ mode: "auto" });
      expect(r.visual.yRange).toEqual({ mode: "auto" });
    }
  });
});

describe("isBuiltinPlotRecipeId", () => {
  it("is true for every built-in's own id and false for an ordinary saved recipe id", () => {
    for (const r of BUILTIN_PLOT_RECIPES) expect(isBuiltinPlotRecipeId(r.id)).toBe(true);
    expect(isBuiltinPlotRecipeId("pr-abc123-1")).toBe(false);
    expect(isBuiltinPlotRecipeId("gpr-abc123-1")).toBe(false);
    expect(isBuiltinPlotRecipeId("")).toBe(false);
  });
});
