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

import type { ColormapName } from "./colormap";
import type { CompositionKind } from "./composition";
import type { ErrorSide } from "./errorRoles";
import type { NormalizedFrameRect } from "./originPanels";
import type { PageSetup } from "./pagesetup";
import type { PanelFit } from "./panelFit";
import type { LegendPos } from "./plotview";
import type { PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import type {
  Annotation,
  AxisFormat,
  AxisScale,
  RefLine,
  RegionShade,
  SeriesStyle,
  Shape,
  Technique,
} from "./types";

/** v2 (F4.2 / audit P1.3 recipe gaps) added `preview`, `outlierPolicy` and
 *  `transform`; v3 (F4.4's SPATIAL half) added `panels` and `map` -- see
 *  `PlotRecipe`. Older persisted recipes still load:
 *  `lib/plotRecipeMigrate.ts` walks them forward one version at a time on
 *  every read boundary (`.dwk`, global localStorage, an imported file), so
 *  the rest of the app only ever sees the current shape. A recipe from a
 *  NEWER build is refused by name, never guessed at. */
export const PLOT_RECIPE_SCHEMA_VERSION = 3 as const;

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
  /** Fixed reference lines (P2.1 built-in recipes: an M(H) loop's H=0/M=0
   *  zero lines) -- captured/applied VERBATIM, exactly like `decorations`
   *  below, never re-derived from the target dataset. Added additively
   *  (no `PLOT_RECIPE_SCHEMA_VERSION` bump): an older persisted recipe
   *  simply lacks the field and every reader (`plotRecipeIO.ts`'s
   *  `sanitizeVisual`, `plotRecipeIO.ts`'s `defaultRecipeVisual`) defaults
   *  it to `[]`, so no migration is needed. */
  refLines: RefLine[];
  showLegend: boolean;
  legendPos: LegendPos;
  legendXY: [number, number] | null;
  legendSize: [number, number] | null;
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
   *  at capture time, or null for a plain single-panel plot. FACET and BREAK
   *  panels are materialized render output rebuilt from the durable knobs
   *  (`RecipeMapping.facetId`, `axisBreaks` above) and are not captured;
   *  SPATIAL panels have no such knob, so they are captured by name in
   *  `PlotRecipe.panels` (v3). */
  compositionKind: CompositionKind | null;
}

/** One SPATIAL panel (`lib/multipanel.ts`'s `SpatialPanel`), expressed by
 *  NAME rather than index so it can be rebuilt against a later dataset:
 *  `dataset` is null for "the dataset the recipe is applied to" and the
 *  source dataset's name otherwise (re-bound by name on apply, or by the
 *  user's explicit choice in the apply dialog); every channel field is a
 *  column LABEL, matched with the same exact/folded tiers a signature entry
 *  gets (`lib/plotRecipePanels.ts`). Axis ranges are FIXED by construction
 *  (a spatial panel always carries its own decoded/edited limits -- there is
 *  no autoscale policy to record). `seriesStyles`/`seriesLabels`/`errKeys`
 *  are keyed by label; `errKeys` maps a value label to its error label. */
export interface RecipePanel {
  dataset: string | null;
  x: string | null;
  y: string[];
  y2: string[];
  xLim: [number, number];
  yLim: [number, number];
  y2Lim: [number, number] | null;
  xStep: number | null;
  yStep: number | null;
  y2Step: number | null;
  xLog: boolean;
  yLog: boolean;
  y2Log: boolean;
  xAxisLabel?: string | null;
  yAxisLabel?: string;
  y2AxisLabel?: string;
  legendTitle?: string;
  seriesStyles: Record<string, SeriesStyle>;
  seriesLabels: Record<string, string>;
  hiddenChannels: string[];
  errKeys: Record<string, string>;
  annotations: Annotation[];
  regionShades: RegionShade[];
  row: number;
  col: number;
  frameRect?: NormalizedFrameRect;
  layoutAspect?: number;
  pageRect?: NormalizedFrameRect;
  pageAspect?: number;
}

/** v3: the spatial composition the recipe was saved from -- the panels plus
 *  the two `PlotView` fields only a spatial view reads (`panelFit`,
 *  `pageSetup`). Null when the source was not a spatial multi-panel window. */
export interface RecipePanels {
  panels: RecipePanel[];
  panelFit: PanelFit;
  pageSetup: PageSetup | null;
}

/** v3: the source dataset's durable 2-D map view decisions
 *  (`lib/mapView.ts`'s colour scale, limits and colormap) -- captured only
 *  when they differ from the default, applied to the target dataset's own
 *  map view. Slices and map annotations are data-anchored and stay with the
 *  source dataset. */
export interface RecipeMapView {
  colormap: ColormapName;
  logZ: boolean;
  colorLimits: [number, number] | null;
}

/** A captured, data-free preview of the plot the recipe was saved from:
 *  up to 4 plotted series of up to 48 points each, every coordinate
 *  normalized to [0, 1] in the axis's own scale (log where the view was
 *  log). Numbers only, never markup, so an imported recipe cannot smuggle
 *  SVG/HTML into the thumbnail that renders it. */
export interface RecipePreview {
  series: [number, number][][];
}

/** How rows excluded from analysis (outliers the user excluded, or rows a
 *  data filter drops) were drawn when the recipe was saved -- the app-wide
 *  "Excluded rows" preference at capture time. Recorded, and reported on
 *  apply when it differs from the current preference; never applied, since
 *  that preference is app-wide and changing it would restyle every other
 *  plot too. */
export interface RecipeOutlierPolicy {
  excludedDisplay: "hide" | "grey";
}

/** The saved transformation recipe (a Pipeline analysis template, P2.5) the
 *  SOURCE dataset was derived with, read off its `metadata.transform_recipe`
 *  provenance at capture time. A reference by name + revision only; running
 *  it is always the user's explicit choice in the Recipe Manager. */
export interface RecipeTransformRef {
  name: string;
  revision: number;
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
  /** Opt-out from every AUTOMATIC suggestion surface (`store/
   *  plotRecipeApply.ts`'s `resolvedCandidates`, which feeds both
   *  `matchingPlotRecipes` and the post-import `cleanMatchingPlotRecipe`
   *  toast) while remaining fully applicable MANUALLY, like any other
   *  project/global recipe -- unlike `lib/builtinPlotRecipes.ts`'s built-ins,
   *  which are excluded from those surfaces structurally (never a member of
   *  either live list), a "Copy to Project" landed COPY of one *is* an
   *  ordinary list member, so it needs this explicit flag to keep the same
   *  "built-ins are never offered automatically" promise (code-review
   *  finding 7). Added additively (no `PLOT_RECIPE_SCHEMA_VERSION` bump,
   *  same convention as `RecipeVisual.refLines`): absent/`undefined` on an
   *  older or ordinarily-captured recipe means "eligible", so no migration
   *  is needed. */
  noAutoSuggest?: boolean;
  /** v2. Null when there was nothing plottable, or for a recipe migrated
   *  from v1 (it was never captured -- never invented after the fact). */
  preview: RecipePreview | null;
  /** v2. Null for a migrated v1 recipe or a built-in: not recorded. */
  outlierPolicy: RecipeOutlierPolicy | null;
  /** v2. Null when the source dataset was not a transformation output. */
  transform: RecipeTransformRef | null;
  /** v3. Null for a plain (non-spatial) source window or a migrated recipe. */
  panels: RecipePanels | null;
  /** v3. Null when the source dataset's map view was untouched, or migrated. */
  map: RecipeMapView | null;
}
