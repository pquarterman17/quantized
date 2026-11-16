// Leaving step ④ (Fit & review) while the fit is still running would strand the
// result on a step that no longer shows it. ONE helper gates every way out —
// Next and the step chips — so a change to the rule is made once.

import type { PeakWizardState } from "./usePeakWizard";

const FIT_STEP = 3;

/** The reason navigation away from the current step is blocked right now, or
 *  null. `target` is the step the control would go to (omit for "any"). */
export function fitRunningBlock(w: Pick<PeakWizardState, "step" | "model">, target?: number): string | null {
  return w.step === FIT_STEP && w.model.busy && target !== FIT_STEP ? "peak fit running…" : null;
}
