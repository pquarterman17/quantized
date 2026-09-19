// The one predicate that decides whether the on-plot result-chip cluster has
// anything to show (∫ Integrate · ∩ FWHM · ≈ the ROI gadget family).
//
// It lives in its own module because two places need it and they must never
// drift: `PlotResultChips` itself returns null when it is false, and
// `PlotStageOverlays` uses it as the gate in front of the chips' LAZY seam
// (bundle diet slice 4, plans/BUNDLE_HEADROOM.md). Duplicating the condition
// at the gate would mean a future chip kind shows up in the component but
// never gets its chunk requested — so the gate imports the same function the
// component does, and this module is deliberately the only eager thing the
// seam leaves behind.

import type { FwhmResult } from "../../lib/peakwidth";
import type { IntegralResult } from "../../store/useApp";
import type { GadgetChipState } from "./useGadgetChip";

export interface ResultChipInputs {
  integral: IntegralResult | null;
  fwhm: FwhmResult | null;
  /** Optional so callers/tests that don't exercise the #33/#34 ROI gadget
   *  family stay unchanged — mirrors `PlotResultChips`' own prop. */
  gadget?: GadgetChipState;
}

/** True when at least one chip would render. */
export function resultChipsVisible({ integral, fwhm, gadget }: ResultChipInputs): boolean {
  const showGadget = !!gadget && (gadget.roi != null || gadget.cursors != null || gadget.busy || gadget.error != null);
  return !!integral || !!fwhm || showGadget;
}
