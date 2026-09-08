// P3.5 slice 1 — the common contract over Quantized's saved-recipe systems.
//
// WHAT THIS IS NOT. It is not a new recipe format, and nothing here rewrites
// or migrates the six existing ones. Each system keeps its own storage, its
// own schema and its own save/load functions; this module only describes them
// in one vocabulary so a single Library view can list them side by side. The
// underlying formats were deliberately left untouched: four of them are
// name-keyed with no stable id (see CAPABILITIES below), and changing that is
// a migration on real user data, which is a separate decision from being able
// to SEE those recipes in one place.
//
// ── WHAT ACTUALLY EXISTS (inventory, 2026-08-30) ─────────────────────────
// Six user-saveable systems, in two very different states:
//
//   plot        PlotRecipe        workspace + qz.plotRecipes   id, versioned
//   quickPlot   QuickPlotTemplate workspace                    id, scoped
//   analysis    AnalysisTemplate  qz.analysisTemplates         NAME-KEYED
//   peak        PeakRecipe        qz.peakRecipes               NAME-KEYED
//   graph       GraphTemplate     qz.graphTemplates            NAME-KEYED
//   fitModel    CustomFitModel    qz.customFitModels           NAME-KEYED
//
// The two plan categories that do NOT exist as saveable artifacts: "Import
// recipes" (lib/importwizard.ts persists nothing; `importRecipeFile` is about
// importing a recipe FILE, not a recipe for importing) and "Technique
// Workflow recipes" (lib/techniqueViewMemory.ts is automatic per-technique
// view state, not a named artifact a user saves, browses or shares). Listing
// them here as empty kinds would be a fiction the UI then has to explain, so
// they are absent by construction until something actually saves one.
//
// ── THE IDENTITY PROBLEM, STATED UP FRONT ────────────────────────────────
// For the four name-keyed systems the NAME *is* the primary key: `saveTemplate`
// upserts by name and `deleteTemplate` deletes by name. So a rename is not a
// rename, it is a delete plus a create, and anything keyed to the old identity
// is orphaned by it. That is why `RecipeRef` is explicit about which id it
// carries and why `recipeIndex.ts` has a dedicated move operation rather than
// assuming ids are stable. Pretending these have stable ids would silently
// lose a user's favorites and tags the first time they renamed something.

import type { Technique } from "./types";

/** Which system a recipe comes from. Kept as a closed union so a new system
 *  cannot be surfaced in the Library without also declaring its capabilities
 *  below — the whole point is that the view never has to guess. */
export type RecipeKind = "plot" | "quickPlot" | "analysis" | "peak" | "graph" | "fitModel";

export const RECIPE_KINDS: readonly RecipeKind[] = [
  "plot",
  "quickPlot",
  "analysis",
  "peak",
  "graph",
  "fitModel",
] as const;

/** Where a recipe is STORED. Not to be confused with `QuickPlotTemplate.scope`
 *  ({workbook|schema}), which is an applicability rule INSIDE a project — a
 *  different question wearing the same word. Hoisted here from
 *  components/workshops/recipemanager/ because storage scope is a domain fact,
 *  not a property of one panel. */
export type RecipeScope = "project" | "global";

/** Human labels. Here rather than in the view so the Library, a command
 *  palette entry and an error message cannot drift apart on what to call
 *  something the user is looking at. */
export const RECIPE_KIND_LABEL: Record<RecipeKind, string> = {
  plot: "Plot recipe",
  quickPlot: "Quick Plot template",
  analysis: "Analysis template",
  peak: "Peak recipe",
  graph: "Graph template",
  fitModel: "Fit model",
};

/** Which workshop OWNS each name-keyed kind — the honest meaning of "open"
 *  for the four kinds that have no in-Library apply gesture (see
 *  `RecipeOperation`'s doc below). A label only: actually opening the
 *  workshop needs the store, so `components/workshops/recipelibrary/
 *  recipeActions.ts`'s `WORKSHOP_OPENERS` reads its labels from here rather
 *  than re-typing the four names, and `lib/recipeDetails.ts` (pure, no
 *  store) uses this alone to render the same "Open in <workshop>" verb a row
 *  action would show, instead of hardcoding it a third time. */
export const NAME_KEYED_WORKSHOP_LABEL: Record<Extract<RecipeKind, "analysis" | "peak" | "graph" | "fitModel">, string> = {
  analysis: "Pipeline",
  peak: "Peak Analyzer",
  graph: "Figure Builder",
  fitModel: "Curve Fit",
};

/** What a kind can actually do TODAY. Declared per kind rather than assumed,
 *  because they genuinely differ and a Library that offers Rename on a system
 *  where renaming destroys identity is worse than one that greys it out. */
