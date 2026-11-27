// Distribution workshop: the "Distribution fit" choices, the one list. The
// panel's select and the preset adapter both derive from it, so a family added
// to lib/distpdf is offered, reopened and accepted by presets with no second
// list to forget.

import { DIST_FAMILIES } from "../../../lib/distpdf";
import type { FitPick } from "./useDistribution";

export const FIT_PICKS: readonly FitPick[] = ["none", ...DIST_FAMILIES];

export const FIT_OPTIONS: { value: FitPick; label: string }[] = FIT_PICKS.map((value) => ({
  value,
  label: value === "none" ? "None" : value,
}));
