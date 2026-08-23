// Plot recipes (PRIMARY_SOFTWARE_AUDIT_PLAN P1.3 / FIGURE_AUTHORING_WORKFLOW_PLAN
// F4): a NAMED, SAVED figure recipe -- semantic X/Y/error/group/facet roles
// plus the full visual payload, captured once explicitly from a live PlotView
// (never auto-saved), that a later dataset of the SAME technique can try to
// REAPPLY. Matching lives in `plotRecipeMatch.ts`; parsing/sanitizing for the
// untrusted `.dwk`/import boundary lives in `plotRecipeIO.ts`; the schema
// types + version constant live in `plotRecipeSchema.ts` (re-exported below
// for compatibility -- the split keeps startup workspace parsing from
// pulling this capture implementation into the eager bundle). This module
// owns only the pure capture half.
//
// Builds on established idioms rather than inventing new ones:
//   - `lib/quickPlotTemplates.ts` (H1/H4): technique-equality gate, per-channel
//     RE-KEY BY LABEL (never by index), and the errorRole guard that refuses
//     rebinding a value column as an error column -- both reused in
//     `plotRecipeMatch.ts`. `SignatureErrorRole` (the value/error-x/error-y+/
//     ... vocabulary) is imported from there rather than redeclared, so the
//     two systems never drift onto two different error-role enums.
//   - `lib/techniqueViewMemory.ts` (item 5): "generic" never carries memory --
//     the same rule applies here, deliberately STRONGER for recipes: a
//     recipe scoped to "generic" is refused outright at resolve time (see
//     `plotRecipeMatch.ts`), not merely skipped like a memory lookup.
//   - `lib/template.ts` (AnalysisTemplate): the versioned serialize/parse
//     precedent -- a numeric schema-version field, `parseRecipe` throws
//     "unsupported plot recipe schema version" on mismatch, pretty diffable
//     JSON (`JSON.stringify(recipe, null, 2)`).
//
// SIGNATURE SCOPE (deliberately narrower than QuickPlotTemplate's whole-
// dataset schema fingerprint): only the channels the MAPPING actually
// references get a signature entry -- X, every Y/Y2, group, facet, and every
// error channel + its target -- not every column in the dataset. Each entry
// is matched by LABEL (case/whitespace-folded) + optional user ALIASES,
// never by index or column position: "reordered equivalent XRD columns map
// correctly" is the plan's own acceptance case for this feature.
//
// This object never crosses the Python wire in this wave -- camelCase
// throughout, no snake_case bridging needed yet.
//
// `storageScope` ("project" | "global") is deliberately NOT part of this
// schema: where a recipe LIVES is a property of the store/list that holds
// it, not of the recipe object itself -- keeping the object location-
// agnostic means import/export/duplicate/copy can move a recipe between
// scopes without touching a single field on it. The cross-scope TRANSFER
// primitive is copy-with-a-fresh-id (store/globalPlotRecipes.ts's `copyIn`,
// store/plotRecipes.ts's `copyPlotRecipeIn`) -- ORCHESTRATOR RULING B
// (code-review findings 2+3) replaced an earlier remove-from-one-add-to-
// other "move" after it turned out to both lose the recipe entirely on a
// mistimed undo and let two scopes end up holding entries under the SAME
// id. A copy never touches its source; a user wanting move semantics
// deletes the source afterward.

import { inferErrorBindings, type ErrorBinding } from "./errorRoles";
import { legacyErrorBindings } from "./figureDocument";
import { isAxisScale, type PlotView } from "./plotview";
import type { PlotMark } from "./plotspec";
import { errorRoleFor as classifyErrorRole, normalizeLabel } from "./quickPlotTemplates";
import { techniqueOf } from "./techniqueDefaults";
import type { Dataset } from "./types";
import type { Composition } from "./composition";
import {
  PLOT_RECIPE_SCHEMA_VERSION,
  type PlotRecipe,
  type RecipeAxisBreaks,
  type RecipeAxisRange,
  type RecipeChannelRole,
  type RecipeErrorBinding,
  type RecipeSignatureEntry,
} from "./plotRecipeSchema";

export * from "./plotRecipeSchema";

