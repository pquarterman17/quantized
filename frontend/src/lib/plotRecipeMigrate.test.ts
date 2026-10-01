// Plot recipe schema migration (F4.2 / audit P1.3 "version migration beyond
// the v1 parse-gate"): an old recipe still loads on every read boundary, a
// newer one is refused by name, and the v2 fields sanitize like the rest.

import { beforeEach, describe, expect, it } from "vitest";

import { parseRecipe, sanitizeRecipes } from "./plotRecipeIO";
import { migrateRecipeObject, sanitizeMapView, sanitizePanels, sanitizePreview } from "./plotRecipeMigrate";
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

/** A recipe exactly as a v2 build wrote it (preview / outlierPolicy /
 *  transform present, no panels / map keys) -- frozen, like `v1Recipe`. */
function v2Recipe(): Record<string, unknown> {
  return {
    ...v1Recipe(),
    id: "old-2",
    name: "Two-panel XRD",
    schemaVersion: 2,
    preview: { series: [[[0, 0], [0.5, 0.5], [1, 1]]] },
    outlierPolicy: { excludedDisplay: "grey" },
    transform: { name: "Normalize", revision: 2 },
    visual: { mark: "line", stackMode: true, compositionKind: "spatial" },
  };
}

describe("migrateRecipeObject", () => {
  it("walks a v1 object forward to the current version, adding the v2 and v3 fields as not-recorded", () => {
    const out = migrateRecipeObject(v1Recipe());
    expect("ok" in out).toBe(true);
    if (!("ok" in out)) return;
    expect(out.ok.schemaVersion).toBe(PLOT_RECIPE_SCHEMA_VERSION);
    expect(out.ok.preview).toBeNull();
    expect(out.ok.outlierPolicy).toBeNull();
    expect(out.ok.transform).toBeNull();
    expect(out.ok.panels).toBeNull();
    expect(out.ok.map).toBeNull();
    expect(out.ok.signature).toEqual(v1Recipe().signature);
  });

  // F4.4 SPATIAL: v3 added `panels` + `map`. A v2 recipe was never captured
  // from a spatial window in a way that could be rebuilt, so both read as
  // "not recorded" -- never invented from `compositionKind: "spatial"`.
  it("walks a v2 object forward to v3, adding panels/map as not-recorded and keeping the v2 fields", () => {
    const out = migrateRecipeObject(v2Recipe());
    expect("ok" in out).toBe(true);
    if (!("ok" in out)) return;
    expect(out.ok.schemaVersion).toBe(PLOT_RECIPE_SCHEMA_VERSION);
    expect(out.ok.panels).toBeNull();
    expect(out.ok.map).toBeNull();
    expect(out.ok.preview).toEqual(v2Recipe().preview);
    expect(out.ok.outlierPolicy).toEqual({ excludedDisplay: "grey" });
    expect(out.ok.transform).toEqual({ name: "Normalize", revision: 2 });
    const [loaded] = sanitizeRecipes([v2Recipe()]);
    expect(loaded).toMatchObject({ id: "old-2", schemaVersion: PLOT_RECIPE_SCHEMA_VERSION, panels: null, map: null });
    expect(loaded.visual.compositionKind).toBe("spatial");
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
      panels: null,
      map: null,
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

describe("v3 field sanitizing", () => {
  const panel = {
    dataset: null,
    x: "2theta",
    y: ["Intensity"],
    y2: [],
    xLim: [0, 40],
    yLim: [1, 1000],
    y2Lim: null,
    xStep: 10,
    yStep: null,
    y2Step: null,
    xLog: false,
    yLog: true,
    y2Log: false,
    seriesStyles: {},
    seriesLabels: { Intensity: "I" },
    hiddenChannels: [],
    errKeys: { Intensity: "Ierr" },
    annotations: [],
    regionShades: [],
    row: 0,
    col: 0,
    frameRect: { left: 0, top: 0, width: 1, height: 0.5 },
  };

  it("keeps a well-formed panels payload and defaults its layout fields", () => {
    expect(sanitizePanels({ panels: [panel] })).toEqual({ panels: [panel], panelFit: "frames", pageSetup: null });
    expect(sanitizePanels({ panels: [panel], panelFit: "window" })?.panelFit).toBe("window");
  });

  it("drops a panel without a usable dataset binding, Y series, or limits, and reads no panels as null", () => {
    expect(sanitizePanels({ panels: [{ ...panel, dataset: 3 }] })).toBeNull();
    expect(sanitizePanels({ panels: [{ ...panel, y: [] }] })).toBeNull();
    expect(sanitizePanels({ panels: [{ ...panel, xLim: [0, "40"] }] })).toBeNull();
    expect(sanitizePanels({ panels: [{ ...panel, row: 1.5 }] })).toBeNull();
    for (const v of [null, 4, {}, { panels: "no" }, { panels: [] }]) expect(sanitizePanels(v)).toBeNull();
  });

  it("degrades a bad optional panel field instead of dropping the panel", () => {
    const out = sanitizePanels({ panels: [{ ...panel, xStep: "10", frameRect: { left: 0 }, seriesLabels: { Intensity: 4 } }] });
    expect(out?.panels[0]).toMatchObject({ xStep: null, seriesLabels: {} });
    expect(out?.panels[0].frameRect).toBeUndefined();
  });

  it("keeps a well-formed map view and refuses an unknown colormap", () => {
    expect(sanitizeMapView({ colormap: "magma", logZ: true, colorLimits: [1, 100] })).toEqual({
      colormap: "magma",
      logZ: true,
      colorLimits: [1, 100],
    });
    expect(sanitizeMapView({ colormap: "rainbow", logZ: false, colorLimits: null })).toBeNull();
    expect(sanitizeMapView({ colormap: "gray", logZ: "yes", colorLimits: null })).toBeNull();
    expect(sanitizeMapView({ colormap: "gray", logZ: false, colorLimits: [1] })?.colorLimits).toBeNull();
  });

  it("a malformed panels or map field degrades to null without dropping the recipe", () => {
    const [out] = sanitizeRecipes([{ ...v2Recipe(), schemaVersion: 3, panels: { panels: "x" }, map: 7 }]);
    expect(out.id).toBe("old-2");
    expect(out.panels).toBeNull();
    expect(out.map).toBeNull();
  });
});
