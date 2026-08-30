// P3.5 slice 1 — read every recipe system into one list of descriptors.
//
// READ-ONLY BY DESIGN. Nothing here saves, migrates, or reshapes a stored
// record; each system keeps its own format and its own writer. This is the
// adapter layer that lets one view show all six without the view knowing six
// schemas.
//
// The two workspace-backed kinds (plot, quickPlot) arrive as ARGUMENTS rather
// than being read here: they live in the project file and reach the app
// through the store, and `lib/` is a pure library that must not import
// `store/`. The four localStorage-backed kinds read themselves, exactly as
// their own modules already do.
//
// ── SUMMARIES ARE SHAPE, NEVER CONTENT ───────────────────────────────────
// Every `summary` below counts things — channels, steps, parameters. None of
// them quotes an equation, a column label, or a sample name. A Library row is
// the kind of surface that ends up in a screenshot in a bug report or on a
// projector during a group meeting, and the same reasoning that governs the
// diagnostics bundle applies: the user's science is the sensitive material.
// A name the user typed is unavoidable (it is the thing they click), but
// nothing ELSE is volunteered.

import { loadGraphTemplates } from "./figuredoc";
import { loadCustomModels } from "./fitmodels";
import { loadRecipes as loadPeakRecipes } from "./peakwizard";
import type { PlotRecipe } from "./plotRecipeSchema";
import type { QuickPlotTemplate } from "./quickPlotTemplates";
import { loadIndex, metaFor } from "./recipeIndex";
import {
  RECIPE_CAPABILITIES,
  type RecipeDescriptor,
  type RecipeRef,
  type RecipeScope,
  refKey,
} from "./recipeLibrary";
import { loadTemplates } from "./template";

/** The project-scoped recipes, supplied by the caller from the store. */
export interface RecipeSourceInput {
  readonly plotProject: readonly PlotRecipe[];
  readonly plotGlobal: readonly PlotRecipe[];
  readonly quickPlot: readonly QuickPlotTemplate[];
}

export interface RecipeCollection {
  readonly recipes: readonly RecipeDescriptor[];
  /** False when any localStorage-backed source could not be read. Callers
   *  MUST pass this through to `pruneEntries` — pruning the sidecar index
   *  against a list built from a failed read would delete every favorite the
   *  user has (see recipeIndex.ts). */
  readonly complete: boolean;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** Is localStorage actually reachable? The four `load*` functions below all
 *  swallow their own errors and return [], so an empty list from them is
 *  ambiguous between "nothing saved" and "storage threw". This probe is the
 *  only way to tell the two apart, and telling them apart is what makes
 *  pruning safe. */
function storageReadable(): boolean {
  try {
    localStorage.getItem("qz.recipeIndex");
    return true;
  } catch {
    return false;
  }
}

function describe(
  ref: RecipeRef,
  name: string,
  extra: Partial<Omit<RecipeDescriptor, "ref" | "kind" | "name" | "capabilities" | "favorite" | "tags" | "lastUsedAt" | "useCount">>,
  index: ReturnType<typeof loadIndex>,
): RecipeDescriptor {
  const meta = metaFor(ref, index);
  return {
    ref,
    kind: ref.kind,
    name,
    capabilities: RECIPE_CAPABILITIES[ref.kind],
    favorite: meta.favorite,
    tags: meta.tags,
    lastUsedAt: meta.lastUsedAt,
    useCount: meta.useCount,
    ...extra,
  };
}

function plotDescriptors(
  list: readonly PlotRecipe[],
  scope: RecipeScope,
  index: ReturnType<typeof loadIndex>,
): RecipeDescriptor[] {
  return list.map((r) =>
    describe({ kind: "plot", scope, id: r.id }, r.name, {
      description: r.description || undefined,
      technique: r.technique,
      createdAt: r.createdAt,
      modifiedAt: r.modifiedAt,
      schemaVersion: r.schemaVersion,
      summary: plural(r.signature.length, "channel"),
    }, index),
  );
}

export function collectRecipes(input: RecipeSourceInput): RecipeCollection {
  const readable = storageReadable();
  const index = loadIndex();
  const out: RecipeDescriptor[] = [
    ...plotDescriptors(input.plotProject, "project", index),
    ...plotDescriptors(input.plotGlobal, "global", index),
  ];

  for (const t of input.quickPlot) {
    out.push(
      describe({ kind: "quickPlot", scope: "project", id: t.id }, t.name, {
        technique: t.technique,
        createdAt: t.createdAt,
        summary: plural(t.signature.channels.length, "channel"),
      }, index),
    );
  }

  // The name-keyed four. `id` is the name because that IS their primary key
  // (recipeLibrary.ts's header); this is describing them honestly, not
  // choosing a shortcut.
  for (const t of loadTemplates()) {
    out.push(
      describe({ kind: "analysis", scope: "global", id: t.name }, t.name, {
        schemaVersion: t.version,
        summary: `${plural(t.steps.length, "step")}, ${plural(t.outputs.length, "output")}`,
      }, index),
    );
  }

  for (const r of loadPeakRecipes()) {
    out.push(
      describe({ kind: "peak", scope: "global", id: r.name }, r.name, {
        schemaVersion: r.version,
        // The baseline METHOD is a fixed enum, not user text — safe to show,
        // and it is the single most useful thing for telling two peak recipes
        // apart at a glance.
        summary: `${r.baseline.method} baseline, ${r.model.shape}`,
      }, index),
    );
  }

  for (const t of loadGraphTemplates()) {
    out.push(
      describe({ kind: "graph", scope: "global", id: t.name }, t.name, {
        summary: t.source === "origin" ? "imported from Origin" : t.style,
      }, index),
    );
  }

  for (const m of loadCustomModels()) {
    out.push(
      describe({ kind: "fitModel", scope: "global", id: m.name }, m.name, {
        schemaVersion: m.version,
        // Deliberately NOT `m.equation`: the equation is the user's own
        // modelling work and belongs on a detail panel they opened, not on
        // every row of a list.
        summary: plural(m.params.length, "parameter"),
      }, index),
    );
  }

  return { recipes: out, complete: readable };
}

/** Every live `refKey`, for `pruneEntries`. Pair it with the collection's
 *  `complete` flag — never with `true`. */
export function liveKeys(collection: RecipeCollection): Set<string> {
  return new Set(collection.recipes.map((r) => refKey(r.ref)));
}
