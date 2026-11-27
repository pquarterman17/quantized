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
  /** The live-fit / quick-analysis tool is armed: its chip row shows (with a hint) before any region exists. */
  armed?: boolean;
}

/** Does the gadget chip row show? A region, cursors, a running or failed measurement, or the tool armed. */
export const gadgetChipShown = (gadget: GadgetChipState | undefined, armed?: boolean): boolean =>
  !!gadget && (gadget.roi != null || gadget.cursors != null || gadget.busy || gadget.error != null || !!armed);

/** True when at least one chip would render. */
export function resultChipsVisible({ integral, fwhm, gadget, armed }: ResultChipInputs): boolean {
  return !!integral || !!fwhm || gadgetChipShown(gadget, armed);
}
