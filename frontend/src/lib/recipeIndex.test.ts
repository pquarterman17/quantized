// P3.5 slice 1 — the contract's identity rules and the sidecar index.
//
// The three things worth testing here are the three that quietly lose user
// data if wrong: ref-key escaping (two recipes colliding on one key means one
// inherits the other's favorites), rename carrying metadata across a
// name-keyed system's identity change, and prune refusing to run on an
// incomplete read.

import { beforeEach, describe, expect, it } from "vitest";

import {
  loadIndex,
  metaFor,
  moveEntry,
  pruneEntries,
  recordUse,
  setFavorite,
  setTags,
} from "./recipeIndex";
import { isKnownStorageKey } from "./storageKeys";
import {
  parseRefKey,
  RECIPE_CAPABILITIES,
  supportsOperation,
  RECIPE_KINDS,
  type RecipeRef,
  refKey,
} from "./recipeLibrary";

const ref = (
  id: string,
  kind: RecipeRef["kind"] = "analysis",
  scope: RecipeRef["scope"] = "global",
): RecipeRef => ({
  kind,
  scope,
  id,
});

beforeEach(() => {
  localStorage.clear();
});

describe("ref identity", () => {
  it("escapes a separator in a name-derived id so two recipes cannot collide", () => {
    // Name-keyed ids are user-typed. Without escaping, "a:global:b" and
    // "a" + "global:b" flatten to the same key and one recipe silently
    // inherits the other's favorite and tags.
    const a = refKey(ref("XRD: run 7"));
    const b = refKey(ref("XRD"));
    expect(a).not.toBe(b);
    expect(a.split(":").length).toBe(3);
  });

  it("round-trips every kind, including ids with separators and percent signs", () => {
    for (const kind of RECIPE_KINDS) {
      for (const id of ["plain", "with: colon", "100%", "a/b?c#d", "émile"]) {
        const r: RecipeRef = { kind, scope: "project", id };
        expect(parseRefKey(refKey(r))).toEqual(r);
      }
    }
  });

  it("returns null for malformed keys rather than throwing", () => {
    // These round-trip through localStorage, where truncation and hand
    // editing are normal things to survive.
    for (const bad of ["", "nope", "a:b", "bogusKind:global:x", "plot:nowhere:x", "plot:global:%E0%A4%A"]) {
      expect(parseRefKey(bad)).toBeNull();
    }
  });
});

describe("capability table is honest about what each system can do", () => {
  it("the four name-keyed systems admit they have no stable id", () => {
    // Their save/delete functions key on name (lib/template.ts et al), so a
    // rename genuinely destroys identity — `stableId` must keep saying so.
    //
    // `canRename` used to be false here for the reason stated in the original
    // version of this test: "a Library offering Rename on them would be
    // offering to silently orphan metadata." P3.5 removed that condition
    // rather than the concern — `lib/nameKeyedRecipes.renameNameKeyed` carries
    // the sidecar across with `recipeIndex.moveEntry`, and there is a test
    // that the favorites and tags survive. So rename is offered now, and
    // `stableId` still reports the underlying truth. The two flags answer
    // different questions and this is exactly the case that separates them.
    for (const kind of ["analysis", "peak", "graph", "fitModel"] as const) {
      expect(RECIPE_CAPABILITIES[kind].stableId, kind).toBe(false);
      expect(RECIPE_CAPABILITIES[kind].canRename, kind).toBe(true);
      expect(RECIPE_CAPABILITIES[kind].scopes, kind).toEqual(["global"]);
    }
  });

  it("supportsOperation refuses what genuinely is not built", () => {
    // The table is only worth having if a `false` reaches the UI. These are
    // the ones that must stay refused until something real backs them.
    expect(supportsOperation("quickPlot", "duplicate")).toBe(false);
    for (const kind of ["peak", "graph", "fitModel"] as const) {
      expect(supportsOperation(kind, "export"), kind).toBe(false);
      expect(supportsOperation(kind, "import"), kind).toBe(false);
    }
    // Only `plot` lives in two scopes, so only `plot` can be copied between
    // them — derived from `scopes`, never a second flag to drift.
    for (const kind of RECIPE_KINDS) {
      expect(supportsOperation(kind, "copyScope"), kind).toBe(kind === "plot");
    }
    // Apply and delete are universal, and every kind was checked by hand.
    for (const kind of RECIPE_KINDS) {
      expect(supportsOperation(kind, "apply"), kind).toBe(true);
      expect(supportsOperation(kind, "delete"), kind).toBe(true);
    }
  });

  it("plot recipes are the reference implementation and say so", () => {
    const c = RECIPE_CAPABILITIES.plot;
    expect(c.stableId).toBe(true);
    expect(c.scopes).toEqual(["project", "global"]);
    expect(c.canRename && c.canDuplicate && c.canImportExport).toBe(true);
  });

  it("every kind has a capability entry", () => {
    for (const kind of RECIPE_KINDS) expect(RECIPE_CAPABILITIES[kind]).toBeDefined();
  });
});