export interface RecipeCapabilities {
  /** The id survives a rename. False for the name-keyed four: their id IS
   *  the name, so renaming mints a new identity. */
  readonly stableId: boolean;
  /** Storage scopes this kind can live in. The name-keyed four are
   *  global-only — they have no project-file representation at all, so the
   *  Library must not offer to "move to project". */
  readonly scopes: readonly RecipeScope[];
  readonly canRename: boolean;
  readonly canDuplicate: boolean;
  readonly canImportExport: boolean;
  /** Carries a `technique` tag that can be shown and filtered on. */
  readonly hasTechnique: boolean;
  /** Carries createdAt/modifiedAt worth displaying. */
  readonly hasTimestamps: boolean;
  /** Carries an explicit schema version for migration. */
  readonly schemaVersioned: boolean;
}

/** The capability matrix, read off the code rather than aspirational.
 *  `plot` is the reference implementation: P1.3 gave it scope, rename,
 *  duplicate and import/export (components/workshops/recipemanager/
 *  recipeManagerActions.ts).
 *
 *  P3.5 closed part of the gap this table exposed — rename and duplicate are
 *  now real for the four name-keyed kinds (`lib/nameKeyedRecipes.ts`),
 *  quickPlot gained `duplicateQuickPlotTemplate` (store/quickPlotTemplates.ts),
 *  and peak/graph/fitModel gained real serializers and validating parsers
 *  (`lib/nameKeyedRecipes.ts`'s `serialize`/`parse`, backed by each system's
 *  own `isPeakRecipe`/`isGraphTemplate`/`isCustomFitModel`) — and deliberately
 *  left the rest open rather than lying about it. What is still genuinely
 *  absent, and why:
 *
 *    - quickPlot import/export: no serializer exists, and it would need one
 *      genuinely of its own — a quickPlot template is bound to a workbook or
 *      schema signature (project-scoped by construction), not a portable
 *      object the way a plot recipe or the name-keyed four already are.
 *    - project scope for the name-keyed four: they have no project-file
 *      representation at all, so "copy to project" is not a missing feature,
 *      it is a category error.
 *
 *  A `false` here is a promise the Library keeps by greying the action out. */
export const RECIPE_CAPABILITIES: Record<RecipeKind, RecipeCapabilities> = {
  plot: {
    stableId: true,
    scopes: ["project", "global"],
    canRename: true,
    canDuplicate: true,
    canImportExport: true,
    hasTechnique: true,
    hasTimestamps: true,
    schemaVersioned: true,
  },
  quickPlot: {
    stableId: true,
    scopes: ["project"],
    // CORRECTED 2026-08-30 (P3.5): this read `false`, but
    // `store/quickPlotTemplates.ts` has exposed `renameQuickPlotTemplate`
    // since PR H. The table claimed to be read off the code and was not.
    canRename: true,
    canDuplicate: true, // duplicateQuickPlotTemplate exists in store/quickPlotTemplates.ts
    canImportExport: false,
    hasTechnique: true,
    hasTimestamps: true,
    schemaVersioned: false,
  },
  analysis: {
    stableId: false,
    scopes: ["global"],
    // Rename/duplicate became REAL in P3.5 (`lib/nameKeyedRecipes.ts`), not
    // aspirational: renaming is still a delete plus a create — `stableId`
    // stays false because the identity genuinely changes — but it now carries
    // the sidecar across with `recipeIndex.moveEntry`, which is the condition
    // that made offering it destructive before.
    canRename: true,
    canDuplicate: true,
    canImportExport: true, // serializeTemplate/parseTemplate
    hasTechnique: false,
    hasTimestamps: false,
    schemaVersioned: true, // `version: 1` literal
  },
  peak: {
    stableId: false,
    scopes: ["global"],
    // Rename/duplicate became REAL in P3.5 (`lib/nameKeyedRecipes.ts`), not
    // aspirational: renaming is still a delete plus a create — `stableId`
    // stays false because the identity genuinely changes — but it now carries
    // the sidecar across with `recipeIndex.moveEntry`, which is the condition
    // that made offering it destructive before.
    canRename: true,
    canDuplicate: true,
    canImportExport: true, // P3.5: lib/nameKeyedRecipes.ts's serialize/isPeakRecipe
    hasTechnique: false,
    hasTimestamps: false,
    schemaVersioned: true,
  },
  graph: {
    stableId: false,
    scopes: ["global"],
    // Rename/duplicate became REAL in P3.5 (`lib/nameKeyedRecipes.ts`), not
    // aspirational: renaming is still a delete plus a create — `stableId`
    // stays false because the identity genuinely changes — but it now carries
    // the sidecar across with `recipeIndex.moveEntry`, which is the condition
    // that made offering it destructive before.
    canRename: true,
    canDuplicate: true,
    canImportExport: true, // P3.5: lib/nameKeyedRecipes.ts's serialize/isGraphTemplate
    hasTechnique: false,
    hasTimestamps: false,
    schemaVersioned: false,
  },
  fitModel: {
    stableId: false,
    scopes: ["global"],
    // Rename/duplicate became REAL in P3.5 (`lib/nameKeyedRecipes.ts`), not
    // aspirational: renaming is still a delete plus a create — `stableId`
    // stays false because the identity genuinely changes — but it now carries
    // the sidecar across with `recipeIndex.moveEntry`, which is the condition
    // that made offering it destructive before.
    canRename: true,
    canDuplicate: true,
    canImportExport: true, // P3.5: lib/nameKeyedRecipes.ts's serialize/isCustomFitModel
    hasTechnique: false,
    hasTimestamps: false,
    schemaVersioned: true,
  },
};


