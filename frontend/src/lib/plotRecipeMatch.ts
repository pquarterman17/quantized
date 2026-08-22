// Plot recipe matching (P1.3 / F4.3): resolve a saved `PlotRecipe` against a
// LIVE dataset, re-keying every signature-entry reference back into that
// dataset's real channel indices. Builds directly on
// `lib/quickPlotTemplates.ts`'s `resolveTemplate` (H4) idioms -- technique
// equality, per-channel re-key by LABEL (never index), and the errorRole
// guard that refuses rebinding a value column as an error column -- but
// diverges from it in one deliberate way the brief calls out explicitly:
//
//   quickPlotTemplates' `resolveTemplate` is refusal-OR-NOTHING -- any single
//   unresolved mapped column refuses the WHOLE apply. This module is softer
//   by design: an individually unresolved channel/field is collected into
//   `unmatched` and the rest of the recipe still resolves, because P1.3's
//   contract is "ambiguous matches show mapping/preview and report unmatched
//   fields" -- the store layer turns a non-empty `unmatched` into a preview+
//   confirm step, never a silent partial apply. Only TWO conditions are hard
//   refusals here (the `{ refused }` branch, short-circuiting before any
//   partial result is built): a technique mismatch, and an errorRole-guard
//   violation -- both name a plot that would be SEMANTICALLY WRONG if
//   applied at all (an intensity column plotted as error whiskers, or a
//   completely unrelated technique's figure), not merely incomplete.

import { inferErrorBindings, type ErrorBinding } from "./errorRoles";
import type { LegendPos } from "./plotview";
import type { PlotMark } from "./plotspec";
import type { SignatureErrorRole } from "./quickPlotTemplates";
import { techniqueOf } from "./techniqueDefaults";
import type { AxisFormat, AxisScale, Dataset, SeriesStyle } from "./types";
import type { CompositionKind } from "./composition";
import {
  classifyErrorRole,
  normalizeLabel,
  type PlotRecipe,
  type RecipeAxisBreaks,
  type RecipeAxisRange,
  type RecipeChannelRole,
  type RecipeDecorations,
  type RecipeSignatureEntry,
} from "./plotRecipe";

/** The re-keyed mapping, ready to apply to `dataset` -- the `PlotView`/
 *  `FigureBindings` shape, but assembled fresh rather than a patch (the
 *  store layer decides how to merge it onto a live view). */
export interface ResolvedRecipeMapping {
  xKey: number | null;
  yKeys: number[];
  y2Keys: number[];
  groupKey: number | null;
  facetKey: number | null;
  errors: ErrorBinding[];
}

/** The re-keyed visual payload -- identical field set to `RecipeVisual`
 *  except every signature-entry-id key/list is now a real channel index, and
 *  entries whose signature entry didn't resolve are dropped (their channel
 *  is already named in `unmatched`; there is nothing sane to key a style
 *  override to). */
export interface ResolvedRecipeVisual {
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
  seriesStyles: Record<number, SeriesStyle>;
  seriesLabels: Record<number, string>;
  seriesOrder: number[] | null;
  hiddenChannels: number[];
  decorations: RecipeDecorations;
  compositionKind: CompositionKind | null;
}

export interface ResolvedRecipeApplication {
  mapping: ResolvedRecipeMapping;
  visual: ResolvedRecipeVisual;
}

export type RecipeResolution =
  | { resolved: ResolvedRecipeApplication; unmatched: string[]; warnings: string[] }
  | { refused: string };

const ROLE_LABEL: Record<RecipeChannelRole, string> = {
  x: "X axis",
  y: "Y series",
  y2: "Y2 series",
  group: "Group",
  facet: "Facet",
  error: "Error channel",
};

function fieldName(entry: RecipeSignatureEntry): string {
  return `${ROLE_LABEL[entry.role]} ("${entry.label}")`;
}

/** Find a current channel matching `entry` by label, then by alias -- never
 *  by index or position (the P1.3 "reordered equivalent XRD columns map
 *  correctly" case). Both the primary label and every alias fold case and
 *  whitespace via `normalizeLabel` (the same fold `lib/quickPlotTemplates.ts`
 *  uses for its schema fingerprint) -- a rename that only changes case/
 *  spacing should not by itself break a recipe the way it would break
 *  `quickPlotTemplates`' EXACT-string re-key, since here the signature entry
 *  IS the primary matching key (not a side fingerprint next to an exact-
 *  label snapshot). */
function findChannel(labels: readonly string[], entry: RecipeSignatureEntry): number | null {
  const target = normalizeLabel(entry.label);
  const aliases = new Set(entry.aliases.map(normalizeLabel));
  for (let i = 0; i < labels.length; i++) {
    const norm = normalizeLabel(labels[i]);
    if (norm === target || aliases.has(norm)) return i;
  }
  return null;
}

/** Resolve `recipe` against `dataset`. Pure -- never mutates either
 *  argument. See the module doc for the refusal-vs-unmatched split. */
