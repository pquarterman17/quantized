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
    const r = captureRecipe(
      xrdDataset(),
      view({ xKey: 0, yKeys: [1], errKeys: { 1: 2 }, legendSize: [240, 160] }),
      null,
      { id: "r1", name: "XRD standard", appVersion: "0" },
    );
    expect(parseRecipe(serializeRecipe(r))).toEqual(r);
    expect(r.visual.legendSize).toEqual([240, 160]);
  });

  it("throws a clear message on invalid JSON", () => {
    expect(() => parseRecipe("{not json")).toThrow(/bad JSON/);
  });

  it("throws on a non-object document", () => {
    expect(() => parseRecipe("42")).toThrow(/not a plot recipe file/);
  });

  it("throws a named error on an unsupported schema version", () => {
    const bad = { ...goodRecipe(), schemaVersion: 0 };
    expect(() => parseRecipe(JSON.stringify(bad))).toThrow(/unsupported plot recipe schema version: 0/);
  });

  it("throws a named error on a schema version newer than this build (v2 is now current, v1 migrates)", () => {
    const newer = { ...goodRecipe(), schemaVersion: 3 };
    expect(() => parseRecipe(JSON.stringify(newer))).toThrow(/schema version 3 is newer than this app supports/);
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

  it("sanitizes saved legend dimensions at the recipe boundary", () => {
    const good = goodRecipe();
    const [clamped] = sanitizeRecipes([{ ...good, visual: { ...good.visual, legendSize: [12, 9000] } }]);
    expect(clamped.visual.legendSize).toEqual([96, 2000]);

    const [malformed] = sanitizeRecipes([{ ...good, visual: { ...good.visual, legendSize: [240, "wide"] } }]);
    expect(malformed.visual.legendSize).toBeNull();
  });

  it("drops a recipe whose mapping references a signature id that doesn't exist (finding 2a)", () => {
    const good = goodRecipe();
    const corrupt: PlotRecipe = { ...good, id: "r7", mapping: { ...good.mapping, xId: "nonexistent-id" } };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("drops a recipe whose mapping.errors channel/target references a signature id that doesn't exist (finding 2a)", () => {
    const good = goodRecipe();
    const corrupt: PlotRecipe = {
      ...good,
      id: "r8",
      mapping: { ...good.mapping, errors: [{ channel: "nonexistent-id", target: good.mapping.yIds[0], axis: "y", side: "both" }] },
    };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("drops a recipe whose signature has duplicate entry ids (finding 2a)", () => {
    const good = goodRecipe();
    const duplicated = good.signature.map((e, i) => (i === 1 ? { ...e, id: good.signature[0].id } : e));
    const corrupt: PlotRecipe = { ...good, id: "r9", signature: duplicated };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
  });

  it("drops an entry whose name is whitespace-only, matching parseRecipe's trim rule (finding 4)", () => {
    const good = goodRecipe();
    const corrupt: PlotRecipe = { ...good, id: "r10", name: "   " };
    expect(sanitizeRecipes([corrupt, good])).toEqual([good]);
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

// P2.1: `visual.refLines` was added ADDITIVELY (no PLOT_RECIPE_SCHEMA_VERSION
// bump -- see plotRecipeSchema.ts's own doc on the field). These pins are
// what makes that claim true rather than assumed: an OLDER recipe missing
// the field entirely must still sanitize cleanly to `[]`, never get dropped.
describe("sanitizeRecipes — refLines (additive field, P2.1)", () => {
  it("an OLDER persisted recipe with no refLines field at all sanitizes to []  (never dropped, never throws)", () => {
    const good = goodRecipe();
    const legacy = { ...good } as Record<string, unknown>;
    const legacyVisual = { ...(legacy.visual as Record<string, unknown>) };
    delete legacyVisual.refLines;
    legacy.visual = legacyVisual;

    const [out] = sanitizeRecipes([legacy]);
    expect(out).toBeDefined();
    expect(out.visual.refLines).toEqual([]);
    expect(() => parseRecipe(JSON.stringify(legacy))).not.toThrow();
    expect(parseRecipe(JSON.stringify(legacy)).visual.refLines).toEqual([]);
  });

  it("drops a malformed refLine entry but keeps the well-formed ones alongside it", () => {
    const good = goodRecipe();
    const corrupt = {
      ...good,
      visual: {
        ...good.visual,
        refLines: [
          { id: "ok", axis: "x", value: 5 },
          { id: "bad-axis", axis: "z", value: 1 },
          { id: "bad-value", axis: "y", value: "not a number" },
          { axis: "y", value: 2 }, // missing id
        ],
      },
    };
    const [out] = sanitizeRecipes([corrupt]);
    expect(out.visual.refLines).toEqual([{ id: "ok", axis: "x", value: 5 }]);
  });

  it("a non-array refLines value degrades to [] rather than dropping the recipe", () => {
    const good = goodRecipe();
    const corrupt = { ...good, visual: { ...good.visual, refLines: "not an array" } };
    const [out] = sanitizeRecipes([corrupt]);
    expect(out.visual.refLines).toEqual([]);
  });

  // FINDING 4 (code-review): a duplicate id makes `removeRefLine`/
  // `updateRefLine` (both keyed by id) act on every line sharing it at once
  // instead of the one the caller meant -- a hand-edited or otherwise
  // corrupt persisted list with a collision is defused HERE, at the
  // untrusted boundary, same "drop the bad one, keep the rest" convention
  // the other malformed-entry cases above already use.
  it("drops a later entry that repeats an id already kept, keeping the first occurrence", () => {
    const good = goodRecipe();
    const corrupt = {
      ...good,
      visual: {
        ...good.visual,
        refLines: [
          { id: "dup", axis: "x", value: 1 },
          { id: "dup", axis: "y", value: 99 }, // same id, would collide live
          { id: "ok", axis: "y", value: 2 },
        ],
      },
    };
    const [out] = sanitizeRecipes([corrupt]);
    expect(out.visual.refLines).toEqual([
      { id: "dup", axis: "x", value: 1 },
      { id: "ok", axis: "y", value: 2 },
    ]);
  });
});

// FINDING 7 (code-review): `noAutoSuggest` is ANOTHER additive field (no
// PLOT_RECIPE_SCHEMA_VERSION bump), same convention as refLines above --
// absent on an older/ordinary recipe means "eligible for auto-suggestion".
describe("sanitizeRecipes / parseRecipe — noAutoSuggest (additive field, finding 7)", () => {
  it("an ordinary recipe with no noAutoSuggest field at all sanitizes with the field simply absent", () => {
    const good = goodRecipe();
    const [out] = sanitizeRecipes([good]);
    expect(out.noAutoSuggest).toBeUndefined();
    expect(parseRecipe(JSON.stringify(good)).noAutoSuggest).toBeUndefined();
  });

  it("a recipe flagged noAutoSuggest: true keeps the flag through both sanitizeRecipes and parseRecipe", () => {
    const flagged = { ...goodRecipe(), noAutoSuggest: true };
    const [out] = sanitizeRecipes([flagged]);
    expect(out.noAutoSuggest).toBe(true);
    expect(parseRecipe(JSON.stringify(flagged)).noAutoSuggest).toBe(true);
  });

  it("a non-boolean noAutoSuggest value is dropped, never coerced to true", () => {
    const corrupt = { ...goodRecipe(), noAutoSuggest: "yes" };
    const [out] = sanitizeRecipes([corrupt]);
    expect(out.noAutoSuggest).toBeUndefined();
  });
});