// classifyErrorRole/normalizeLabel are `lib/quickPlotTemplates.ts`'s ORIGINALS
// (code-review cleanup 5) -- re-exported here under this module's own naming
// so `plotRecipeMatch.ts` and every test keep importing them from
// `./plotRecipe` unchanged; only ONE implementation exists anywhere.
export { classifyErrorRole, normalizeLabel };

function rangeFrom(lim: [number, number] | null, step: number | null): RecipeAxisRange {
  if (lim === null) return { mode: "auto" };
  return step === null ? { mode: "fixed", lim } : { mode: "fixed", lim, step };
}

export interface CaptureRecipeOptions {
  id: string;
  name: string;
  description?: string;
  /** App version stamp for `provenance.appVersion` (e.g. `package.json`'s
   *  version, threaded in by the caller -- this pure module never reads
   *  `import.meta`/env itself). */
  appVersion: string;
  /** Defaults to `dataset.name`. */
  sourceDatasetLabel?: string;
  /** Defaults to `"line"` -- `PlotView` carries no mark; it lives on
   *  `FigureDocument.plot.mark` when a canonical document is open. */
  mark?: PlotMark;
  /** Rich error bindings (`FigureDocument.bindings.errors`). Falls back to
   *  `view.errKeys`'s legacy symmetric-Y-only projection when omitted, so a
   *  caller with only a live `PlotView` (no canonical document open) still
   *  captures whatever error pairing is visible today. */
  errors?: readonly ErrorBinding[];
  /** `PlotView` carries no facet channel (`FigureBindings.facetKey` does) --
   *  pass it explicitly when a canonical document backs the view. */
  facetKey?: number | null;
  axisBreaks?: Partial<RecipeAxisBreaks>;
  /** Injectable clock for deterministic tests; defaults to
   *  `() => new Date().toISOString()`. */
  now?: () => string;
}

/** Capture a `PlotRecipe` from a live `PlotView` + the dataset it's bound to.
 *  Pure -- converts every index-keyed view field into a signature-keyed
 *  recipe field; never mutates `dataset`, `view`, or `composition`.
 *
 *  Only channels the view/opts actually REFERENCE get a signature entry
 *  (see the module doc's "signature scope" note) -- a `seriesStyles`/
 *  `seriesLabels`/`seriesOrder`/`hiddenChannels` entry for a channel that
 *  isn't otherwise bound (x/y/y2/group/facet/error) has no signature entry
 *  to key against and is silently dropped from the capture; the recipe
 *  captures "the plot", not incidental leftover state for channels not
 *  currently part of it. */