/** The operations a Library row can offer. One closed union so a view, a
 *  command and a menu item cannot disagree about what "duplicate" means. */
export type RecipeOperation =
  | "apply"
  | "rename"
  | "duplicate"
  | "delete"
  | "export"
  | "import"
  | "copyScope";

/** Can this kind do this operation, today?
 *
 *  The single question the UI asks, so no view re-derives the answer from raw
 *  capability flags and gets it subtly wrong. Two operations are answered by
 *  constants rather than flags, and that is deliberate rather than lazy:
 *
 *   - `apply` — every one of the six has a real apply gesture, verified by
 *     walking them (plot/quickPlot in the store, the other four in their
 *     owning workshop). There is no read-only kind, so a flag would be a
 *     column of `true` that teaches nobody anything.
 *   - `delete` — likewise: all six expose a delete. If a built-in preset kind
 *     ever arrives, THAT is when this earns a flag.
 *
 *  `copyScope` is derived from `scopes` rather than duplicated as a flag: a
 *  kind that lives in exactly one place has nowhere to copy to, and stating
 *  that twice is how two sources of truth drift apart. */
export function supportsOperation(kind: RecipeKind, op: RecipeOperation): boolean {
  const c = RECIPE_CAPABILITIES[kind];
  switch (op) {
    case "apply":
    case "delete":
      return true;
    case "rename":
      return c.canRename;
    case "duplicate":
      return c.canDuplicate;
    case "export":
    case "import":
      return c.canImportExport;
    case "copyScope":
      return c.scopes.length > 1;
  }
}

/** Identifies one recipe across every system. `id` is that system's own key:
 *  a real id for plot/quickPlot, the NAME for the other four (see the header
 *  — that is a property of those systems, not a shortcut taken here). */
export interface RecipeRef {
  readonly kind: RecipeKind;
  readonly scope: RecipeScope;
  readonly id: string;
}


/** Will Ctrl+Z bring this recipe back after a delete?
 *
 *  Only project-scope plot recipes and quick-plot templates are undo-tracked.
 *  The global plot store carries no history by design
 *  (`store/globalPlotRecipes.ts`'s header) and the four name-keyed systems
 *  write straight to localStorage.
 *
 *  Two very different consumers depend on this being ONE answer: the delete
 *  confirm dialog's wording, and `recipeIndex.pruneEntries`, which keeps an
 *  orphan's favorite ONLY when an undo could bring the recipe back to claim
 *  it. A dialog promising an undo that does not exist, and a sidecar entry
 *  outliving a recipe that can never return, are the same mistake. */
export function deleteIsUndoable(ref: RecipeRef): boolean {
  if (ref.kind === "quickPlot") return true;
  return ref.kind === "plot" && ref.scope === "project";
}

/** Stable string form, for use as a map key or a React key.
 *  `encodeURIComponent` on the id is load-bearing rather than decorative: a
 *  name-keyed id is a user-typed string that may contain the separator, and
 *  an unescaped `:` would make `refKey` ambiguous — two different recipes
 *  colliding on one key, which for the sidecar index means one silently
 *  inheriting the other's favorite and tags. */
export function refKey(ref: RecipeRef): string {
  return `${ref.kind}:${ref.scope}:${encodeURIComponent(ref.id)}`;
}

/** Inverse of `refKey`. Returns null for anything malformed rather than
 *  throwing: these strings round-trip through localStorage, where a truncated
 *  or hand-edited value is a normal thing to survive, not an exception. */
export function parseRefKey(key: string): RecipeRef | null {
  const parts = key.split(":");
  if (parts.length !== 3) return null;
  const [kind, scope, id] = parts;
  if (!RECIPE_KINDS.includes(kind as RecipeKind)) return null;
  if (scope !== "project" && scope !== "global") return null;
  try {
    return { kind: kind as RecipeKind, scope, id: decodeURIComponent(id) };
  } catch {
    return null; // malformed percent-encoding
  }
}

/** One row of the Library, in the vocabulary the view speaks. Assembled by
 *  `recipeSources.ts` from a system's own record plus `recipeIndex.ts`'s
 *  sidecar metadata; nothing here is stored in this shape. */
export interface RecipeDescriptor {
  readonly ref: RecipeRef;
  readonly kind: RecipeKind;
  readonly name: string;
  readonly description?: string;
  readonly technique?: Technique;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
  readonly schemaVersion?: number;
  /** Short, kind-specific line for a list row ("3 peaks", "2 outputs").
   *  A summary of SHAPE, never of user content. */
  readonly summary?: string;
  readonly capabilities: RecipeCapabilities;
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly lastUsedAt?: string;
  readonly useCount: number;
}
