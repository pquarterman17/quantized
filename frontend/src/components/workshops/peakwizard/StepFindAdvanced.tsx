// Peak Analyzer step ② ▸ Advanced — the Peaks panel's detector settings
// (peaks/PeakFindAdvanced.tsx, loaded lazily: the disclosure is rarely
// opened) over the recipe's `find` section. The panel component edits a
// local draft and hands back a FULL `PeakFindParams` on "Find again" /
// "Defaults"; here that becomes the recipe's `find` (every field written, so
// a later "Defaults" really clears an earlier edit) and the find re-runs
// with exactly those settings — `runFind(params)`, because the hook's own
// closure still holds the pre-patch recipe in the same gesture. A saved
// recipe then carries the settings, and the batch runner's `recipeFind`
// (./recipeSteps) sends them too.
//
// `value` is memoized on `recipe.find` (a new object only when the recipe's
// find is patched): the panel resets its draft whenever `value` changes
// identity, so an unrelated re-render must not hand it a fresh object.

import { useMemo } from "react";

import { lazyRegion } from "../../../lib/lazyRegion";
import { DEFAULT_PEAK_FIND, type PeakFindParams } from "../peaks/peakFindParams";
import type { PeakWizardState } from "./usePeakWizard";

const PeakFindAdvanced = lazyRegion(() => import("../peaks/PeakFindAdvanced"), "Advanced");

export default function StepFindAdvanced({ w }: { w: PeakWizardState }) {
  const find = w.recipe.find;
  const value = useMemo<PeakFindParams>(() => ({ ...DEFAULT_PEAK_FIND, ...find }), [find]);
  return (
    <PeakFindAdvanced
      value={value}
      busy={w.findBusy}
      onApply={(params) => {
        w.patchRecipe({ find: params });
        void w.runFind(params);
      }}
    />
  );
}
