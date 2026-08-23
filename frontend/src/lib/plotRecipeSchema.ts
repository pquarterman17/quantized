// Lightweight, runtime-safe plot-recipe schema. Workspace parsing needs the
// version constant and these shapes during application startup, but it does not
// need plotRecipe.ts's capture implementation. Keeping this module free of
// value imports prevents workspace.ts -> plotRecipeIO.ts from pulling capture,
// error-role inference, and figure-document helpers into the eager bundle.
//
// The invariant documentation on these shapes is load-bearing: it moved here
// with the types when they split out of `plotRecipe.ts` (which now owns only
// the capture half; matching lives in `plotRecipeMatch.ts`, the untrusted
// `.dwk`/import boundary in `plotRecipeIO.ts`).

import type { CompositionKind } from "./composition";
import type { ErrorSide } from "./errorRoles";
import type { LegendPos } from "./plotview";
import type { PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import type {
  Annotation,
  AxisFormat,
  AxisScale,
  RegionShade,
  SeriesStyle,
  Shape,
  Technique,
} from "./types";

export const PLOT_RECIPE_SCHEMA_VERSION = 1 as const;

/** What role a captured channel plays in the recipe's mapping. `"error"`
 *  covers every error channel (its finer x/y/+/- classification lives in
 *  `errorRole`, not here) -- this field is about WHERE the channel is used,
 *  `errorRole` is about WHAT KIND of column it is. */
export type RecipeChannelRole = "x" | "y" | "y2" | "group" | "facet" | "error";

/** One channel the recipe's mapping references, captured at save time. The
 *  matching unit throughout `plotRecipeMatch.ts` -- every mapping/visual
 *  field that needs to name a channel points at an entry's `id`, never a raw
 *  dataset index. `label` is the RAW captured label (not case-folded) so it
 *  reads naturally in an unmatched-field report; matching itself folds case
 *  and whitespace (`normalizeLabel`, `lib/quickPlotTemplates.ts`'s original,
 *  re-exported by `plotRecipe.ts`) on both `label` and every `aliases`
 *  entry.
 *
 *  `errorRole` is the `SignatureErrorRole` classification of THIS COLUMN IN
 *  THE SOURCE DATASET (`dataset.errorRoles ?? inferErrorBindings(dataset.
 *  data)`, the exact same source `resolveRecipe` re-derives against the
 *  target dataset) -- NOT how the view happened to be using the column at
 *  capture time. (P1.3 code-review finding 1: classifying from the view's
 *  own error bindings instead broke round-trip identity -- an error-named
 *  column plotted as a plain Y series captured as "value", then refused on
 *  resolve against the IDENTICAL dataset because `resolveRecipe`'s
 *  dataset-derived classification said "error-y".) How the view actually
 *  USES a channel (plotted as data vs. paired as an error bar) is entirely
 *  `RecipeMapping`'s concern (`role` above, and `RecipeMapping.errors`) --
 *  `errorRole` and `role` are independent axes and may disagree (a column
 *  the dataset would call an error column can still be mapped with
 *  `role: "y"` if the view plots it as data). The guard `resolveRecipe`
 *  applies is a "same kind of column" check, not a "same intended use"
 *  check. */
export interface RecipeSignatureEntry {
  id: string;
  role: RecipeChannelRole;
  label: string;
  unit: string;
  errorRole: SignatureErrorRole;
  /** Extra labels (besides `label`) that should also resolve to this entry,
   *  case/whitespace-insensitively -- e.g. a user-declared "2θ" / "2theta"
   *  equivalence. Empty by default; a UI can grow this list later. */
  aliases: string[];
}

/** One error binding expressed against the signature: `channel`/`target` are
 *  signature entry ids, never raw indices. `target: null` is the x-axis
 *  sentinel (mirrors `ErrorBinding.target === -1`, `lib/errorRoles.ts`). */
export interface RecipeErrorBinding {
  channel: string;
  target: string | null;
  axis: "x" | "y";
  side: ErrorSide;
}

/** The recipe's semantic bindings, expressed AGAINST THE SIGNATURE -- every
 *  field below is a signature entry id (or a list/null of them), never a
 *  dataset channel index. `plotRecipeMatch.ts`'s `resolveRecipe` is the only
 *  place these get re-keyed back into real indices for a specific dataset. */
export interface RecipeMapping {
  xId: string | null;
  yIds: string[];
  y2Ids: string[];
  groupId: string | null;
  facetId: string | null;
  errors: RecipeErrorBinding[];
}

/** Autoscale-vs-fixed range policy for one axis (P1.3's explicit ask: the
 *  recipe should carry the POLICY, not just a frozen numeric window --
 *  reapplying to different data with `{mode: "auto"}` autoscales fresh
 *  rather than replaying a stale range from the source dataset). */
export type RecipeAxisRange = { mode: "auto" } | { mode: "fixed"; lim: [number, number]; step?: number };

export interface RecipeAxisBreaks {
  x: [number, number][];
  y: [number, number][];
  y2: [number, number][];
}

/** Data-anchored overlays, captured verbatim. Marked as its own group (per
 *  the brief) so an apply step can offer them separately from the rest of
 *  the visual payload -- annotations/shapes/region shades are pinned at DATA
 *  coordinates from the SOURCE dataset and may simply not make sense on a
 *  differently-scaled target. */
export interface RecipeDecorations {
  annotations: Annotation[];
  shapes: Shape[];
  regionShades: RegionShade[];
}

/** The captured visual payload -- everything from `PlotView` (plus the mark,
 *  which lives on `FigureDocument.plot.mark`, not `PlotView`) that isn't a
 *  channel BINDING. `seriesStyles`/`seriesLabels`/`seriesOrder`/
 *  `hiddenChannels` are keyed by signature entry id, exactly like the
 *  mapping above -- a per-series style override travels with the semantic
 *  channel it was set on, not with a positional index. */
export interface RecipeVisual {
  mark: PlotMark;
  xScale: AxisScale;
  yScale: AxisScale;
  y2Scale: AxisScale | null;
  xRange: RecipeAxisRange;
  yRange: RecipeAxisRange;
  y2Range: RecipeAxisRange;
  xFmt: AxisFormat;
  yFmt: AxisFormat;
  y2Fmt: AxisFormat | null;
  axisBreaks: RecipeAxisBreaks;
  showLegend: boolean;
  legendPos: LegendPos;
  legendXY: [number, number] | null;
  legendTitle: string | null;
  legendStatic: boolean;
  stackMode: boolean;
  waterfall: number;
  plotTemplate: string;
  seriesStyles: Record<string, SeriesStyle>;
  seriesLabels: Record<string, string>;
  seriesOrder: string[] | null;
  hiddenChannels: string[];
  decorations: RecipeDecorations;
  /** Which arrangement (`lib/composition.ts`'s `CompositionKind`) was active
   *  at capture time, or null for a plain single-panel plot. The concrete
   *  panels themselves (`SpatialPanel`/`FacetPanel`/`BreakPanel`) are
   *  materialized render output tied to THIS dataset and are deliberately
   *  NOT captured -- they carry nothing reusable across datasets; the
   *  reusable knobs (which channel drives the facet/group) already live in
   *  `RecipeMapping.facetId`/`groupId` above. */
  compositionKind: CompositionKind | null;
}

export interface PlotRecipeProvenance {
  sourceDatasetLabel: string;
  appVersion: string;
}

export interface PlotRecipe {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  modifiedAt: string;
  schemaVersion: typeof PLOT_RECIPE_SCHEMA_VERSION;
  provenance: PlotRecipeProvenance;
  /** Equality-only scope (`lib/techniqueViewMemory.ts`'s rule): a recipe
   *  matches a dataset only when `techniqueOf(dataset) === technique`, and
   *  `"generic"` never matches anything at all (see `plotRecipeMatch.ts`). */
  technique: Technique;
  signature: RecipeSignatureEntry[];
  mapping: RecipeMapping;
  visual: RecipeVisual;
}
