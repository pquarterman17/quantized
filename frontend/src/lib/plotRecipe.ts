// Plot recipes (PRIMARY_SOFTWARE_AUDIT_PLAN P1.3 / FIGURE_AUTHORING_WORKFLOW_PLAN
// F4): a NAMED, SAVED figure recipe -- semantic X/Y/error/group/facet roles
// plus the full visual payload, captured once explicitly from a live PlotView
// (never auto-saved), that a later dataset of the SAME technique can try to
// REAPPLY. Matching lives in `plotRecipeMatch.ts`; parsing/sanitizing for the
// untrusted `.dwk`/import boundary lives in `plotRecipeIO.ts`. This module
// owns only the schema itself and the pure capture half.
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
// agnostic means import/export/duplicate can move a recipe between scopes
// without touching a single field on it.

import type { ErrorBinding, ErrorSide } from "./errorRoles";
import { isAxisScale, type LegendPos, type PlotView } from "./plotview";
import type { PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import { techniqueOf } from "./techniqueDefaults";
import type { Annotation, AxisFormat, AxisScale, Dataset, RegionShade, Shape, SeriesStyle, Technique } from "./types";
import type { Composition, CompositionKind } from "./composition";

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
 *  and whitespace (see `normalizeLabel` below) on both `label` and every
 *  `aliases` entry. `errorRole` is the `SignatureErrorRole` classification
 *  (`lib/quickPlotTemplates.ts`) this channel had at capture time -- the
 *  guard `resolveRecipe` uses to refuse rebinding a value column as an error
 *  column (or vice versa) when the SAME label now classifies differently. */
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

/** Fold case + whitespace for label/alias comparison -- the exact convention
 *  `lib/quickPlotTemplates.ts`'s private `normalizeLabel` uses for its own
 *  schema fingerprint. Exported so `plotRecipeMatch.ts` folds through the
 *  identical rule rather than a second, possibly-drifting copy. */
export function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

const ERROR_SIDE_SUFFIX: Record<ErrorSide, string> = { both: "", "+": "+", "-": "-" };

/** The `SignatureErrorRole` classification for `channel` given `bindings` --
 *  mirrors `lib/quickPlotTemplates.ts`'s private `errorRoleFor` (that helper
 *  isn't exported, and this module intentionally stays independent of it
 *  rather than reaching into another feature's private surface). Exported so
 *  `plotRecipeMatch.ts` classifies a dataset's CURRENT channels through the
 *  same rule capture used. */
export function classifyErrorRole(bindings: readonly ErrorBinding[], channel: number): SignatureErrorRole {
  const binding = bindings.find((b) => b.channel === channel);
  if (!binding) return "value";
  return `error-${binding.axis}${ERROR_SIDE_SUFFIX[binding.side]}` as SignatureErrorRole;
}

function rangeFrom(lim: [number, number] | null, step: number | null): RecipeAxisRange {
  if (lim === null) return { mode: "auto" };
  return step === null ? { mode: "fixed", lim } : { mode: "fixed", lim, step };
}

/** Reconstruct `ErrorBinding[]` from `PlotView.errKeys` (target -> error
 *  channel), the same back-compat projection `lib/figureDocument.ts`'s
 *  private `legacyErrorBindings` performs for the identical legacy shape --
 *  duplicated here (that helper isn't exported either) rather than widening
 *  either module's public surface for a five-line adapter. */
function legacyErrorBindingsFromErrKeys(errKeys: Readonly<Record<number, number>>): ErrorBinding[] {
  const out: ErrorBinding[] = [];
  for (const [target, channel] of Object.entries(errKeys)) {
    const targetKey = Number(target);
    if (Number.isInteger(targetKey) && Number.isInteger(channel)) {
      out.push({ channel, target: targetKey, axis: "y", side: "both" });
    }
  }
  return out;
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
  const errorBindings = opts.errors ?? legacyErrorBindingsFromErrKeys(view.errKeys);

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
      errorRole: classifyErrorRole(errorBindings, channel),
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

  const pickRecord = <T>(rec: Readonly<Record<number, T>>): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const [k, val] of Object.entries(rec)) {
      const id = channelToId.get(Number(k));
      if (id !== undefined) out[id] = val;
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
