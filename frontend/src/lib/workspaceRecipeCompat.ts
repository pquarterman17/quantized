// Forward compatibility of the NESTED fields of a saved analysis recipe (plan item 7, last sub-task).
//
// `workspaceForwardCompat.ts` classifies every TOP-LEVEL `.dwk` key and the persisted view/figure types, but a
// saved recipe is a JSON object inside a container that older releases carry opaquely, so a field added to it
// since v0.45.0 is invisible to those maps. v0.45.0 re-reads such a recipe with a sanitizer that picks the keys
// it knows (MEASURED by `git show v0.45.0:frontend/src/lib/spectralWorkbench.ts`, `sanitizeSpectralRecipe`), so it
// drops the new field silently and then re-runs the recipe with the old default: a different answer, no warning.
//
// EVERY NESTED RECIPE FIELD HAS A CLASS (`RecipeClass`):
//   v045       v0.45.0 reads it. Nothing to do.
//   safe-drop  new, but v0.45.0 dropping it gives the same result (its default IS the old behaviour, or it is only
//              read by a feature v0.45.0 refuses at its own boundary). Needs a stated reason next to the entry.
//   gated      new AND result-changing: a file holding one is written as v9 (`NEW_SINCE_V045`), which v0.34-v0.45
//              refuse, so an older release cannot silently re-run the recipe differently.
// Each map is `Record<keyof T, RecipeClass>`, so ADDING A FIELD TO THE TYPE FAILS `tsc -b` until it is classified
// here. The type cannot see the sanitizers, so `workspaceRecipeCompat.test.ts` also runs each recipe sanitizer over
// a kitchen-sink input and requires that every key it keeps is classified (a sanitizer that learns a key the type
// map lacks fails there), and that every classified key is kept (a stale entry fails).
//
// WHERE A RECIPE LIVES IN A `.dwk` (all found by shape, in `featuresV034WouldDrop`'s walk): `datasets[].analysisRecipe`,
// `pipeline[].params.recipe` (a Pipeline / macro transform step) and `analysisTemplates[].steps[].params.recipe`
// (a saved transformation recipe) hold a `SignalAnalysisRecipe`; `analysisResults[].parameters.recipe` holds a tool's
// recipe, of which only the Distribution workshop's has gained a field since v0.45.0.
//
// NOT IN THE `.dwk` AT ALL, so not classified here: Peak Wizard recipes (`PeakRecipe.report.integrateBaseline` and the
// Advanced `find` fields), `qz.presets`, saved fit/graph/analysis recipe libraries and recipe files. They live in
// browser storage or their own versioned files, never in a project (`lib/nameKeyedRecipes.ts`), and the integrate-only
// path never saves its baseline into a result's parameters.
//
// REFUSED BY v0.45.0 AT ITS OWN BOUNDARY (a new VALUE, not a new field; not silent, so not gated): the new sigop
// `method` values of a transform step (v0.45.0's `sigopParamsOf` throws "unknown signal operation"), the Statistical
// Tests ids `row-t-tests` / `mann-kendall` / `seasonal-mann-kendall` and `more.posthoc: "steel-dwass"` (v0.45.0's
// `statisticalTestRecipe` returns null for them, so the result keeps its tables but cannot be reopened as a run).
//
// This module is a leaf: types only, plus pure functions. It must not import `workspaceForwardCompat.ts`.

import type { DistributionRecipe } from "./distributionAnalysisResult";
import type { CorrectionParams } from "./correctionTypes";
import type { IirSpec } from "./spectralIir";
import type { SignalChannelRef, SignalCorrectionRecipe } from "./signalRecipe";
import type { SpectralAnalysisRecipe, SpectralChannelRef, SpectralSecondarySource } from "./spectralWorkbench";
import type { TestParams } from "./statsTests";

export type RecipeClass = "v045" | "safe-drop" | "gated";
type Classify<T> = Record<keyof T, RecipeClass>;

const V = "v045" as const;
const S = "safe-drop" as const;
const G = "gated" as const;

/** A spectral (FFT / filter / correlation) recipe. `psdScaling: "spectrum"` is power per bin; v0.45.0 knows only
 *  power per frequency unit and drops the key, so the same recipe would re-run on a different scale (#1062). */
export const SPECTRAL_RECIPE: Classify<SpectralAnalysisRecipe> = {
  kind: V, version: V, operation: V, channels: V, secondarySource: V, xUnit: V, xMin: V, xMax: V, resample: V,
  outputType: V, sided: V, window: V, detrend: V, zeroPad: V, segmentLen: V, overlap: V, filterType: V, cutoff: V,
  bandwidth: V, order: V, correlationDemean: V, iir: V, inputRows: V,
  psdScaling: G,
};
export const SPECTRAL_CHANNEL: Classify<SpectralChannelRef> = { index: V, label: V, unit: V };
export const SPECTRAL_SECONDARY: Classify<SpectralSecondarySource> = { datasetId: V, datasetName: V, channel: V, xUnit: V };
export const IIR_SPEC: Classify<IirSpec> = {
  family: V, btype: V, order: V, cutoff: V, rp: V, rs: V, besselNorm: V, zeroPhase: V,
};