export function captureRecipe(
  dataset: Dataset,
  view: PlotView,
  composition: Composition | null,
  opts: CaptureRecipeOptions,
): PlotRecipe {
  const labels = dataset.data.labels;
  const units = dataset.data.units;
  // The VIEW's actual error usage -- feeds RecipeMapping.errors (and the
  // "error" role assignment below) only. Deliberately NOT the source for
  // `errorRole` classification -- see `entryFor`'s comment (finding 1).
  const errorBindings = opts.errors ?? legacyErrorBindings(view.errKeys);
  // The DATASET's own error-column classification, independent of how the
  // view is currently using any given channel -- `resolveRecipe` re-derives
  // this exact same way against the target dataset, so classifying from it
  // here (not from `errorBindings`) is what makes capture-then-resolve on
  // the IDENTICAL dataset a true identity (P1.3 code-review finding 1).
  const datasetErrorRoles = dataset.errorRoles ?? inferErrorBindings(dataset.data);

  const entries: RecipeSignatureEntry[] = [];
  const channelToId = new Map<number, string>();
  const roleCounts: Partial<Record<RecipeChannelRole, number>> = {};

  function entryFor(channel: number, role: RecipeChannelRole): string {
    const existing = channelToId.get(channel);
    if (existing !== undefined) return existing;
    const n = roleCounts[role] ?? 0;
    roleCounts[role] = n + 1;
    const id = `${role}${n}`;
    entries.push({
      id,
      role,
      label: labels[channel] ?? "",
      unit: units[channel] ?? "",
      errorRole: classifyErrorRole(datasetErrorRoles, channel),
      aliases: [],
    });
    channelToId.set(channel, id);
    return id;
  }

  const xId = view.xKey !== null ? entryFor(view.xKey, "x") : null;
  const yIds = (view.yKeys ?? []).map((ch) => entryFor(ch, "y"));
  const y2Ids = (view.y2Keys ?? []).map((ch) => entryFor(ch, "y2"));
  const groupId = view.groupKey !== null ? entryFor(view.groupKey, "group") : null;
  const facetId = opts.facetKey != null ? entryFor(opts.facetKey, "facet") : null;

  const errors: RecipeErrorBinding[] = errorBindings.map((b) => ({
    channel: entryFor(b.channel, "error"),
    target: b.target >= 0 ? entryFor(b.target, b.axis === "x" ? "x" : "y") : null,
    axis: b.axis,
    side: b.side,
  }));

  // Deep-copies every value (P1.3 code-review finding 3): `seriesStyles`
  // values are `SeriesStyle` objects owned by the LIVE view -- without a
  // clone, the captured recipe would share those object references, so an
  // in-Stage style edit made AFTER capture would silently mutate the
  // already-saved recipe too. (`seriesLabels` values are plain strings, so
  // the clone is a no-op there -- one helper for both, not two.)
  const pickRecord = <T>(rec: Readonly<Record<number, T>>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [k, val] of Object.entries(rec)) {
      const id = channelToId.get(Number(k));
      if (id !== undefined) out[id] = structuredClone(val);
    }
    return out;
  };
  const pickList = (list: readonly number[]): string[] =>
    list.flatMap((ch) => {
      const id = channelToId.get(ch);
      return id !== undefined ? [id] : [];
    });

  const now = opts.now ?? (() => new Date().toISOString());
  const timestamp = now();

  return {
    id: opts.id,
    name: opts.name,
    description: opts.description ?? "",
    createdAt: timestamp,
    modifiedAt: timestamp,
    schemaVersion: PLOT_RECIPE_SCHEMA_VERSION,
    provenance: {
      sourceDatasetLabel: opts.sourceDatasetLabel ?? dataset.name,
      appVersion: opts.appVersion,
    },
    technique: techniqueOf(dataset),
    signature: entries,
    mapping: { xId, yIds, y2Ids, groupId, facetId, errors },
    visual: {
      mark: opts.mark ?? "line",
      xScale: isAxisScale(view.xScale) ? view.xScale : "linear",
      yScale: isAxisScale(view.yScale) ? view.yScale : "linear",
      y2Scale: view.y2Scale,
      xRange: rangeFrom(view.xLim, view.xStep),
      yRange: rangeFrom(view.yLim, view.yStep),
      y2Range: rangeFrom(view.y2Lim, view.y2Step),
      xFmt: { ...view.xFmt },
      yFmt: { ...view.yFmt },
      y2Fmt: view.y2Fmt ? { ...view.y2Fmt } : null,
      axisBreaks: {
        x: (opts.axisBreaks?.x ?? []).map((r): [number, number] => [r[0], r[1]]),
        y: (opts.axisBreaks?.y ?? []).map((r): [number, number] => [r[0], r[1]]),
        y2: (opts.axisBreaks?.y2 ?? []).map((r): [number, number] => [r[0], r[1]]),
      },
      showLegend: view.showLegend,
      legendPos: view.legendPos,
      legendXY: view.legendXY ? [view.legendXY[0], view.legendXY[1]] : null,
      legendTitle: view.legendTitle,
      legendStatic: view.legendStatic,
      stackMode: view.stackMode,
      waterfall: view.waterfall,
      plotTemplate: view.plotTemplate,
      seriesStyles: pickRecord(view.seriesStyles),
      seriesLabels: pickRecord(view.seriesLabels),
      seriesOrder: view.seriesOrder ? pickList(view.seriesOrder) : null,
      hiddenChannels: pickList(view.hiddenChannels),
      decorations: {
        annotations: view.annotations.map((a) => ({ ...a })),
        shapes: view.shapes.map((s) => ({ ...s })),
        regionShades: view.regionShades.map((r) => ({ ...r })),
      },
      compositionKind: composition ? composition.kind : null,
    },
  };
}

/** Pretty, key-stable JSON so recipes diff cleanly in git -- the same
 *  `lib/template.ts` `serializeTemplate` convention. */
export function serializeRecipe(recipe: PlotRecipe): string {
  return JSON.stringify(recipe, null, 2) + "\n";
}