describe("sidecar metadata", () => {
  it("its storage slot is on the diagnostics allowlist", () => {
    // Not merely tidiness: an unvetted slot is reported to a support bundle
    // as an anonymous "unrecognised" row (lib/storageKeys.ts), so a quota
    // complaint would arrive without the one line naming the culprit. The
    // architecture ratchet enforces registration; this says why it matters.
    expect(isKnownStorageKey("qz.recipeIndex")).toBe(true);
  });


  it("stores and reads back a favorite without touching the recipe itself", () => {
    setFavorite(ref("t1"), true);
    expect(metaFor(ref("t1")).favorite).toBe(true);
    // The recipe's own storage slot is untouched — this is a sidecar.
    expect(localStorage.getItem("qz.analysisTemplates")).toBeNull();
  });

  it("drops an entry that no longer carries anything", () => {
    setFavorite(ref("t1"), true);
    setFavorite(ref("t1"), false);
    expect(Object.keys(loadIndex())).toEqual([]);
  });

  it("normalizes tags: trims, dedupes, drops empties, caps the count", () => {
    setTags(ref("t1"), ["  a  ", "a", "", "   ", "b", ...Array.from({ length: 30 }, (_, i) => `t${i}`)]);
    const tags = metaFor(ref("t1")).tags;
    expect(tags.slice(0, 3)).toEqual(["a", "b", "t0"]);
    expect(tags.length).toBeLessThanOrEqual(12);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it("counts uses with an injected clock", () => {
    recordUse(ref("t1"), "2026-08-30T10:00:00.000Z");
    recordUse(ref("t1"), "2026-08-30T11:00:00.000Z");
    const m = metaFor(ref("t1"));
    expect(m.useCount).toBe(2);
    expect(m.lastUsedAt).toBe("2026-08-30T11:00:00.000Z");
  });

  it("survives a corrupt stored value instead of losing the whole index", () => {
    localStorage.setItem("qz.recipeIndex", "{not json");
    expect(loadIndex()).toEqual({});
    setFavorite(ref("t1"), true);
    expect(metaFor(ref("t1")).favorite).toBe(true);
  });
});

describe("rename carries metadata across a name-keyed identity change", () => {
  it("moves favorite, tags and use count to the new name", () => {
    setFavorite(ref("old"), true);
    setTags(ref("old"), ["xrd"]);
    recordUse(ref("old"), "2026-08-30T10:00:00.000Z");

    moveEntry(ref("old"), ref("new"));

    expect(metaFor(ref("old"))).toEqual({ favorite: false, tags: [], useCount: 0 });
    const moved = metaFor(ref("new"));
    expect(moved.favorite).toBe(true);
    expect(moved.tags).toEqual(["xrd"]);
    expect(moved.useCount).toBe(1);
  });

  it("merges rather than clobbers when renaming onto an occupied name", () => {
    // Those systems upsert by name, so renaming onto an existing name is a
    // real thing a user can do; losing the destination's metadata would be a
    // second surprise on top of the overwrite they already accepted.
    setTags(ref("dest"), ["keep"]);
    recordUse(ref("dest"), "2026-08-30T09:00:00.000Z");
    setTags(ref("src"), ["bring"]);
    recordUse(ref("src"), "2026-08-30T12:00:00.000Z");

    moveEntry(ref("src"), ref("dest"));

    const m = metaFor(ref("dest"));
    expect([...m.tags].sort()).toEqual(["bring", "keep"]);
    expect(m.useCount).toBe(2);
    expect(m.lastUsedAt).toBe("2026-08-30T12:00:00.000Z");
  });

  it("is a no-op for an unknown source or a self-move", () => {
    setFavorite(ref("a"), true);
    moveEntry(ref("missing"), ref("b"));
    moveEntry(ref("a"), ref("a"));
    expect(metaFor(ref("a")).favorite).toBe(true);
    expect(metaFor(ref("b")).favorite).toBe(false);
  });
});

describe("pruning refuses to run on an incomplete read", () => {
  it("drops the recency of recipes that are really gone", () => {
    recordUse(ref("live"), "2026-08-30T10:00:00.000Z");
    recordUse(ref("dead"), "2026-08-30T10:00:00.000Z");
    const dropped = pruneEntries(new Set([refKey(ref("live"))]), true);
    expect(dropped).toBe(1);
    expect(metaFor(ref("live")).useCount).toBe(1);
    expect(metaFor(ref("dead")).useCount).toBe(0);
  });

  it("KEEPS a favorite whose recipe can still come back, and says so in the count", () => {
    // Same rule `save` applies under quota pressure: keep what the user chose,
    // shed what the app derived — but ONLY where an undo could return the
    // recipe to claim it. A project-scope plot recipe is that case.
    const undoable = ref("p1", "plot", "project");
    setFavorite(undoable, true);
    setTags(undoable, ["keep"]);
    recordUse(undoable, "2026-08-30T10:00:00.000Z");

    const dropped = pruneEntries(new Set<string>(), true);

    expect(metaFor(undoable).favorite).toBe(true);
    expect(metaFor(undoable).tags).toEqual(["keep"]);
    expect(metaFor(undoable).useCount, "the derived half still goes").toBe(0);
    expect(dropped, "an entry stripped of recency was not FORGOTTEN").toBe(0);
  });

  it("DROPS a favorite outright when the recipe can never come back", () => {
    // The asymmetry is the point. An analysis template's delete is not
    // undoable, and the four name-keyed kinds key this index BY NAME — so a
    // kept orphan would live forever AND be inherited by the next recipe saved
    // under that name. Workshop-side deletes never reach `dropEntry`, so this
    // prune is the only thing that ever cleans up after them.
    setFavorite(ref("gone"), true);
    setTags(ref("gone"), ["stale"]);

    expect(pruneEntries(new Set<string>(), true)).toBe(1);
    expect(metaFor(ref("gone")).favorite).toBe(false);
    expect(metaFor(ref("gone")).tags).toEqual([]);
  });

  it("drops an orphan whose key cannot be parsed", () => {
    // Every live key is built by `refKey`, so an unparseable one cannot match
    // a live recipe; keeping it would leak with no upside.
    localStorage.setItem("qz.recipeIndex", JSON.stringify({ "not-a-valid-key": { favorite: true, tags: [], useCount: 0 } }));
    expect(pruneEntries(new Set<string>(), true)).toBe(1);
  });

  it("survives delete-then-undo of a favorited recipe (the regression)", () => {
    // The Library prunes whenever the live recipe set changes, and deleting a
    // plot recipe changes it — so with the old behaviour the star was gone
    // before the user could press Ctrl+Z, and the undo brought the recipe
    // back stripped of it.
    const undoable = ref("p1", "plot", "project");
    setFavorite(undoable, true);
    pruneEntries(new Set<string>(), true); // the delete's prune
    pruneEntries(new Set([refKey(undoable)]), true); // the undo restores it
    expect(metaFor(undoable).favorite).toBe(true);
  });

  it("does nothing at all when the caller cannot vouch for the list", () => {
    // Every source reader returns [] both for "empty" and for "storage
    // threw". Pruning against a failed read would wipe metadata for recipes
    // that are merely missing from THIS read — the failure this flag exists
    // to prevent.
    //
    // The sentinel MUST be recency, not a favorite. This test used to seed
    // bare favorites, which stopped discriminating the moment favorites began
    // surviving every prune: the guard could be deleted outright and the test
    // still passed (measured — mutation testing killed it). Recency is now
    // the only thing a prune destroys, so it is the only honest sentinel.
    setFavorite(ref("starred"), true);
    recordUse(ref("starred"), "2026-08-30T10:00:00.000Z");
    recordUse(ref("plain"), "2026-08-30T10:00:00.000Z");

    const dropped = pruneEntries(new Set<string>(), false);

    expect(dropped).toBe(0);
    expect(metaFor(ref("starred")).useCount, "recency must survive a refused prune").toBe(1);
    expect(metaFor(ref("plain")).useCount, "a bare entry must not be dropped either").toBe(1);
  });
});
