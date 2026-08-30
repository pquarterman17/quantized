// Plot recipe persistence, GLOBAL scope (P1.3 wave 2, Lane C) — the
// localStorage half of the two-scope model; the PROJECT-scope half (a
// workspace's own `plotRecipes[]`) is wired in `workspace.ts` instead. Same
// `lib/figuredoc.ts` `GraphTemplate` / `lib/template.ts` `AnalysisTemplate`
// precedent: a flat JSON array under one `qz.*` key, loaded tolerantly
// (missing/corrupt storage never throws — degrades to an empty list) and
// saved best-effort (a storage failure — quota, private-mode — never throws
// either; the recipe just stays session-local).
//
// `storageScope` is deliberately not a field on `PlotRecipe` itself (see
// `plotRecipe.ts`'s module doc): the object is location-agnostic, so this
// module and `workspace.ts`'s project-scope fields both hold the exact same
// `PlotRecipe` shape. ORCHESTRATOR RULING B (code-review findings 2+3): the
// cross-scope TRANSFER primitive is COPY-with-a-fresh-id, not move -- an
// earlier move (remove from one list, add to the other) could lose the
// recipe entirely if the destination-side add was later undone after the
// source-side removal had already landed (finding 2), and preserved the
// SAME id across both lists, so two scopes could end up holding entries
// that share an id (finding 3). `store/globalPlotRecipes.ts`'s `copyIn` /
// `store/plotRecipes.ts`'s `copyPlotRecipeIn` mint a fresh id and never
// touch the source; a user who wants move semantics deletes the source
// explicitly afterward.
//
// `sanitizeRecipes` (not a bespoke type guard) backs both `loadGlobalPlotRecipes`
// and the project-scope `parseWorkspace` — one drop-malformed-never-throw
// validator for every untrusted-JSON boundary a `PlotRecipe` crosses.

import { parseRecipe, sanitizeRecipes } from "./plotRecipeIO";
import { serializeRecipe, type PlotRecipe } from "./plotRecipe";

const KEY = "qz.plotRecipes";

export interface GlobalPlotRecipeLoad {
  recipes: PlotRecipe[];
  /** True only when the persisted array was represented without dropping an
   * entry. Missing storage is a complete empty source; corrupt or partially
   * invalid storage is not. */
  complete: boolean;
}

/** Status-bearing load for consumers that must distinguish empty from lost. */
export function loadGlobalPlotRecipesWithStatus(): GlobalPlotRecipeLoad {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return { recipes: [], complete: false };
  }
  if (raw === null) return { recipes: [], complete: true };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { recipes: [], complete: false };
    const recipes = sanitizeRecipes(parsed);
    return { recipes, complete: recipes.length === parsed.length };
  } catch {
    return { recipes: [], complete: false };
  }
}

/** Load every globally-saved recipe. Tolerates missing storage, corrupt JSON,
 *  a non-array payload, and any malformed entry within it (dropped
 *  individually, per `sanitizeRecipes`) — never throws. */
export function loadGlobalPlotRecipes(): PlotRecipe[] {
  return loadGlobalPlotRecipesWithStatus().recipes;
}

/** Overwrite the global recipe list. Best-effort — a storage failure (quota,
 *  private-mode) is swallowed; the caller's in-memory list is unaffected. */
export function saveGlobalPlotRecipes(list: readonly PlotRecipe[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable — recipes stay session-local */
  }
}

/** Serialize one recipe to a standalone, diffable `.json` file's contents
 *  (an explicit "Export recipe…"). Pure passthrough to `plotRecipe.ts`'s
 *  serializer — kept here too so every recipe-file entry point (export AND
 *  import, below) lives in one module. */
export function exportRecipeFile(recipe: PlotRecipe): string {
  return serializeRecipe(recipe);
}

let _importSeq = 0;

/** Parse a standalone recipe `.json` file (an explicit "Import recipe…").
 *  Throws with a clear message on anything malformed (`parseRecipe`'s strict
 *  contract) — there's no sane default for a file the user explicitly chose.
 *
 *  Mints a FRESH `id` rather than keeping the file's own: an imported recipe
 *  is a NEW list entry, not a reference to the exporting session's copy, so
 *  reusing the original id would collide the moment two people (or two
 *  imports of the same file) landed it in the same list. Every other field —
 *  name, description, signature, mapping, visual — is preserved verbatim. */
export function importRecipeFile(text: string): PlotRecipe {
  const recipe = parseRecipe(text);
  return { ...recipe, id: `recipe-${Date.now().toString(36)}-${++_importSeq}` };
}
