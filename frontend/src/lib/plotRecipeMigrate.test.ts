// Plot recipe schema migration (F4.2 / audit P1.3 "version migration beyond
// the v1 parse-gate"): an old recipe still loads on every read boundary, a
// newer one is refused by name, and the v2 fields sanitize like the rest.

import { beforeEach, describe, expect, it } from "vitest";

import { parseRecipe, sanitizeRecipes } from "./plotRecipeIO";
import { migrateRecipeObject, sanitizePreview } from "./plotRecipeMigrate";
import { PLOT_RECIPE_SCHEMA_VERSION } from "./plotRecipeSchema";
import { loadGlobalPlotRecipes } from "./plotRecipeStorage";

/** A recipe exactly as a v1 build wrote it (no preview / outlierPolicy /
 *  transform keys) -- a frozen literal, never produced by today's capture,
 *  so a capture change cannot quietly turn this into a v2 document. */
function v1Recipe(): Record<string, unknown> {
  return {
    id: "old-1",
    name: "XRD from last year",
    description: "saved by a v1 build",
    createdAt: "2026-08-01T00:00:00.000Z",
    modifiedAt: "2026-08-02T00:00:00.000Z",
    schemaVersion: 1,
    provenance: { sourceDatasetLabel: "scan.xy", appVersion: "0.20.0" },
    technique: "xrd.powder",
    signature: [
      { id: "x0", role: "x", label: "2theta", unit: "deg", errorRole: "value", aliases: [] },
      { id: "y0", role: "y", label: "Intensity", unit: "cps", errorRole: "value", aliases: ["I"] },
    ],
    mapping: { xId: "x0", yIds: ["y0"], y2Ids: [], groupId: null, facetId: null, errors: [] },
    visual: { mark: "scatter", xScale: "linear", yScale: "log", plotTemplate: "nature" },
  };
}

describe("migrateRecipeObject", () => {
  it("walks a v1 object forward to the current version, adding the v2 fields as not-recorded", () => {
    const out = migrateRecipeObject(v1Recipe());
    expect("ok" in out).toBe(true);
    if (!("ok" in out)) return;
    expect(out.ok.schemaVersion).toBe(PLOT_RECIPE_SCHEMA_VERSION);
    expect(out.ok.preview).toBeNull();
    expect(out.ok.outlierPolicy).toBeNull();
    expect(out.ok.transform).toBeNull();
    expect(out.ok.signature).toEqual(v1Recipe().signature);
  });

  it("refuses a recipe from a newer build by name instead of guessing", () => {
    const out = migrateRecipeObject({ ...v1Recipe(), schemaVersion: PLOT_RECIPE_SCHEMA_VERSION + 1 });
    expect(out).toEqual({ error: expect.stringMatching(/newer than this app supports/) });
  });

  it("refuses a non-integer or pre-v1 version as unsupported", () => {
    for (const v of [0, 1.5, "1", null, undefined]) {
      const out = migrateRecipeObject({ ...v1Recipe(), schemaVersion: v });
      expect(out).toEqual({ error: expect.stringMatching(/unsupported plot recipe schema version/) });
    }
  });

  it("never mutates its input", () => {
    const input = v1Recipe();
    const before = JSON.stringify(input);
    migrateRecipeObject(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("old recipes still load on every read boundary", () => {
  beforeEach(() => localStorage.clear());

  it("a .dwk / workspace list keeps a v1 entry, migrated, beside a current one", () => {
    const [migrated] = sanitizeRecipes([v1Recipe()]);
    expect(migrated).toMatchObject({
      id: "old-1",
      name: "XRD from last year",
      schemaVersion: PLOT_RECIPE_SCHEMA_VERSION,
      preview: null,
      outlierPolicy: null,
      transform: null,
    });
    // Every v1 field survives the walk.
    expect(migrated.visual.mark).toBe("scatter");
    expect(migrated.visual.yScale).toBe("log");
    expect(migrated.visual.plotTemplate).toBe("nature");
    expect(migrated.signature[1].aliases).toEqual(["I"]);
    // A current-version sibling is untouched by the walk.
    expect(sanitizeRecipes([v1Recipe(), migrated])).toEqual([migrated, migrated]);
  });

  it("an imported v1 file parses", () => {
    expect(parseRecipe(JSON.stringify(v1Recipe())).schemaVersion).toBe(PLOT_RECIPE_SCHEMA_VERSION);
  });

  it("the global localStorage slot keeps a v1 entry", () => {
    localStorage.setItem("qz.plotRecipes", JSON.stringify([v1Recipe()]));
    expect(loadGlobalPlotRecipes().map((r) => r.id)).toEqual(["old-1"]);
  });

  it("an imported file from a newer build throws the named error", () => {
    const newer = JSON.stringify({ ...v1Recipe(), schemaVersion: PLOT_RECIPE_SCHEMA_VERSION + 1 });
    expect(() => parseRecipe(newer)).toThrow(/newer than this app supports/);
  });
});

describe("v2 field sanitizing", () => {
  it("keeps a well-formed preview and clamps coordinates into [0, 1]", () => {
    expect(sanitizePreview({ series: [[[0, 0], [0.5, 1.2], [1, -3]]] })).toEqual({ series: [[[0, 0], [0.5, 1], [1, 0]]] });
  });

  it("drops non-numeric points (markup can never reach the thumbnail)", () => {
    const hostile = { series: [[["<script>", 0], [0.2, 0.3], [NaN, 1], [0.4]], "<svg onload=x>"] };
    expect(sanitizePreview(hostile)).toEqual({ series: [[[0.2, 0.3]]] });
  });

  it("caps series and points so a hand-edited file cannot bloat the project", () => {
    const pts = Array.from({ length: 500 }, (_, i): [number, number] => [i / 499, 0.5]);
    const out = sanitizePreview({ series: Array.from({ length: 9 }, () => pts) });
    expect(out?.series).toHaveLength(4);
    expect(out?.series[0]).toHaveLength(48);
  });

  it("anything that is not a preview object reads as none", () => {
    for (const v of [null, 3, "x", {}, { series: "no" }, { series: [] }]) expect(sanitizePreview(v)).toBeNull();
  });

  it("a malformed outlier policy or transform degrades to null without dropping the recipe", () => {
    const [out] = sanitizeRecipes([
      { ...v1Recipe(), schemaVersion: 2, outlierPolicy: { excludedDisplay: "purple" }, transform: { name: "", revision: "3" } },
    ]);
    expect(out.outlierPolicy).toBeNull();
    expect(out.transform).toBeNull();
    const [ok] = sanitizeRecipes([
      { ...v1Recipe(), schemaVersion: 2, outlierPolicy: { excludedDisplay: "grey" }, transform: { name: "Normalize", revision: 3 } },
    ]);
    expect(ok.outlierPolicy).toEqual({ excludedDisplay: "grey" });
    expect(ok.transform).toEqual({ name: "Normalize", revision: 3 });
  });
});