/** A correction-backed signal recipe (Smooth, Normalise, Detrend, derivatives). Nothing is new since v0.45.0. */
export const CORRECTION_RECIPE: Classify<SignalCorrectionRecipe> = {
  kind: V, version: V, operation: V, channels: V, xUnit: V, params: V, inputRows: V,
};
export const SIGNAL_CHANNEL: Classify<SignalChannelRef> = { index: V, label: V, unit: V };
/** The `CorrectionParams` keys a signal recipe's sanitizer (`sanitizeCorrectionParams`) allows, and no others. */
type RecipeParamKey =
  | "signalChannels" | "xTrimMin" | "xTrimMax" | "dropYUncertainty" | "smoothEnabled" | "smoothWindow"
  | "smoothMethod" | "smoothPolyOrder" | "normMethod" | "normReferenceValue" | "normReferenceMin"
  | "normReferenceMax" | "detrendOrder" | "derivativeMode";
export const CORRECTION_RECIPE_PARAMS: Classify<Pick<CorrectionParams, RecipeParamKey>> = {
  signalChannels: V, xTrimMin: V, xTrimMax: V, dropYUncertainty: V, smoothEnabled: V, smoothWindow: V,
  smoothMethod: V, smoothPolyOrder: V, normMethod: V, normReferenceValue: V, normReferenceMin: V,
  normReferenceMax: V, detrendOrder: V, derivativeMode: V,
};

/** The Distribution workshop's saved recipe (`AnalysisResult.parameters.recipe`). v0.45.0's `distributionRecipe`
 *  keeps the five fields it knows, so a reopened result would lose a chosen confidence level (and the bootstrap
 *  rows) and re-save at the default. The defaults (95 %, no bootstrap) equal what v0.45.0 does, so only a value
 *  OFF the default gates (`RECIPE_DEFAULTS`). */
export const DISTRIBUTION_RECIPE: Classify<DistributionRecipe> = {
  col: V, byCol: V, fitDist: V, compareOpen: V, percentileInput: V,
  ciPercent: G, ciBootstrap: G,
};

/** The Statistical Tests run settings (`AnalysisResult.parameters.params`). `rowt` is only read by the row-wise
 *  tests, whose ids v0.45.0 refuses on reopen, and it is always the default for every other test: safe to drop. */
export const STATS_TEST_PARAMS: Classify<TestParams> = {
  alpha: V, alternative: V, ssType: V, criterion: V, direction: V, effectSize: V, n: V, power: V, kind: V, tails: V,
  adjustMethod: V, gofExpected: V, survivalGroups: V, more: V, spc: V, life: V, screen: V,
  rowt: S,
};

/** Every classification map by type name (the test's ratchet reads this). */
export const RECIPE_CLASSIFICATIONS: Readonly<Record<string, Readonly<Record<string, RecipeClass>>>> = {
  SpectralRecipe: SPECTRAL_RECIPE,
  SpectralChannel: SPECTRAL_CHANNEL,
  SpectralSecondary: SPECTRAL_SECONDARY,
  IirSpec: IIR_SPEC,
  CorrectionRecipe: CORRECTION_RECIPE,
  SignalChannel: SIGNAL_CHANNEL,
  CorrectionRecipeParams: CORRECTION_RECIPE_PARAMS,
  DistributionRecipe: DISTRIBUTION_RECIPE,
  StatsTestParams: STATS_TEST_PARAMS,
};

/** The gated features (`Type.field`) in NEW_SINCE_V045: derived from the maps, so a new `G` entry is listed with it. */
export const RECIPE_GATED_FEATURES: readonly string[] = Object.entries(RECIPE_CLASSIFICATIONS)
  .flatMap(([type, map]) => Object.keys(map).filter((k) => map[k] === "gated").map((k) => `${type}.${k}`));

/** A gated field whose DEFAULT is what v0.45.0 does anyway: only a value off the default gates. */
const RECIPE_DEFAULTS: Readonly<Record<string, unknown>> = {
  "DistributionRecipe.ciPercent": 95, // = DEFAULT_CI_PERCENT (pinned by the test)
  "DistributionRecipe.ciBootstrap": false,
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function checkRecipe(o: Obj, type: string, map: Readonly<Record<string, RecipeClass>>, found: Set<string>): void {
  for (const k of Object.keys(map)) {
    const feature = `${type}.${k}`;
    if (map[k] !== "gated" || o[k] === undefined || o[k] === null) continue;
    if (feature in RECIPE_DEFAULTS ? o[k] !== RECIPE_DEFAULTS[feature] : o[k] !== false) found.add(feature);
  }
}

/** Add the gated recipe features `o` holds when it is a spectral signal recipe (found by shape, wherever it nests:
 *  a dataset, a pipeline step or a saved transformation recipe). */
export function checkSignalRecipe(o: Obj, found: Set<string>): void {
  if (o.kind === "spectral" && typeof o.operation === "string" && Array.isArray(o.channels)) checkRecipe(o, "SpectralRecipe", SPECTRAL_RECIPE, found);
}

/** Add the gated recipe features a saved `AnalysisResult` holds in `parameters.recipe`. */
export function checkResultRecipe(result: unknown, found: Set<string>): void {
  if (!isObj(result) || !isObj(result.parameters) || !isObj(result.parameters.recipe)) return;
  if (isObj(result.producer) && result.producer.id === "distribution-analysis") {
    checkRecipe(result.parameters.recipe, "DistributionRecipe", DISTRIBUTION_RECIPE, found);
  }
}
