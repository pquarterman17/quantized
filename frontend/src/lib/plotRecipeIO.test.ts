// P1.3 plot recipe persistence/parsing boundary (plotRecipeIO.ts):
// parseRecipe (strict, throws) and sanitizeRecipes (tolerant, never throws).

import { describe, expect, it } from "vitest";

import { captureRecipe, serializeRecipe, type PlotRecipe } from "./plotRecipe";
import { parseRecipe, sanitizeRecipes } from "./plotRecipeIO";
import { defaultPlotView, type PlotView } from "./plotview";
import type { Dataset } from "./types";

function xrdDataset(): Dataset {
  return {
    id: "d1",
    name: "xrd-scan.xy",
    data: {
      time: [0, 1, 2],
      values: [[10, 100, 1], [20, 200, 2], [30, 300, 3]],
      labels: ["2theta", "Intensity", "Ierr"],
      units: ["deg", "cps", "cps"],
      metadata: { technique: "xrd.powder" },
    },
  };
}

function view(overrides: Partial<PlotView> = {}): PlotView {
  return { ...defaultPlotView(), ...overrides };
}

function goodRecipe(): PlotRecipe {
  return captureRecipe(xrdDataset(), view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 } }), null, {
    id: "r1",
    name: "XRD standard",
    appVersion: "0",
    now: () => "2026-08-22T00:00:00.000Z",
  });
}

describe("parseRecipe", () => {
  it("round-trips a serialized recipe unchanged", () => {
    const r = goodRecipe();
    expect(parseRecipe(serializeRecipe(r))).toEqual(r);
  });

  it("throws a clear message on invalid JSON", () => {
    expect(() => parseRecipe("{not json")).toThrow(/bad JSON/);
  });

  it("throws on a non-object document", () => {
    expect(() => parseRecipe("42")).toThrow(/not a plot recipe file/);
  });

  it("throws a named error on an unsupported schema version", () => {
    const bad = { ...goodRecipe(), schemaVersion: 2 };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow(/unsupported plot recipe schema version: 2/);
  });

  it("throws when the signature/mapping is structurally malformed", () => {
    const bad = { ...goodRecipe(), signature: "not an array" };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow(/malformed/);
  });

  it("tolerates and drops unknown extra top-level keys", () => {
    const withExtra = { ...goodRecipe(), somethingFromTheFuture: { nested: true } };
    const parsed = parseRecipe(JSON.stringify(withExtra));
    expect(parsed).toEqual(goodRecipe());
    expect("somethingFromTheFuture" in parsed).toBe(false);
  });
});

describe("sanitizeRecipes", () => {
  it("round-trips a well-formed recipe list unchanged", () => {
    const r = goodRecipe();
    const out = sanitizeRecipes(JSON.parse(JSON.stringify([r])));
    expect(out).toEqual([r]);
  });

  it("is not an array -> empty list, never throws", () => {
    expect(sanitizeRecipes(null)).toEqual([]);
    expect(sanitizeRecipes("nope")).toEqual([]);
    expect(sanitizeRecipes(42)).toEqual([]);
  });

  it("drops an entry with the wrong schema version without dropping its siblings", () => {
    const good = goodRecipe();
    const wrongVersion = { ...good, id: "r2", schemaVersion: 99 };
    const out = sanitizeRecipes([wrongVersion, good]);
    expect(out).toEqual([good]);
  });

  it("drops an entry with a corrupt signature (dangling ids would break every downstream reference)", () => {
    const good = goodRecipe();
    const corrupt = { ...good, id: "r3", signature: [{ id: "x0" /* missing role/label/unit/errorRole */ }] };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("drops an entry with a malformed mapping (yIds not an array of strings)", () => {
    const good = goodRecipe();
    const corrupt = { ...good, id: "r4", mapping: { ...good.mapping, yIds: [1, 2, 3] } };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("drops an entry with an unrecognized technique string", () => {
    const good = goodRecipe();
    const corrupt = { ...good, id: "r5", technique: "not-a-real-technique" };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("degrades a malformed visual payload to safe defaults rather than dropping the whole recipe", () => {
    const good = goodRecipe();
    const partiallyCorrupt = { ...good, id: "r6", visual: { ...good.visual, legendPos: "off-screen", mark: "not-a-mark" } };
    const [out] = sanitizeRecipes([partiallyCorrupt]);
    expect(out).toBeDefined();
    expect(out.mapping).toEqual(good.mapping); // identity/signature/mapping untouched
    expect(out.visual.legendPos).toBe("ne"); // bad value -> default
    expect(out.visual.mark).toBe("line"); // bad value -> default
  });

  it("tolerates and drops unknown extra keys per entry", () => {
    const good = goodRecipe();
    const withExtra = { ...good, extraField: "from a future app version" };
    const [out] = sanitizeRecipes([withExtra]);
    expect(out).toEqual(good);
  });

  it("never throws on deeply malformed junk", () => {
    expect(() => sanitizeRecipes([null, undefined, 42, "str", {}, [], { schemaVersion: 1 }])).not.toThrow();
    expect(sanitizeRecipes([null, undefined, 42, "str", {}, [], { schemaVersion: 1 }])).toEqual([]);
  });
});
