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
  /** Whether the caller's OWN three lists are a faithful, complete read.
   *
   *  Required, not optional-defaulting-to-true, and that is the point: the
   *  workspace load and `globalPlotRecipes`' hydration both sanitize by
   *  dropping malformed entries, so the caller is the only code that can know
   *  whether its lists are whole. Defaulting to `true` would reintroduce at
   *  the boundary exactly the optimistic assumption this flag exists to kill.
   *  Pass false whenever hydration was skipped, failed, or dropped records. */
  readonly plotSourcesComplete: boolean;
}

export interface RecipeCollection {
  readonly recipes: readonly RecipeDescriptor[];
  /** True only when EVERY source is known to be represented in `recipes`:
   *  each localStorage slot parsed and yielded exactly as many records as it
   *  holds, and the caller vouched for its own lists. False if any slot was
   *  unreachable, corrupt, wrongly shaped, or had records filtered out.
   *
   *  Callers MUST pass this through to `pruneEntries`. Pruning against an
   *  incomplete collection deletes the favorites and tags of recipes that
   *  still exist (see `slotComplete` below). */
  readonly complete: boolean;
}

const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** Was ONE slot read whole?
 *
 *  Review finding on #271, and a real metadata-loss bug: the first version of
 *  this asked only whether localStorage was reachable, on the reasoning that
 *  an unreachable store is the way a read fails. That is not the only way, and
 *  it is not even the common one. The four `load*` functions all sanitize by
 *  swallowing errors and filtering bad entries, so a reachable store with a
 *  CORRUPT slot, or a valid array with one unparseable record in it, yields an
 *  empty-or-short list and a cheerful "complete". A caller then following this
 *  module's own documented contract deletes the favorites and tags of every
 *  recipe that got dropped — while the stored records are still sitting there,
 *  so the recipes come back later stripped of their metadata.
 *
 *  Hence per-slot, and hence the length comparison rather than a mere parse
 *  check: a partially-filtered array is the dangerous case precisely because
 *  the records still exist. If the loader returned fewer items than the slot
 *  holds, something in there is not represented in the collection, and
 *  pruning against that collection is destructive. */
function slotComplete(key: string, loadedCount: number): boolean {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return false; // storage unavailable
  }
  if (raw === null) return true; // genuinely absent: an empty system is whole
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false; // corrupt
  }
  if (!Array.isArray(parsed)) return false; // wrong shape
  return parsed.length === loadedCount; // no silently dropped records
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
  const analysis = loadTemplates();
  for (const t of analysis) {
    out.push(
      describe({ kind: "analysis", scope: "global", id: t.name }, t.name, {
        schemaVersion: t.version,
        summary: `${plural(t.steps.length, "step")}, ${plural(t.outputs.length, "output")}`,
      }, index),
    );
  }

  const peaks = loadPeakRecipes();
  for (const r of peaks) {
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

  const graphs = loadGraphTemplates();
  for (const t of graphs) {
    out.push(
      describe({ kind: "graph", scope: "global", id: t.name }, t.name, {
        summary: t.source === "origin" ? "imported from Origin" : t.style,
      }, index),
    );
  }

  const models = loadCustomModels();
  for (const m of models) {
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

  // Every contributor must vouch for itself; one doubtful source makes the
  // whole collection unsafe to prune against.
  const complete =
    input.plotSourcesComplete &&
    slotComplete("qz.analysisTemplates", analysis.length) &&
    slotComplete("qz.peakRecipes", peaks.length) &&
    slotComplete("qz.graphTemplates", graphs.length) &&
    slotComplete("qz.customFitModels", models.length);

  return { recipes: out, complete };
}

/** Every live `refKey`, for `pruneEntries`. Pair it with the collection's
 *  `complete` flag — never with `true`. */
export function liveKeys(collection: RecipeCollection): Set<string> {
  return new Set(collection.recipes.map((r) => refKey(r.ref)));
}
