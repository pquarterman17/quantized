// PRIMARY_SOFTWARE_AUDIT_PLAN P2.1 — schema-level pins for the built-in
// Plot Recipe set. Store-level apply/confirm/undo/suggestion-surface
// coverage lives in store/plotRecipes.test.ts (the real `useApp` store);
// this file only pins the DATA itself against `plotRecipeSchema.ts`'s
// contract, independent of any store.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { BUILTIN_PLOT_RECIPES, isBuiltinPlotRecipeId } from "./builtinPlotRecipes";
import { resolveRecipe } from "./plotRecipeMatch";
import { PLOT_RECIPE_SCHEMA_VERSION } from "./plotRecipeSchema";
import type { Dataset } from "./types";

/** A minimal `Dataset` shaped exactly like one real parser's OUTPUT --
 *  `labels`/`units` are the VALUE channels only (the x axis is whatever the
 *  parser calls its own `.time`, irrelevant to a Y-only built-in recipe's
 *  resolve), `technique` is the tag `io/technique.py` actually stamps for
 *  that parser. Row count/values are arbitrary -- `resolveRecipe` never
 *  reads them, only `labels`/`units`/`metadata.technique`. */
function parserShapedDataset(labels: string[], units: string[], technique: string): Dataset {
  const rows = 3;
  return {
    id: "d1",
    name: "d1",
    data: {
      time: [0, 1, 2],
      values: Array.from({ length: rows }, (_, i) => labels.map((_, ch) => i + ch)),
      labels,
      units,
      metadata: { technique },
    },
  };
}

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../");
const readIo = (name: string): string => readFileSync(join(REPO_ROOT, "src/quantized/io", name), "utf-8");

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

  it("XRD θ–2θ and reflectometry both use a log Y axis; M(H) stays linear (lib/techniqueDefaults.ts's own table, ported verbatim)", () => {
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

// FINDINGS 1+2 (code-review): the reflectometry built-in's labels/aliases
// verified against the ACTUAL reflectometry parsers -- resolving against a
// minimal Dataset shaped exactly like each one's real output, not merely
// asserted by name. Lab X-ray XRR is deliberately NOT one of these cases: it
// arrives through the XRD parsers (Bruker/rigaku/xrdml) and is tagged
// "xrd.powder", not "reflectometry" -- see the recipe's own updated
// description and `io/technique.py`'s `_STATIC_TECHNIQUE_BY_PARSER` table.
describe("reflectometry recipe resolves against real parser shapes (findings 1+2)", () => {
  const xrr = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "reflectometry")!;

  it("is named/described honestly -- no longer claims to be an XRR recipe, and points lab XRR at the XRD recipe", () => {
    expect(xrr.name).not.toMatch(/XRR/i);
    expect(xrr.description).toMatch(/xrd\.powder/);
    expect(xrr.description.toLowerCase()).toContain("lab");
  });

  it("resolves CLEANLY against io/ncnr.py's import_ncnr_refl (.refl) shape -- columns [Qz, Intensity, uncertainty, resolution]", () => {
    // Verified against tests/fixtures/baselines/xrr_bilayer_kiessig.refl's
    // own header: # "columns": ["Qz", "Intensity", "uncertainty", "resolution"]
    const ds = parserShapedDataset(
      ["Intensity", "uncertainty", "resolution"],
      ["arb. units", "arb. units", "1/Ang"],
      "reflectometry",
    );
    const res = resolveRecipe(xrr, ds);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping.yKeys).toEqual([0]); // "Intensity" -- never "uncertainty"/"resolution"
  });

  it("resolves CLEANLY against io/ncnr.py's import_ncnr_dat (.datA-.datD) shape -- _NCNR_DAT_LABELS", () => {
    const ds = parserShapedDataset(
      ["dQ", "R", "dR", "theory", "fresnel"],
      ["1/A", "", "", "", ""],
      "reflectometry",
    );
    const res = resolveRecipe(xrr, ds);
    if (!("resolved" in res)) throw new Error(`expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping.yKeys).toEqual([1]); // "R" -- never dQ/dR/theory/fresnel
  });

  it("resolves CLEANLY against a single non-spin-flip channel of io/ncnr.py's import_ncnr_pnr (.pnr) shape", () => {
    // `_clean_polarization` turns a raw "R++"/"R--" header into "Rpp"/"Rmm" --
    // verified against tests/fixtures/baselines/pnr_bilayer_spin_pair.pnr's
    // own header row (Q dQ R++ dR++ R-- dR--). Each spin channel is checked
    // in isolation here (never both at once -- see the very real ambiguity
    // case below).
    for (const label of ["Rpp", "Rmm", "Rpm", "Rmp"]) {
      const ds = parserShapedDataset([label], ["arb. units"], "reflectometry");
      const res = resolveRecipe(xrr, ds);
      if (!("resolved" in res)) throw new Error(`"${label}": expected a resolved result, got refusal: ${res.refused}`);
      expect(res.unmatched).toEqual([]);
      expect(res.resolved.mapping.yKeys).toEqual([0]);
    }
  });

  it("a REAL .pnr file's BOTH spin channels present at once is a genuine ambiguity, not a false refusal", () => {
    // findChannel (plotRecipeMatch.ts) never guesses between two equally
    // plausible alias matches -- this is the SAME "never guess" contract
    // every other recipe already relies on, not a gap this fix could (or
    // should) paper over: nothing in the file says which spin channel the
    // person wants plotted by default.
    const ds = parserShapedDataset(
      ["dQ", "Rpp", "dRpp", "Rmm", "dRmm"],
      ["A-1", "arb. units", "arb. units", "arb. units", "arb. units"],
      "reflectometry",
    );
    const res = resolveRecipe(xrr, ds);
    if (!("resolved" in res)) throw new Error(`expected a resolved (ambiguous-unmatched) result, got refusal: ${res.refused}`);
    expect(res.unmatched.length).toBeGreaterThan(0);
  });

  it("still refuses outright against an unrelated technique (never a silent cross-technique match)", () => {
    const ds = parserShapedDataset(["Intensity"], ["counts"], "xrd.powder");
    const res = resolveRecipe(xrr, ds);
    expect("refused" in res).toBe(true);
  });
});

// GUARD (finding 1+2's own ask: "a guard test that reads the parsers' label
// constants where possible") -- reads the ACTUAL Python source so a future
// rename of these constants fails HERE, at the alias list, rather than
// silently drifting the recipe out of sync with what the parsers really emit.
describe("reflectometry/M(H) aliases guarded against the real io/ source (findings 1+2+3)", () => {
  const ncnrPy = readIo("ncnr.py");
  const qdPy = readIo("qd.py");

  it("io/ncnr.py's polarization-cleaning table still spells the non-spin-flip/spin-flip channels this recipe aliases", () => {
    expect(ncnrPy).toContain('("++", "pp")');
    expect(ncnrPy).toContain('("--", "mm")');
    expect(ncnrPy).toContain('("+-", "pm")');
    expect(ncnrPy).toContain('("-+", "mp")');
  });

  it("io/ncnr.py's refl1d-fit cross-section label list still names 'R'", () => {
    expect(ncnrPy).toContain('_NCNR_DAT_LABELS = ["dQ", "R", "dR", "theory", "fresnel"]');
  });

  it("io/qd.py's MPMS3 DC-moment fallback columns and AC-moment shorthand still spell what the M(H) recipe aliases", () => {
    expect(qdPy).toContain('_DC_MOMENT_FALLBACKS = ("DC Moment Free Ctr", "DC Moment Fixed Ctr")');
    expect(qdPy).toContain('"acmoment": "AC Moment"');
  });

  it("the reflectometry recipe's alias list covers every label the guard above just verified", () => {
    const xrr = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "reflectometry")!;
    for (const alias of ["reflectivity", "refl", "Intensity", "Rpp", "Rmm", "Rpm", "Rmp"]) {
      expect(xrr.signature[0].aliases).toContain(alias);
    }
  });

  it("the M(H) recipe's alias list covers every VSM/MPMS/PPMS moment label io/ emits (finding 3)", () => {
    const mh = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "magnetometry.mvsh")!;
    for (const alias of ["moment", "dc moment", "m", "AC Moment", "DC Moment Free Ctr", "DC Moment Fixed Ctr"]) {
      expect(mh.signature[0].aliases).toContain(alias);
    }
  });
});

// FINDING 3 (code-review): every magnetometry moment label io/qd.py (VSM/
// PPMS/MPMS) and io/lakeshore.py (Lake Shore VSM) actually emit, resolved
// against a minimal Dataset shaped like each one's real output.
describe("M(H) recipe resolves against every real VSM/MPMS/PPMS moment label (finding 3)", () => {
  const mh = BUILTIN_PLOT_RECIPES.find((r) => r.technique === "magnetometry.mvsh")!;

  it.each([
    ["ordinary QD VSM/PPMS/Lake Shore sweep", "Moment"],
    ["an AC-susceptibility sweep (io/qd.py's \"acmoment\" shorthand)", "AC Moment"],
    ["MPMS3, free-counterweight centering (legacy 'Moment' column left all-NaN)", "DC Moment Free Ctr"],
    ["MPMS3, fixed-counterweight centering", "DC Moment Fixed Ctr"],
  ])("resolves CLEANLY for %s (label %j)", (_case, label) => {
    const ds = parserShapedDataset([label], ["emu"], "magnetometry.mvsh");
    const res = resolveRecipe(mh, ds);
    if (!("resolved" in res)) throw new Error(`"${label}": expected a resolved result, got refusal: ${res.refused}`);
    expect(res.unmatched).toEqual([]);
    expect(res.resolved.mapping.yKeys).toEqual([0]);
  });
});

// FINDING 8 (code-review): `builtinVisual()` must actually READ
// `lib/plotRecipeIO.ts`'s exported `defaultRecipeVisual()`, not carry a
// second, hand-duplicated copy of the same literal -- proved by mocking that
// function with a distinctive sentinel and confirming every built-in's
// visual reflects it. If `builtinVisual()` still hand-duplicated the
// literal, this mock would have NO effect and the assertion below would
// fail (sabotage-verified: reverting to the old hand-duplicated object made
// this test fail exactly this way).
describe("builtinVisual() reads the shared defaultRecipeVisual(), never a private copy (finding 8)", () => {
  it("every built-in's mark reflects a mocked defaultRecipeVisual()", async () => {
    vi.resetModules();
    vi.doMock("./plotRecipeIO", async () => {
      const actual = await vi.importActual<typeof import("./plotRecipeIO")>("./plotRecipeIO");
      return { ...actual, defaultRecipeVisual: () => ({ ...actual.defaultRecipeVisual(), mark: "scatter" as const }) };
    });
    try {
      const mod = await import("./builtinPlotRecipes");
      for (const r of mod.BUILTIN_PLOT_RECIPES) {
        expect(r.visual.mark).toBe("scatter");
      }
    } finally {
      vi.doUnmock("./plotRecipeIO");
      vi.resetModules();
    }
  });
});
