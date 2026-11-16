// The one-line fit status in Curve Fit's sticky header (UX-F): what state the
// fit is in, in words, next to the Fit button that changes it -- so after a
// fit the outcome is readable without scrolling, the way OriginPro's NLFit
// keeps its status beside the persistent Fit/Done bar. Pure, for tests.

import { fmtR2, sigFigs } from "../../../lib/fitValueFormat";
import type { CalcResult } from "../../../lib/types";

export type FitStatusTone = "ok" | "warn" | "danger" | "dim";

export interface FitStatusInput {
  hasData: boolean;
  busy: boolean;
  /** The running job is an auto-guess, not a fit. */
  guessing?: boolean;
  error: string | null;
  result: CalcResult | null;
  guessOnly: boolean;
  stale: boolean;
  /** Fitting per level of a "By" column (the results are in the Results tab),
   *  and whether those fits are still running. */
  byLevels: number;
  byBusy?: boolean;
}

export function curveFitStatus(i: FitStatusInput): { text: string; tone: FitStatusTone } {
  if (!i.hasData) return { text: "Select a dataset to fit", tone: "dim" };
  if (i.busy) return { text: i.guessing ? "Guessing start values…" : "Fitting…", tone: "dim" };
  if (i.error) return { text: "Failed — see the message below", tone: "danger" };
  if (i.byLevels > 0) return { text: i.byBusy ? `Fitting ${i.byLevels} levels…` : `${i.byLevels} per-level fits — see Results`, tone: "dim" };
  const r = i.result;
  if (!r) return { text: "Not fitted yet", tone: "dim" };
  if (i.guessOnly) return { text: "Start values guessed — press Fit", tone: "dim" };
  if (r.exitFlag === 0) return { text: "Did not converge — see Results", tone: "danger" };
  const stats = `R² ${fmtR2(r.R2)} · χ²/dof ${sigFigs(r.chiSqRed, 3)}`;
  if (i.stale) return { text: `Inputs changed — refit (${stats})`, tone: "warn" };
  return { text: stats, tone: "ok" };
}
