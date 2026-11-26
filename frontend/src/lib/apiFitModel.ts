// The named-model fit wrapper, split out of lib/apiLazy.ts and re-exported from
// lib/api.ts (bundle diet slice 35). It reaches the solver-limit prefs through
// lib/fitSolverBody.ts, and a lazy-only half that statically imports that module
// is written into the entry chunk anyway, taking its other six wrappers with it.
// This one function stays eager; the rest of apiLazy.ts does not.

import { fitSolverExtra } from "./fitSolverBody";
import { postJSON } from "./api/http";
import type { FitRequest } from "./api";
import type { CalcResult } from "./types";

/** Bounded nonlinear least-squares fit of a named model. */
export async function fitModel(req: FitRequest, signal?: AbortSignal): Promise<CalcResult> {
  // Preferences ▸ Fitting solver limits (non-default only; lib/fitPrefs.ts).
  return postJSON("/api/fitting/fit", { ...req, ...(await fitSolverExtra("/api/fitting/fit")) }, signal);
}