export function resolveRecipe(recipe: PlotRecipe, dataset: Dataset): RecipeResolution {
  // "generic" never matches anything (lib/techniqueViewMemory.ts's rule,
  // deliberately STRONGER here than a memory lookup's silent skip): there is
  // no meaningful similarity between two unclassified datasets to trade a
  // recipe on, so a generic-scoped recipe is refused even against another
  // generic dataset, not merely against every OTHER technique.
  if (recipe.technique === "generic") {
    return { refused: "recipes scoped to \"generic\" never match (no reliable similarity between unclassified datasets)" };
  }
  const currentTechnique = techniqueOf(dataset);
  if (currentTechnique !== recipe.technique) {
    return { refused: `saved for ${recipe.technique}, not ${currentTechnique}` };
  }

  const labels = dataset.data.labels;
  const units = dataset.data.units;
  const currentBindings = dataset.errorRoles ?? inferErrorBindings(dataset.data);
  const currentErrorRole = (channel: number): SignatureErrorRole => classifyErrorRole(currentBindings, channel);

  const unmatched: string[] = [];
  const warnings: string[] = [];
  const resolvedByEntry = new Map<string, number>();

  for (const entry of recipe.signature) {
    const idx = findChannel(labels, entry);
    if (idx === null) {
      unmatched.push(fieldName(entry));
      continue;
    }
    // The unit trap (a column named "B" in Oe at save time, "B" in Tesla
    // now): only checked when the recipe actually recorded a unit -- an
    // entry saved with no unit has nothing to compare against and always
    // passes this check, same "nothing to check" convention
    // `quickPlotTemplates.ts`'s `resolveChannel` uses.
    if (entry.unit && units[idx] !== entry.unit) {
      warnings.push(`${fieldName(entry)}: unit changed (saved "${entry.unit}", now "${units[idx] || "(none)"}")`);
      unmatched.push(fieldName(entry));
      continue;
    }
    // The errorRole guard (P1-4 idiom, quickPlotTemplates.ts ~238-264): a
    // resolved column whose CURRENT error-role classification no longer
    // matches what it was captured as is not evidence of "the same column"
    // -- it's evidence of a coincidental label collision with a column that
    // now means something structurally different (a value column renamed to
    // what used to be an error column's name, or vice versa). Unlike
    // quickPlotTemplates (which folds this into its own unmatched list),
    // this is a HARD REFUSAL here per the brief: plotting a value column as
    // error whiskers (or an uncertainty column as data) is a worse failure
    // than an unresolved channel, so the whole resolve aborts rather than
    // silently building a plot around it.
    const current = currentErrorRole(idx);
    if (current !== entry.errorRole) {
      return {
        refused:
          `${fieldName(entry)}: saved as "${entry.errorRole}", now classified as "${current}" -- ` +
          "refusing to rebind a value column as an error column (or vice versa)",
      };
    }
    resolvedByEntry.set(entry.id, idx);
  }

  const resolveOne = (id: string | null): number | null => (id === null ? null : resolvedByEntry.get(id) ?? null);
  const resolveList = (ids: readonly string[]): number[] =>
    ids.flatMap((id) => {
      const ch = resolvedByEntry.get(id);
      return ch !== undefined ? [ch] : [];
    });

  const xKey = resolveOne(recipe.mapping.xId);
  const yKeys = resolveList(recipe.mapping.yIds);
  const y2Keys = resolveList(recipe.mapping.y2Ids);
  const groupKey = resolveOne(recipe.mapping.groupId);
  const facetKey = resolveOne(recipe.mapping.facetId);

  const errors: ErrorBinding[] = [];
  for (const e of recipe.mapping.errors) {
    const channel = resolvedByEntry.get(e.channel);
    if (channel === undefined) continue; // already named in `unmatched` above
    const target = e.target === null ? -1 : resolvedByEntry.get(e.target);
    if (target === undefined) continue;
    errors.push({ channel, target, axis: e.axis, side: e.side });
  }

  const pickRecord = <T>(rec: Readonly<Record<string, T>>): Record<number, T> => {
    const out: Record<number, T> = {};
    for (const [id, val] of Object.entries(rec)) {
      const ch = resolvedByEntry.get(id);
      if (ch !== undefined) out[ch] = val;
    }
    return out;
  };
  const pickNumList = (ids: readonly string[]): number[] => resolveList(ids);

  const resolved: ResolvedRecipeApplication = {
    mapping: { xKey, yKeys, y2Keys, groupKey, facetKey, errors },
    visual: {
      mark: recipe.visual.mark,
      xScale: recipe.visual.xScale,
      yScale: recipe.visual.yScale,
      y2Scale: recipe.visual.y2Scale,
      xRange: recipe.visual.xRange,
      yRange: recipe.visual.yRange,
      y2Range: recipe.visual.y2Range,
      xFmt: recipe.visual.xFmt,
      yFmt: recipe.visual.yFmt,
      y2Fmt: recipe.visual.y2Fmt,
      axisBreaks: recipe.visual.axisBreaks,
      showLegend: recipe.visual.showLegend,
      legendPos: recipe.visual.legendPos,
      legendXY: recipe.visual.legendXY,
      legendTitle: recipe.visual.legendTitle,
      legendStatic: recipe.visual.legendStatic,
      stackMode: recipe.visual.stackMode,
      waterfall: recipe.visual.waterfall,
      plotTemplate: recipe.visual.plotTemplate,
      seriesStyles: pickRecord(recipe.visual.seriesStyles),
      seriesLabels: pickRecord(recipe.visual.seriesLabels),
      seriesOrder: recipe.visual.seriesOrder ? pickNumList(recipe.visual.seriesOrder) : null,
      hiddenChannels: pickNumList(recipe.visual.hiddenChannels),
      decorations: recipe.visual.decorations,
      compositionKind: recipe.visual.compositionKind,
    },
  };

  return { resolved, unmatched, warnings };
}
