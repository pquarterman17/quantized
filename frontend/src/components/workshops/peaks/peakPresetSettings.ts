// The Peaks panel's preset settings (plans/PRESET_BAR_CONTRACT.md P3): the
// detector's settings (every `find` field) and the fit controls (shape,
// background degree, linked widths, constrain centres), in one FLAT every-key
// object, which is what the shared strict parser and the contract test expect.
// Settings only: no dataset ids, no row ranges, no peak list (P5).
//
// These ARE a peak recipe's `find` and `model` sections (lib/peakwizard.ts),
// so `recipeFromSettings` / `candidateFromRecipe` are the exact pair between
// this flat form and the stored `PeakRecipe`. A recipe's other sections
// (range, baseline, report, model-fit edits) belong to the Peak analyzer; a
// save over an existing recipe keeps them untouched.

import { DEFAULT_RECIPE, type PeakRecipe } from "../../../lib/peakwizard";
import { DEFAULT_PEAK_FIND, type PeakFindParams } from "./peakFindParams";
import type { PeakFitOptions } from "./peakTypes";

export type PeakPresetSettings = PeakFindParams & { shape: string; bgDegree: number; linkMode: string; constrain: boolean };

export const DEFAULT_PEAK_FIT_OPTIONS: Readonly<PeakFitOptions> = Object.freeze({ model: "Lorentzian", bgDegree: 1, linkMode: "None", constrain: false });

export const FIND_KEYS = Object.keys(DEFAULT_PEAK_FIND) as (keyof PeakFindParams)[];

export const DEFAULT_PEAK_SETTINGS: Readonly<PeakPresetSettings> = Object.freeze({
  ...DEFAULT_PEAK_FIND,
  shape: DEFAULT_PEAK_FIT_OPTIONS.model,
  bgDegree: DEFAULT_PEAK_FIT_OPTIONS.bgDegree,
  linkMode: DEFAULT_PEAK_FIT_OPTIONS.linkMode,
  constrain: DEFAULT_PEAK_FIT_OPTIONS.constrain,
});

/** Only the known find keys, so a draft can never carry anything else into a preset. */
function pickFind(from: PeakFindParams): PeakFindParams {
  const out: Record<string, unknown> = {};
  for (const k of FIND_KEYS) out[k] = from[k];
  return out as unknown as PeakFindParams;
}

export function joinSettings(find: PeakFindParams, fit: PeakFitOptions): PeakPresetSettings {
  return { ...pickFind(find), shape: fit.model, bgDegree: fit.bgDegree, linkMode: fit.linkMode, constrain: fit.constrain };
}

export function splitSettings(s: PeakPresetSettings): { find: PeakFindParams; fit: PeakFitOptions } {
  return { find: pickFind(s), fit: { model: s.shape, bgDegree: s.bgDegree, linkMode: s.linkMode, constrain: s.constrain } };
}

/** The recipe these settings make: `base` (an existing recipe, or the defaults) with only `find` and `model` replaced. */
export function recipeFromSettings(name: string, s: PeakPresetSettings, base: PeakRecipe = DEFAULT_RECIPE): PeakRecipe {
  const { find, fit } = splitSettings(s);
  return { ...base, version: 2, name, find, model: { ...base.model, shape: fit.model, bgDegree: fit.bgDegree, linkMode: fit.linkMode, constrain: fit.constrain } };
}

/** A stored recipe in the flat form, for the strict parser. An absent advanced
 *  find field is the route's default (what a recipe means by absent); a key
 *  this build does not know is carried so the parser names it. */
export function candidateFromRecipe(r: PeakRecipe): Record<string, unknown> {
  const { shape, bgDegree, linkMode, constrain, ...extraModel } = r.model as PeakRecipe["model"] & Record<string, unknown>;
  return { ...DEFAULT_PEAK_FIND, ...r.find, ...extraModel, shape, bgDegree, linkMode, constrain };
}
