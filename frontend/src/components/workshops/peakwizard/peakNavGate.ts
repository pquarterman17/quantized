// Leaving step ④ (Fit & review) while the fit is still running would strand the
// result on a step that no longer shows it. ONE helper gates every way out —
// Next, Back and the step chips — so a change to the rule is made once.

import type { PeakWizardState } from "./usePeakWizard";

const FIT_STEP = 3;

/** The reason navigation away from the current step is blocked right now, or
 *  null. `target` is the step the control would go to (omit for "any").
 *  Only the model engine's fit can be cancelled, hence the two wordings. */
export function fitRunningBlock(w: Pick<PeakWizardState, "step" | "model" | "fitBusy">, target?: number): string | null {
  if (w.step !== FIT_STEP || target === FIT_STEP) return null;
  if (w.model.busy) return "fitting — wait for it to finish, or cancel it";
  return w.fitBusy ? "fitting — wait for it to finish" : null;
}
